import {it,expect,vi} from 'vitest';
import {generateKeyPair,exportSPKI,SignJWT} from 'jose';
import {createHash,randomUUID} from 'node:crypto';
import Fastify from 'fastify';
import type {Pool} from 'pg';
import {numberProviderRoutes,platformNumberProviders,providerOperation,assertProviderOrganization,removedProviderTargets} from '../../apps/api/src/telephony/number-provider-service';
import {numberServiceVerifier,numberServicePath} from '../../apps/api/src/telephony/number-service-auth';
import type {NetsapiensClient} from '../../apps/api/src/telephony/netsapiens';
import {NumberAssignmentRejected} from '../../apps/api/src/telephony/number-errors';
import type {Organization} from '../../apps/api/src/telephony/model';
const org={id:'11111111-1111-4111-8111-111111111111',name:'Test tenant',createdAt:new Date().toISOString(),portaoneId:'123',netsapiensDomain:'123',portaoneProvisioning:{status:'complete',step:'complete',customerName:'Test',aliases:[]},netsapiensProvisioning:{status:'complete',step:'complete',domain:'123'}} as Organization;
const base={organizationId:org.id,customerId:'123',domain:'123'},number='+12165550100';
async function signing(){
 const {privateKey,publicKey}=await generateKeyPair('ES256');
 const pub=await exportSPKI(publicKey);
 const sign=async(method:string,body?:unknown,extra:Record<string,unknown>={})=>'Bearer '+await new SignJWT({method,path:numberServicePath,bodyHash:createHash('sha256').update(body===undefined?'':JSON.stringify(body)).digest('hex'),...extra}).setProtectedHeader({alg:'ES256',typ:'JWT'}).setIssuer('logisticall-provisioning').setAudience('logisticall-platform-number-providers').setSubject('number-worker').setIssuedAt().setExpirationTime('60s').setJti(randomUUID()).sign(privateKey);
 return {pub,sign};
}
it('reverse service authentication binds the method, exact route and body and rejects forward audience',async()=>{
 const {pub,sign}=await signing(),verify=numberServiceVerifier(pub),body={...base,action:'customer'},token=await sign('POST',body);
 await expect(verify(token,'POST',numberServicePath,body)).resolves.toMatch(/^[0-9a-f-]{36}$/);
 for(const [method,path,payload] of [['GET',numberServicePath,body],['POST',numberServicePath+'?x=1',body],['POST',numberServicePath,{...body,customerId:'456'}]] as const)await expect(verify(token,method,path,payload)).rejects.toMatchObject({statusCode:401});
 await expect(verify(undefined,'POST',numberServicePath,body)).rejects.toMatchObject({statusCode:401});
});
it('provider targets are canonical, complete and active, with no arbitrary provider path',()=>{
 const input=providerOperation.parse({...base,action:'customer'});expect(()=>assertProviderOrganization(org,'complete',input)).not.toThrow();
 for(const changed of [{...org,disabling:true},{...org,portaoneId:'456'},{...org,netsapiensDomain:'456'},{...org,id:randomUUID()},{...org,termination:{status:'complete'}}])expect(()=>assertProviderOrganization(changed as Organization,'complete',input)).toThrow();
 expect(()=>assertProviderOrganization(org,'running',input)).toThrow();
 expect(providerOperation.safeParse({...base,action:'customer',path:'/Account/delete_account'}).success).toBe(false);
 expect(providerOperation.safeParse({...base,action:'add-alias',number,master:0}).success).toBe(false);
});
function fixture(){
 const receipts=new Set<string>();let alias=false,refnum=org.id.replaceAll('-','');
 const query=vi.fn(async(sql:string,args?:unknown[])=>{
  if(sql.includes('pg_try_advisory_lock'))return {rows:[{acquired:true}],rowCount:1};
  if(sql.startsWith('SELECT data,state'))return {rows:[{data:org,state:'complete'}],rowCount:1};
  if(sql.startsWith('INSERT INTO telephony.number_service_requests')){const id=String(args?.[0]);if(receipts.has(id))return {rows:[],rowCount:0};receipts.add(id);}
  return {rows:[],rowCount:1};
 });
 const db={query,release:vi.fn()},pool={query,connect:async()=>db} as unknown as Pool;
 const po={call:vi.fn(async(path:string,body:Record<string,unknown>):Promise<Record<string,unknown>>=>{
  if(path==='/Customer/get_customer_info')return {customer_info:{i_customer:123,i_parent:289507,refnum,bill_status:'O',blocked:'N'}};
  if(path==='/Account/get_account_info')return body.id?{account_info:{i_account:42,id:'0208123',i_customer:123,billing_model:1,i_product:30739,bill_status:'O',blocked:'N'}}:{account_info:{i_account:43,id:number.slice(1),i_customer:123,i_master_account:42,billing_model:2,bill_status:'O',blocked:'N'}};
  if(path==='/Account/get_account_list')return {account_list:alias?[{id:number.slice(1),i_account:43}]:[],total:alias?1:0};
  if(path==='/Account/add_alias'){alias=true;return {success:1};}
  throw Error('Unexpected provider method');
 })};
 const ns={readProvisionDomain:async()=>({domain:'123',reseller:'289507'}),status:async()=>({reseller:'289507'}),inventoryAttendantDestination:async()=>'9999',createInventoryNumber:vi.fn(async()=>{}),findInventoryNumber:async()=>false} as unknown as NetsapiensClient;
 return {service:platformNumberProviders(pool,{po,ns}),po,ns,query,setRef:(value:string)=>{refnum=value;}};
}
it('alias writes run in Platform, verify organization refnum and reject replay across requests',async()=>{
 const f=fixture(),input={...base,action:'add-alias',number,master:42},id=randomUUID();
 expect(await f.service.execute(input,id)).toBe(true);
 await expect(f.service.execute(input,id)).rejects.toMatchObject({statusCode:409});
 await f.service.execute(input,randomUUID());
 expect(f.po.call.mock.calls.filter(([path])=>path==='/Account/add_alias')).toHaveLength(1);
 expect(f.po.call.mock.calls.find(([path])=>path==='/Account/add_alias')?.[1]).toEqual({alias_info:{i_master_account:42,id:number.slice(1),i_account_role:1,blocked:'N',realm:''}});
 const wrong=fixture();wrong.setRef(randomUUID());await expect(wrong.service.execute(input,randomUUID())).rejects.toThrow();
 expect(wrong.po.call.mock.calls.some(([path])=>path==='/Account/add_alias')).toBe(false);
});
it('Platform number creation uses the canonical organization description and requires attendant 9999',async()=>{
 const f=fixture();await f.service.execute({...base,action:'add-number',number,destination:'9999'},randomUUID());
 expect(f.ns.createInventoryNumber).toHaveBeenCalledWith(number,'123',org.name,'9999');
 await expect(f.service.execute({...base,action:'add-number',number,destination:null},randomUUID())).rejects.toBeInstanceOf(NumberAssignmentRejected);
});
it('internal endpoint refuses browser cookies/origins and distinguishes rejected from uncertain writes',async()=>{
 const {pub,sign}=await signing(),app=Fastify(),execute=vi.fn(async()=>{throw new NumberAssignmentRejected();});
 numberProviderRoutes(app,{destinations:async()=>[],removals:async()=>[],execute},pub);
 const body={...base,action:'customer'},authorization=await sign('POST',body);
 const response=await app.inject({method:'POST',url:numberServicePath,headers:{authorization},payload:body});expect(response.statusCode).toBe(409);expect(response.json()).toEqual({rejected:true});
 for(const headers of [{origin:'https://example.com'},{cookie:'session=x'}])expect((await app.inject({method:'POST',url:numberServicePath,headers:{...headers,authorization},payload:body})).statusCode).toBe(401);
 execute.mockImplementation(async()=>{throw Error('Ambiguous provider timeout');});
 expect((await app.inject({method:'POST',url:numberServicePath,headers:{authorization},payload:body})).statusCode).toBe(500);
 await app.close();
});

