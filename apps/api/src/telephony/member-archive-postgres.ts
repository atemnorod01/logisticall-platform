import {AsyncLocalStorage} from 'node:async_hooks';
import type {Pool,PoolClient} from 'pg';
import type {NetsapiensClient} from './netsapiens';
import {archiveConflict,memberArchiveService,type ArchiveOperation} from './member-archive';
export function postgresMemberArchive(pool:Pool,ns:NetsapiensClient,binding:(id:string,client?:PoolClient)=>Promise<{domain:string}|undefined>){
 const context=new AsyncLocalStorage<PoolClient>();
 let active=0;
 const db=()=>{const value=context.getStore();if(!value)throw Error('Archive lock required');return value;};
 return memberArchiveService({
  async exclusive(id,work){
   if(active>=2)throw archiveConflict('Member cleanup is busy. Try again shortly.');
   active++;let client:PoolClient;
   try{client=await pool.connect();}catch(e){active--;throw e;}let locked=false;
   try{
    locked=(await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,180026)) AS acquired',[id])).rows[0].acquired;
    if(!locked)throw archiveConflict('Another telephony operation is running. Try again shortly.');
    return await context.run(client,work);
   }finally{active--;try{if(locked)await client.query('SELECT pg_advisory_unlock(hashtextextended($1,180026))',[id]);client.release();}catch{client.release(true);}}
  },
  async get(key){const op=(await db().query('SELECT data FROM telephony.member_archives WHERE id=$1',[key])).rows[0]?.data as ArchiveOperation|undefined;if(op&&!op.complete&&op.resources.domain!==((await binding(op.member.organizationId,db()))?.domain??null))throw archiveConflict('Organization PBX binding changed. Review the unfinished archive.');return op;},
  async put(key,value){await db().query('INSERT INTO telephony.member_archives(id,organization_id,user_id,data) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=now()',[key,value.member.organizationId,value.member.userId,value]);},
 },{
  async inspect(member){
   const current=await binding(member.organizationId,db());
   if(!current)return {domain:null,users:[],numbers:[]};
   const resources=await ns.memberArchiveResources(current.domain,member);
   if(resources.numbers.length&&await ns.inventoryAttendantDestination(current.domain)!=='9999')throw archiveConflict('Unassigned extension 9999 is unavailable.');
   return resources;
  },
  returnNumber:(resources,n,verify)=>ns.returnMemberNumber(resources,n,verify),
  deleteExtension:(resources,u,verify)=>ns.deleteMemberExtension(resources,u,verify),
 });
}
