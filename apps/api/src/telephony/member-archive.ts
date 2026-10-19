import {createHash} from 'node:crypto';
export type ArchiveMember={organizationId:string;userId:string;email:string;membershipKey:string};
export type ArchiveResources={domain:string|null;users:Record<string,string>[];numbers:Record<string,string>[]};
export type ArchiveOperation={member:ArchiveMember;resources:ArchiveResources;hash:string;started:boolean;complete:boolean;released:string[];deleted:string[];pending?:{kind:'number'|'extension';target:string}};
export interface MemberArchiveStore {
 exclusive<T>(organization:string,work:()=>Promise<T>):Promise<T>;
 get(key:string):Promise<ArchiveOperation|undefined>;
 put(key:string,value:ArchiveOperation):Promise<void>;
}
export interface MemberArchiveProviders {
 inspect(member:ArchiveMember):Promise<ArchiveResources>;
 returnNumber(resources:ArchiveResources,number:Record<string,string>,verifyOnly:boolean):Promise<void>;
 deleteExtension(resources:ArchiveResources,user:Record<string,string>,verifyOnly:boolean):Promise<void>;
}
export const archiveConflict=(message:string)=>Object.assign(Error(message),{statusCode:409});
export function memberArchiveService(store:MemberArchiveStore,providers:MemberArchiveProviders){
 const key=(m:ArchiveMember)=>`${m.organizationId}:${m.userId}:${m.membershipKey}`;
 const hash=(m:ArchiveMember,r:ArchiveResources)=>createHash('sha256').update(JSON.stringify({m,r})).digest('hex');
 const load=async(m:ArchiveMember)=>{
  const old=await store.get(key(m));if(old?.started)return old;
  const resources=await providers.inspect(m);
  return {member:m,resources,hash:hash(m,resources),started:false,complete:false,released:[],deleted:[]} satisfies ArchiveOperation;
 };
 const preview=async(m:ArchiveMember)=>store.exclusive(m.organizationId,async()=>{
  const op=await load(m);
  return {preview_hash:op.hash,extensions:op.resources.users.map(u=>u.user!),phone_numbers:op.resources.numbers.map(n=>n.phonenumber!),resume:op.started&&!op.complete};
 });
 const run=async(m:ArchiveMember,expected:string,archive:()=>Promise<void>,begin?:()=>Promise<void>)=>store.exclusive(m.organizationId,async()=>{
  const op=await load(m);
  if(op.hash!==expected)throw archiveConflict('Assignments changed. Review the deletion again.');
  if(op.complete)return;
  if(op.member.email.toLowerCase()!==m.email.toLowerCase())throw archiveConflict('Member identity changed. Review the deletion again.');
  // Persist the exact targets before any mutation. A retry never follows a new email match.
  op.started=true;await store.put(key(m),op);
  // Freeze membership access and revoke a pending login before touching PBX resources.
  await begin?.();
  for(const n of op.resources.numbers){
   if(op.released.includes(n.phonenumber!))continue;
   const verify=op.pending?.kind==='number'&&op.pending.target===n.phonenumber;
   op.pending={kind:'number',target:n.phonenumber!};await store.put(key(m),op);
   await providers.returnNumber(op.resources,n,verify);delete op.pending;
   op.released.push(n.phonenumber!);await store.put(key(m),op);
  }
  for(const u of op.resources.users){
   if(op.deleted.includes(u.user!))continue;
   const verify=op.pending?.kind==='extension'&&op.pending.target===u.user;
   op.pending={kind:'extension',target:u.user!};await store.put(key(m),op);
   await providers.deleteExtension(op.resources,u,verify);delete op.pending;
   op.deleted.push(u.user!);await store.put(key(m),op);
  }
  // Only the membership is archived. Auth identities, profiles, messages and calls remain.
  await archive();op.complete=true;await store.put(key(m),op);
 });
 return {preview,run};
}
export function memberResources(member:ArchiveMember,domain:string,users:Record<string,string>[],numbers:Record<string,string>[]):ArchiveResources {
 const email=member.email.trim().toLowerCase();
 const matches=users.filter(u=>email&&email!=='blank@replaceme.com'&&u.email?.trim().toLowerCase()===email&&
  u['user-scope']?.replace(/[\s_-]/g,'').toLowerCase()!=='noportal'&&/^\d{1,16}$/.test(u.user??'')&&u.user!=='9999');
 if(matches.some(u=>u.domain&&u.domain!==domain))throw archiveConflict('Extension belongs to another organization.');
 const extensions=new Set(matches.map(u=>u.user));
 const assigned=numbers.filter(n=>extensions.has(n['dial-rule-translation-destination-user']));
 if(assigned.some(n=>(n.domain&&n.domain!==domain)||n['dial-rule-translation-destination-host']!==domain||n['dial-rule-application']!=='to-user'))throw archiveConflict('A number has an unsupported destination. Review its routing first.');
 if(new Set(matches.map(u=>u.user)).size!==matches.length||new Set(assigned.map(n=>n.phonenumber)).size!==assigned.length)throw archiveConflict('Duplicate PBX resources need review.');
 return {domain,users:matches.sort((a,b)=>a.user!.localeCompare(b.user!)),numbers:assigned.sort((a,b)=>a.phonenumber!.localeCompare(b.phonenumber!))};
}