it('removal receipts contain only verified completed provider targets, including earlier enablements',()=>{
 const removed={status:'complete'} as NonNullable<Organization['termination']>;
 expect(removedProviderTargets({...org,termination:{status:'failed'} as NonNullable<Organization['termination']>})).toEqual([]);
 expect(removedProviderTargets({...org,termination:removed,lifecycleHistory:[{portaoneId:'122',netsapiensDomain:'122',termination:removed}]})).toEqual([{organizationId:org.id,customerId:'123',domain:'123'},{organizationId:org.id,customerId:'122',domain:'122'}]);
});

it('accepts signed service operations with browser CSRF middleware installed while rejecting browser and unsigned traffic',async()=>{
 const {browserSessions}=await import('../../apps/api/src/auth/browser');
 const {pub,sign}=await signing(),app=Fastify(),execute=vi.fn(async()=>true);
 browserSessions({origin:'https://platform.example',key:Buffer.alloc(32,1),store:{} as import('../../apps/api/src/auth/store').SessionStore,provider:{} as import('../../apps/api/src/auth/provider').Provider,identity:async()=>{throw Error('Browser identity must not be used');}}).register(app);
 numberProviderRoutes(app,{destinations:async()=>[],removals:async()=>[],execute},pub);
 app.post('/v1/ordinary-mutation',async()=>({ok:true}));
 const body={...base,action:'customer'},authorization=await sign('POST',body);
 expect((await app.inject({method:'POST',url:numberServicePath,headers:{authorization},payload:body})).statusCode).toBe(200);
 expect((await app.inject({method:'POST',url:numberServicePath,payload:body})).statusCode).toBe(401);
 for(const headers of [{origin:'https://platform.example'},{cookie:'session=x'}])expect([401,403]).toContain((await app.inject({method:'POST',url:numberServicePath,headers:{...headers,authorization},payload:body})).statusCode);
 expect((await app.inject({method:'POST',url:'/v1/ordinary-mutation',headers:{authorization},payload:body})).statusCode).toBe(403);
 expect((await app.inject({method:'POST',url:numberServicePath+'?x=1',headers:{authorization},payload:body})).statusCode).toBe(403);
 expect(execute).toHaveBeenCalledTimes(1);
 await app.close();
});
