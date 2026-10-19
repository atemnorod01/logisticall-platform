import {it,expect,vi} from 'vitest';
import {buildApp} from '../apps/api/src/app';
import type {TelephonyService} from '../apps/api/src/telephony/service';
const actor='10000000-0000-4000-8000-000000000001',org='20000000-0000-4000-8000-000000000001',user='30000000-0000-4000-8000-000000000001';
it('shows pending members and extensions only after tenant or platform administrator authorization',async()=>{
 let admin=false;
 const member={user_id:user,name:'PBX invitee',email:'invitee@example.com',role_id:'member',status:'pending',can_edit_name:false,can_edit_access:false,can_edit_role:false};
 const memberExtensions=vi.fn(async()=>({'invitee@example.com':['0201']}));
 const app=buildApp({issuer:'https://iam.example',clientId:'platform',iamApi:'https://iam.example'},{
  verify:async()=>({userId:actor}),identity:async()=>({user_id:actor,email:'admin@example.com',display_name:'Admin',platform_admin:admin}),
  context:async()=>({user_id:actor,organization_id:org,name:'Organization',role_id:admin?'owner':'member',membership_status:'active',organization_status:'active'}),
  settings:async(_token,path)=>path.startsWith('/platform/records')?{id:org,name:'Organization',revision:'v1',member_list:[{id:user,name:member.name,email:member.email,role:'member',status:'pending'}]}:[member],
  telephony:{memberExtensions,close:async()=>{}} as unknown as TelephonyService,
 });
 try{
  const headers={authorization:'Bearer test'};
  for(const url of [`/v1/organizations/${org}/members`,`/v1/platform/records/organizations/${org}`]){
   expect((await app.inject({url,headers})).statusCode).toBe(403);
  }
  expect(memberExtensions).not.toHaveBeenCalled();admin=true;
  const tenant=await app.inject({url:`/v1/organizations/${org}/members`,headers});
  expect(tenant.statusCode).toBe(200);expect(tenant.json().members[0]).toMatchObject({...member,extensions:['0201'],presence:'offline'});
  expect(memberExtensions).toHaveBeenLastCalledWith(org,['invitee@example.com']);
  const platform=await app.inject({url:`/v1/platform/records/organizations/${org}`,headers});
  expect(platform.json().member_list[0]).toMatchObject({id:user,status:'pending',extensions:['0201']});
  memberExtensions.mockRejectedValueOnce(Error('PBX offline'));
  const offline=await app.inject({url:`/v1/organizations/${org}/members`,headers});
  expect(offline.statusCode).toBe(200);expect(offline.json().members[0].status).toBe('pending');
 }finally{await app.close();}
});
it('sorts assignments across all IAM pages before filtering and paginating',async()=>{
 const rows=Array.from({length:65},(_,i)=>({user_id:`30000000-0000-4000-8000-${String(i).padStart(12,'0')}`,name:`Person ${String(i).padStart(2,'0')}`,email:`person${i}@example.com`,role_id:i%2?'admin':'member',status:i%3?'active':'pending',can_edit_name:true,can_edit_access:true,can_edit_role:true}));
 const settings=vi.fn(async(_token:string,path:string)=>{const start=Number(new URL(path,'https://test').searchParams.get('offset'));return rows.slice(start,start+50);});
 const directory=vi.fn(async(_org:string,emails:string[])=>Object.fromEntries(emails.map(email=>[email,{extensions:[String(300-Number(/person(\d+)/.exec(email)![1]))],phone_numbers:[]}])));
 const app=buildApp({issuer:'https://iam.example',clientId:'platform',iamApi:'https://iam.example'},{verify:async()=>({userId:actor}),context:async()=>({user_id:actor,organization_id:org,name:'Org',role_id:'owner',membership_status:'active',organization_status:'active'}),settings,telephony:{memberDirectory:directory,close:async()=>{}} as unknown as TelephonyService});
 try{
  const headers={authorization:'Bearer test'},url=`/v1/organizations/${org}/members?sort=extension&role=member&status=active&limit=20`;
  const response=await app.inject({url,headers});expect(response.statusCode).toBe(200);
  expect(response.json().members[0].name).toBe('Person 64');expect(response.json().members).toHaveLength(20);expect(response.json().nextOffset).toBe(20);
  expect(settings).toHaveBeenCalledTimes(2);expect(directory.mock.calls[0]?.[1]).toHaveLength(65);
  directory.mockRejectedValueOnce(Error('PBX offline'));
  expect((await app.inject({url,headers})).statusCode).toBe(503);
 }finally{await app.close();}
});
it('enriches the platform organization member list with scoped PBX numbers and clears stale data when disabled or unavailable',async()=>{
 const {memberTelephonyDirectory}=await import('../apps/api/src/telephony/member-extensions');
 const archived='30000000-0000-4000-8000-000000000002';
 let admin=false,enabled=true,offline=false;
 const users=vi.fn(async()=>[{domain:'pbx',user:'201',email:'INVITEE@example.com','user-scope':'Basic User'}]);
 const numbers=vi.fn(async()=>[{domain:'pbx',phonenumber:'12165550100','dial-rule-application':'to-user-residential','dial-rule-translation-destination-host':'pbx','dial-rule-translation-destination-user':'201'}]);
 const directory=memberTelephonyDirectory(async id=>{if(offline)throw Error('Offline');return enabled&&id===org?{domain:'pbx'}:undefined;},users,numbers);
 const memberDirectory=vi.fn(directory);
 const stale={extensions:['999'],phone_numbers:['12165550999'],telephony_unavailable:true};
 const app=buildApp({issuer:'https://iam.example',clientId:'platform',iamApi:'https://iam.example'},{
  verify:async()=>({userId:actor}),identity:async()=>({user_id:actor,email:'admin@example.com',display_name:'Admin',platform_admin:admin}),
  settings:async()=>({id:org,name:'Organization',revision:'v1',member_list:[
   {id:user,name:'Invitee',email:'invitee@example.com',role:'member',status:'pending',...stale},
   {id:archived,name:'Archived',email:'old@example.com',role:'member',status:'archived',...stale},
  ]}),telephony:{memberDirectory,close:async()=>{}} as unknown as TelephonyService,
 });
 try{
  const headers={authorization:'Bearer test'},url=`/v1/platform/records/organizations/${org}`;
  expect((await app.inject({url,headers})).statusCode).toBe(403);expect(memberDirectory).not.toHaveBeenCalled();
  admin=true;const result=await app.inject({url,headers});expect(result.statusCode).toBe(200);
  expect(result.json().member_list[0]).toMatchObject({extensions:['201'],phone_numbers:['12165550100'],telephony_unavailable:false});
  expect(result.json().member_list[1]).toMatchObject({extensions:[],phone_numbers:[],telephony_unavailable:false});
  expect(memberDirectory).toHaveBeenLastCalledWith(org,['invitee@example.com']);
  users.mockClear();numbers.mockClear();enabled=false;
  const disabled=await app.inject({url,headers});expect(disabled.json().member_list[0]).toMatchObject({extensions:[],phone_numbers:[],telephony_unavailable:false});
  expect(users).not.toHaveBeenCalled();expect(numbers).not.toHaveBeenCalled();
  offline=true;const failed=await app.inject({url,headers});expect(failed.statusCode).toBe(200);
  expect(failed.json().member_list[0]).toMatchObject({extensions:[],phone_numbers:[],telephony_unavailable:true});
  expect(failed.json().member_list[1].telephony_unavailable).toBe(false);
 }finally{await app.close();}
});
