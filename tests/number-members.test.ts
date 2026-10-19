import {it,expect,vi} from 'vitest';
import {buildApp} from '../apps/api/src/app';
import {organizationNumberMembers,resolveNumberMembers,numberRoutingMembers} from '../apps/api/src/number-members';
import {memberTelephonyDirectory} from '../apps/api/src/telephony/member-extensions';
import type {TelephonyService} from '../apps/api/src/telephony/service';
import type {AssignmentView} from '../apps/web/src/number-provisioning/models/number-assignment-model';
import type {NumberRouting} from '../apps/web/src/number-provisioning/models/number-routing';

const org='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002',actor='20000000-0000-4000-8000-000000000001';
const member={user_id:actor,name:'Pat Example',email:'pat@example.com',role_id:'member',status:'pending',can_edit_name:false,can_edit_access:false,can_edit_role:false};
const assignment={id:'one',organizationId:org,domain:'pbx',number:'+12165550100',status:'complete'} as AssignmentView;
const route: NumberRouting={portaone:{account:null},netsapiens:{domain:'pbx',destination:'201',application:'to-user-residential',host:'pbx',destinationName:'PBX name'}};
const details={extensions:['201'],phone_numbers:['12165550100']};

it('matches pending members in both directions through the same live PBX relationship, with tenant isolation',async()=>{
 let admin=true,enabled=true;
 const memberDirectory=memberTelephonyDirectory(async id=>id===org?{domain:'pbx'}:undefined,async()=>[
  {domain:'pbx',user:'201',email:'Pat@Example.com','user-scope':'Basic User'},
 ],async()=>[{domain:'pbx',phonenumber:'12165550100','dial-rule-application':'to-user-residential','dial-rule-translation-destination-host':'pbx','dial-rule-translation-destination-user':'201'}]);
 const settings=vi.fn(async(_token:string,path:string)=>path.startsWith('/platform/records')?{
  id:org,name:'Organization',revision:'v1',member_list:[{id:actor,...member,role:'member'}],
 }:[member]);
 const request=vi.fn(async(_actor:string,_method:string,path:string)=>path.includes('/routing')?{
  routing:{one:route,foreign:{...route,users:[{id:'private',name:'Private',email:'private@example.com'}]}},
 }:{assignments:[assignment,{...assignment,id:'foreign',organizationId:other}],destinations:[]});
 const app=buildApp({issuer:'https://iam.example',clientId:'platform',iamApi:'https://iam.example'},{
  verify:async()=>({userId:actor}),identity:async()=>({user_id:actor,email:member.email,display_name:member.name,platform_admin:admin}),
  context:async()=>({user_id:actor,organization_id:org,name:'Org',role_id:admin?'owner':'member',membership_status:'active',organization_status:'active'}),
  settings,numbers:{request},telephony:{memberDirectory,canAccessTelephony:async()=>enabled,close:async()=>{}} as unknown as TelephonyService,
 });
 try{
  const headers={authorization:'Bearer test'},url=`/v1/organizations/${org}/phone-numbers/console/number-purchase/routing`;
  const members=await app.inject({url:`/v1/organizations/${org}/members`,headers});
  expect(members.json().members[0]).toMatchObject(details);
  const numbers=await app.inject({url,headers});expect(numbers.statusCode).toBe(200);
  expect(Object.keys(numbers.json().routing)).toEqual(['one']);
  expect(numbers.json().routing.one.users).toEqual([{id:actor,name:member.name,email:member.email}]);
  settings.mockClear();
  const platform=await app.inject({url:'/v1/platform/phone-numbers/console/number-purchase/routing',headers});
  expect(platform.statusCode).toBe(200);expect(platform.json().routing.one.users[0].name).toBe(member.name);
  expect(platform.json().routing.foreign.users).toEqual([]);expect(platform.json().routing.foreign.usersUnavailable).toBe(true);
  expect(settings).toHaveBeenCalledTimes(2);
  settings.mockClear();request.mockClear();admin=false;
  expect((await app.inject({url,headers})).statusCode).toBe(403);
  expect((await app.inject({url:'/v1/platform/phone-numbers/console/number-purchase/routing',headers})).statusCode).toBe(403);
  admin=true;enabled=false;expect((await app.inject({url,headers})).statusCode).toBe(403);
  expect(settings).not.toHaveBeenCalled();expect(request).not.toHaveBeenCalled();
 }finally{await app.close();}
});

it('excludes archived users and stale, foreign or service routes; batches all numbers in a tenant',async()=>{
 const members=await resolveNumberMembers([
  {id:'current',name:'Same Name',email:member.email,status:'pending'},
  {id:'archived',name:'Same Name',email:member.email,status:'archived'},
 ],async()=>({[member.email]:details}));
 expect(members).toHaveLength(1);
 const lookup=vi.fn(async()=>members);
 const routing=Object.fromEntries(['one','stale','foreign','queue','inventory'].map(id=>[id,structuredClone(route)]));
 routing.stale!.netsapiens.destination='202';routing.foreign!.netsapiens.host='other';routing.queue!.netsapiens.application='call-queue';routing.inventory!.netsapiens.destination='9999';
 const assignments=Object.keys(routing).map(id=>({...assignment,id}));
 const result=await numberRoutingMembers(routing,assignments,lookup);
 expect(result.one!.users?.map(u=>u.id)).toEqual(['current']);
 for(const id of ['stale','foreign','queue','inventory'])expect(result[id]!.users).toEqual([]);
 expect(lookup).toHaveBeenCalledTimes(1);
 lookup.mockRejectedValueOnce(Error('IAM unavailable'));
 expect((await numberRoutingMembers({one:route},[assignment],lookup)).one).toMatchObject({users:[],usersUnavailable:true,netsapiens:route.netsapiens});
});

it('includes members after the first IAM page and refuses a looping directory',async()=>{
 const rows=Array.from({length:51},(_,i)=>({...member,user_id:`20000000-0000-4000-8000-${String(i).padStart(12,'0')}`}));
 const request=vi.fn(async(path:string)=>{const offset=Number(new URL(path,'http://test').searchParams.get('offset'));return rows.slice(offset,offset+50);});
 expect(await organizationNumberMembers(request,org)).toHaveLength(51);expect(request).toHaveBeenCalledTimes(2);
 await expect(organizationNumberMembers(async()=>rows.slice(0,50),org)).rejects.toThrow('repeated');
});
