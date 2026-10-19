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
