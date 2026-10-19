import {z} from 'zod';
import type {Pool,PoolClient} from 'pg';
import type {FastifyInstance} from 'fastify';
import {numberServicePath,numberServiceVerifier} from './number-service-auth';
import {organizationTelephonyActive} from './organization-access';
import {customerBelongsToOrganization,verifiedAdoption} from './organization-adoption';
import {PostgresIntegrationVault} from './integration-vault';
import {PortaoneClient} from './portaone';
import {NetsapiensClient} from './netsapiens';
import {numberAssignmentProviders} from './number-assignment-providers';
import {numberUnassignmentProviders} from './number-unassignment-providers';
import {NumberAssignmentRejected,DeletionRejected} from './number-errors';
import {readPortaoneAccounts} from './portaone-accounts';
import type {Organization} from './model';
import type {NumberAssignment} from '../../../web/src/number-provisioning/models/number-assignment-model';
const number=z.string().regex(/^\+1[2-9]\d{9}$/),id=z.number().int().positive();
const base=z.object({organizationId:z.uuid(),customerId:z.string().regex(/^[1-9]\d*$/),domain:z.string().regex(/^[1-9]\d*$/)});
export const providerOperation=z.discriminatedUnion('action',[
 base.extend({action:z.literal('customer')}).strict(),
 base.extend({action:z.literal('domain')}).strict(),
 base.extend({action:z.literal('destination')}).strict(),
 base.extend({action:z.literal('routing')}).strict(),
 base.extend({action:z.literal('alias'),number,master:id}).strict(),
 base.extend({action:z.literal('add-alias'),number,master:id}).strict(),
 base.extend({action:z.literal('number'),number,destination:z.literal('9999').nullable().optional(),allowUnassigned:z.boolean().optional()}).strict(),
 base.extend({action:z.literal('add-number'),number,destination:z.literal('9999').nullable()}).strict(),
 base.extend({action:z.literal('route-number'),number,destination:z.literal('9999').nullable()}).strict(),
 base.extend({action:z.literal('removal-check'),number,master:id,alias:id.optional()}).strict(),
 base.extend({action:z.literal('removal-alias'),number,master:id,alias:id.optional()}).strict(),
 base.extend({action:z.literal('removal-number'),number,master:id,alias:id.optional()}).strict(),
 base.extend({action:z.literal('delete-alias'),number,master:id,alias:id}).strict(),
 base.extend({action:z.literal('delete-number'),number,master:id,alias:id.optional(),record:z.record(z.string(),z.unknown())}).strict(),
]);
const writes=new Set(['add-alias','add-number','route-number','delete-alias','delete-number']);
const unavailable=()=>Object.assign(Error('Organization telephony unavailable'),{statusCode:409});
export function assertProviderOrganization(org:Organization,state:string,input:z.infer<typeof providerOperation>){
 if(!organizationTelephonyActive({data:org,state})||org.id!==input.organizationId||org.portaoneId!==input.customerId||org.netsapiensDomain!==input.domain)throw unavailable();
}
export function removedProviderTargets(org:Organization){
 return [org,...(org.lifecycleHistory??[])].flatMap(o=>o.termination?.status==='complete'&&o.portaoneId&&o.netsapiensDomain?[{organizationId:org.id,customerId:o.portaoneId,domain:o.netsapiensDomain}]:[]);
}
export function platformNumberProviders(pool:Pool,clients?:{po:Pick<PortaoneClient,'call'>;ns:NetsapiensClient}){
 const vault=new PostgresIntegrationVault(pool),po=clients?.po??new PortaoneClient(vault),ns=clients?.ns??new NetsapiensClient(vault);
 const assign=numberAssignmentProviders(po.call.bind(po),ns,async()=>{throw Error('Carrier execution belongs to provisioning');});
 const remove=numberUnassignmentProviders(po.call.bind(po),ns);
 return {
  async destinations(){
   const {rows}=await pool.query("SELECT data,state FROM telephony.organizations");
   return rows.flatMap(({data:o,state}:{data:Organization;state:string})=>organizationTelephonyActive({data:o,state})?[{id:o.id,name:o.name,createdAt:o.createdAt,portaoneId:o.portaoneId,netsapiensDomain:o.netsapiensDomain,...(verifiedAdoption(o)?{legacyOrganizationId:o.adoption!.legacyOrganizationId}:{})}]:[]);
  },
  async removals(){
   const {rows}=await pool.query('SELECT data,state FROM telephony.organizations');
   return rows.flatMap(({data}:{data:Organization})=>removedProviderTargets(data));
  },
  async execute(raw:unknown,requestId:string){
   const input=providerOperation.parse(raw),db=await pool.connect();let locked=false,executionStarted=false,replayed=false;
   try{
    // Shares the organization lifecycle lock. Disabling cannot overlap any TN
    // write, and a terminated/re-created organization cannot reuse old targets.
    locked=(await db.query('SELECT pg_try_advisory_lock_shared(hashtextextended($1,180026)) AS acquired',[input.organizationId])).rows[0].acquired;
    if(!locked)throw unavailable();
    const {rows}=await db.query('SELECT data,state FROM telephony.organizations WHERE organization_id=$1',[input.organizationId]);
    if(!rows[0])throw unavailable();
    const org:Organization=rows[0].data;assertProviderOrganization(org,rows[0].state,input);
    if(writes.has(input.action)){
     await db.query('DELETE FROM telephony.number_service_requests WHERE expires_at < now()');
     const claimed=await db.query('INSERT INTO telephony.number_service_requests(id) VALUES($1) ON CONFLICT DO NOTHING RETURNING id',[requestId]);
     if(!claimed.rowCount){replayed=true;throw unavailable();}
     const c=(await po.call('/Customer/get_customer_info',{i_customer:Number(org.portaoneId),get_auth_info:0})).customer_info as Record<string,unknown>;
     if(!c||!customerBelongsToOrganization(org,c))throw unavailable();
     await db.query("INSERT INTO telephony.audit(organization_id,actor_id,event) VALUES($1,'00000000-0000-4000-8000-000000000021',$2)",[org.id,'number_'+input.action]);
    }
    const a={organizationId:org.id,customerId:org.portaoneId!,domain:org.netsapiensDomain!,number:'number' in input?input.number:'',masterAccountId:'master' in input?input.master:undefined,aliasId:'alias' in input?input.alias:undefined} as NumberAssignment;
    switch(input.action){
     case 'customer':return assign.checkCustomer(input.customerId);
     case 'domain':await assign.checkDomain(input.domain);return true;
     case 'destination':{
      const destination=await assign.defaultDestination(input.domain);
      if(destination!=='9999')throw unavailable(); // Platform-created PBXs always use 9999.
      return destination;
     }
     case 'alias':return await assign.findAlias(input.number,input.customerId,input.master)??null;
     case 'add-alias':{
      if(await assign.checkCustomer(input.customerId)!==input.master)throw new NumberAssignmentRejected('PBX account changed');
      if(!await assign.findAlias(input.number,input.customerId,input.master)){executionStarted=true;await assign.createAlias(input.number,input.master);}
      return true;
     }
     case 'number':return assign.findNumber(input.number,input.domain,input.destination,input.allowUnassigned);
     case 'add-number':
      if(input.destination!=='9999')throw new NumberAssignmentRejected('Inventory destination is required');
      executionStarted=true;await assign.createNumber(input.number,input.domain,org.name,input.destination);return true;
     case 'route-number':
      if(input.destination!=='9999')throw new NumberAssignmentRejected('Inventory destination is required');
      executionStarted=true;await assign.routeNumber(input.number,input.domain,org.name,input.destination);return true;
     case 'removal-check':await remove.check(a);return true;
     case 'removal-alias':return await remove.alias(a)??null;
     case 'removal-number':return await remove.number(a)??null;
     case 'delete-alias':await remove.check(a);executionStarted=true;await remove.removeAlias(a,input.alias);return true;
     case 'delete-number':await remove.check(a);executionStarted=true;await remove.removeNumber(a,input.record);return true;
     case 'routing':{
      const [accounts,numbers,users]=await Promise.all([readPortaoneAccounts(input.customerId,po.call.bind(po)),ns.domainPhoneNumbers(input.domain),ns.domainDestinationUsers(input.domain)]);
      return {accounts,numbers,users};
     }
    }
   }catch(error){
    if(writes.has(input.action)&&!executionStarted&&!replayed)throw new NumberAssignmentRejected('Provider preflight rejected the request before a write.');
    throw error;
   }finally{try{if(locked)await db.query('SELECT pg_advisory_unlock_shared(hashtextextended($1,180026))',[input.organizationId]);db.release();}catch{db.release(true);}}
  }
 };
}
export function numberProviderRoutes(app:FastifyInstance,service:ReturnType<typeof platformNumberProviders>,publicKey:string){
 const verify=numberServiceVerifier(publicKey);
 app.route({method:['GET','POST'],url:numberServicePath,config:{numberProviderService:true},bodyLimit:65536,handler:async(req,reply)=>{
  if(req.headers.origin||req.headers.cookie)throw Object.assign(Error('Service only'),{statusCode:401});
  const requestId=await verify(req.headers.authorization,req.method,req.raw.url!,req.method==='POST'?req.body:undefined);
  req.raw.setTimeout?.(70000);
  z.object({}).strict().parse(req.query);
  if(req.method==='GET'){const [organizations,removals]=await Promise.all([service.destinations(),service.removals()]);return {organizations,removals};}
  try{return {result:await service.execute(req.body,requestId)};}
  catch(error){
   // Definitive rejection clears the legacy pending marker. An unknown outcome
   // remains pending and must be reconciled by reads, never automatically replayed.
   if(error instanceof NumberAssignmentRejected||error instanceof DeletionRejected)return reply.code(409).send({rejected:true});
   throw error;
  }
 }});
}
