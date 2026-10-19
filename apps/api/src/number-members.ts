import {z} from 'zod';
import {managedMember,type MemberTelephony} from '../../../packages/types/src/settings';
import type {AssignmentView} from '../../web/src/number-provisioning/models/number-assignment-model';
import type {NumberRouting,NumberAssignedUser} from '../../web/src/number-provisioning/models/number-routing';
import {directMemberDestination} from './telephony/member-extensions';

type Member={id:string;name:string;email:string;status:string};
export type NumberMember=NumberAssignedUser&MemberTelephony;

/** Read the whole authorized IAM directory, including pending members beyond page one. */
export async function organizationNumberMembers(request:(path:string)=>Promise<unknown>,organization:string){
 const result:Member[]=[],seen=new Set<string>();
 for(let offset=0;offset<=100000;){
  const page=z.array(managedMember).max(50).parse(await request(`/organizations/${organization}/members?offset=${offset}&search=`));
  for(const member of page){
   if(seen.has(member.user_id))throw Error('Member pagination repeated a record');
   seen.add(member.user_id);result.push({...member,id:member.user_id});
  }
  if(page.length<50)return result;
  offset+=page.length;
 }
 throw Error('Member directory limit exceeded');
}

export async function resolveNumberMembers(members:Member[],directory:(emails:string[])=>Promise<Record<string,MemberTelephony>>):Promise<NumberMember[]>{
 const current=members.filter(m=>['pending','active','suspended'].includes(m.status));
 const details=await directory(current.map(m=>m.email));
 return current.map(({id,name,email})=>({id,name,email,extensions:details[email]?.extensions??[],phone_numbers:details[email]?.phone_numbers??[]}));
}

/** One directory lookup per organization. Never infer a Platform identity from a PBX display name. */
export async function numberRoutingMembers(
 routing:Record<string,NumberRouting>,assignments:AssignmentView[],
 lookup:(organization:string)=>Promise<NumberMember[]>,
):Promise<Record<string,NumberRouting>>{
 const result=Object.fromEntries(Object.entries(routing).map(([id,{users:_users,usersUnavailable:_unavailable,...route}])=>[id,{...route,users:[]} as NumberRouting]));
 const groups=new Map<string,AssignmentView[]>();
 for(const assignment of assignments){
  if(!result[assignment.id]||!assignment.organizationId||assignment.status==='unassigned'||assignment.status==='terminated')continue;
  const group=groups.get(assignment.organizationId)??[];group.push(assignment);groups.set(assignment.organizationId,group);
 }
 const pending=[...groups];
 const digits=(value:string)=>value.replace(/\D/g,'');
 // Bound concurrent tenant reads; provider directory reads are shared and cached.
 await Promise.all(Array.from({length:Math.min(4,pending.length)},async()=>{
  for(let entry=pending.shift();entry;entry=pending.shift()){
   const [organization,group]=entry;
   try{
    const members=await lookup(organization);
    for(const assignment of group){
     const route=result[assignment.id]!,ns=route.netsapiens;
     if(ns.error||!ns.domain||!ns.destination||ns.destination==='9999'||ns.domain!==assignment.domain||!directMemberDestination(assignment.domain,{
      domain:ns.domain,'dial-rule-application':ns.application??'','dial-rule-translation-destination-host':ns.host??'',
     }))continue;
     route.users=members.filter(m=>m.extensions.includes(ns.destination!)&&m.phone_numbers.some(n=>digits(n)===digits(assignment.number)))
      .map(({id,name,email})=>({id,name,email}));
    }
   }catch{
    // An unavailable directory is distinct from an unassigned number. Keep routing usable.
    for(const assignment of group)result[assignment.id]!.usersUnavailable=true;
   }
  }
 }));
 return result;
}
