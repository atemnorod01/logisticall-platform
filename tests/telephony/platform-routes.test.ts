import { it, expect, vi } from "vitest";
import { buildApp } from "../../apps/api/src/app";
import {
  disabledTelephony,
  type TelephonyService,
} from "../../apps/api/src/telephony/service";
const actor = "11111111-1111-4111-8111-111111111111",
  org = "22222222-2222-4222-8222-222222222222";
const record = {
  id: org,
  organization_id: org,
  name: "Existing organization",
  status: "active",
  revision: "1",
};
function setup(admin = true) {
  const service: TelephonyService = {
    canAccessTelephony:vi.fn(async()=>false),
    enabledOrganizationIds: vi.fn(async()=>[org]),
    previewDisable: vi.fn(async () => ({action:'terminate' as const,previewHash:'a'.repeat(64),description:'Remove resources',steps:[]})),
    disable: vi.fn(async () => ({...disabledTelephony,configured:true})),
    resources:vi.fn(async()=>({title:"Resources",fetchedAt:new Date().toISOString(),pending:false,fields:[],columns:[],rows:[]})),
    status: vi.fn(async () => ({ ...disabledTelephony, configured: true })),
    enable: vi.fn(async () => ({
      ...disabledTelephony,
      configured: true,
      enabled: true,
      state: "running" as const,
    })),
    integrations: vi.fn(async () => ({
      available: true,
      portaone: false,
      netsapiens: false,
      template: false,
      portaoneLogin: "",
      netsapiensClientId: "",
      netsapiensUsername: "",
      netsapiensExpiresAt: null,
      netsapiensError: null,
    })),
    configure: vi.fn(async () => {}),
    captureTemplate: vi.fn(async () => {}),
    test: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
  const request = vi.fn(async (_token: string, _path: string, _method?:string, _body?:unknown):Promise<unknown> => record);
  const app = buildApp(
    {
      issuer: "https://iam.example",
      clientId: "platform",
      iamApi: "https://iam.example",
    },
    {
      telephony: service,
      verify: async () => ({ userId: actor }),
      identity: async () => ({
        user_id: actor,
        email: "admin@example.test",
        display_name: "Admin",
        platform_admin: admin,
      }),
      settings: request,
    },
  );
  return { app, service, request };
}
const headers = { authorization: "Bearer admin" };
it("provisions only the existing verified organization and never calls IAM organization creation", async () => {
  const f = setup();
  const result = await f.app.inject({
    method: "POST",
    url: `/v1/platform/organizations/${org}/telephony`,
    headers,
    payload: { enabled: true },
  });
  expect(result.statusCode).toBe(202);
  expect(f.service.enable).toHaveBeenCalledWith(record, actor);
  expect(f.request).toHaveBeenCalledExactlyOnceWith(
    "admin",
    `/platform/records/organizations/${org}`,
  );
  await f.app.close();
});
it("silently assigns the next PBX extension to users added by platform administrators",async()=>{
  const f=setup(),invitation="33333333-3333-4333-8333-333333333333",user="44444444-4444-4444-8444-444444444444";
  vi.mocked(f.service.canAccessTelephony).mockResolvedValue(true);
  f.service.inviteMember=vi.fn(async(input,ensure)=>({...await ensure(),extension:input.extension??"101"}));
  f.request.mockImplementation(async(_token:string,path:string,method?:string):Promise<unknown>=>{
    if(path===`/platform/organizations/${org}/invitations`&&method==='POST')return {id:invitation};
    if(path===`/platform/invitations/${invitation}/link`)return {url:'https://iam.example/setup',expires_at:null,requires_sign_in:false};
    if(path===`/platform/records/organizations/${org}`)return {...record,member_list:[{id:user,name:'New Member',email:'new@example.com',role:'member',status:'pending'}]};
    return record;
  });
  const requestId="55555555-5555-4555-8555-555555555555";
  const result=await f.app.inject({method:'POST',url:`/v1/platform/organizations/${org}/invitations`,headers,payload:{name:'New Member',email:'new@example.com',role:'member',request_id:requestId}});
  expect(result.statusCode).toBe(200);
  expect(result.json()).toMatchObject({id:invitation,user_id:user,extension:'101',link:{url:'https://iam.example/setup'}});
  expect(f.service.inviteMember).toHaveBeenCalledWith({organizationId:org,requestId,name:'New Member',email:'new@example.com'},expect.any(Function));
  await f.app.close();
});
it("rejects off switches and provider identifiers supplied by the browser", async () => {
  const f = setup();
  for (const payload of [
    { enabled: false },
    { enabled: true, portaoneId: "291127" },
  ])
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: `/v1/platform/organizations/${org}/telephony`,
          headers,
          payload,
        })
      ).statusCode,
    ).toBe(400);
  expect(f.service.enable).not.toHaveBeenCalled();
  await f.app.close();
});
it("rejects tenant admins and impersonation on provider settings and provisioning", async () => {
  const f = setup(false);
  for (const url of [
    `/v1/platform/organizations/${org}/telephony`,
    "/v1/platform/telephony/integrations",
  ])
    expect((await f.app.inject({ url, headers })).statusCode).toBe(403);
  expect(
    (
      await f.app.inject({
        method: "PUT",
        url: "/v1/platform/telephony/integrations/portaone",
        headers,
        payload: { login: "x", token: "secret" },
      })
    ).statusCode,
  ).toBe(403);
  expect(f.service.configure).not.toHaveBeenCalled();
  await f.app.close();
  const admin = setup();
  expect(
    (
      await admin.app.inject({
        url: "/v1/platform/telephony/integrations",
        headers: { ...headers, "x-iam-impersonation": actor },
      })
    ).statusCode,
  ).toBe(403);
  await admin.app.close();
});
it("forwards credentials only to approved provider adapters and returns no secrets", async () => {
  const f = setup();
  const response = await f.app.inject({
    method: "PUT",
    url: "/v1/platform/telephony/integrations/portaone",
    headers,
    payload: { login: "operator", token: "private-token" },
  });
  expect(response.json()).toEqual({ ok: true });
  expect(f.service.configure).toHaveBeenCalledWith(
    "portaone",
    { login: "operator", token: "private-token" },
    actor,
  );
  expect(
    (
      await f.app.inject({
        method: "PUT",
        url: "/v1/platform/telephony/integrations/other",
        headers,
        payload: {},
      })
    ).statusCode,
  ).toBe(400);
  await f.app.close();
});
it("rejects mismatched IAM organization records before provisioning", async () => {
  const f = setup();
  f.request.mockResolvedValue({ ...record, organization_id: actor });
  expect(
    (
      await f.app.inject({
        method: "POST",
        url: `/v1/platform/organizations/${org}/telephony`,
        headers,
        payload: { enabled: true },
      })
    ).statusCode,
  ).toBe(409);
  expect(f.service.enable).not.toHaveBeenCalled();
  await f.app.close();
});
it('resource reads use only saved mappings after verifying the IAM organization',async()=>{
 const f=setup();expect((await f.app.inject({url:`/v1/platform/organizations/${org}/telephony/netsapiens/users`,headers})).statusCode).toBe(200);expect(f.service.resources).toHaveBeenCalledWith(org,'netsapiens','users');
 expect((await f.app.inject({url:`/v1/platform/organizations/${org}/telephony/netsapiens/users?domain=other`,headers})).statusCode).toBe(400);
 expect((await f.app.inject({url:`/v1/platform/organizations/${org}/telephony/portaone/secrets`,headers})).statusCode).toBe(400);await f.app.close();
 const denied=setup(false);expect((await denied.app.inject({url:`/v1/platform/organizations/${org}/telephony/netsapiens/users`,headers})).statusCode).toBe(403);expect(denied.service.resources).not.toHaveBeenCalled();await denied.app.close();
});
it("requires explicit disable confirmation and passes only canonical organization identity", async () => {
  const f=setup();
  const preview=await f.app.inject({url:`/v1/platform/organizations/${org}/telephony/disable-preview`,headers});
  expect(preview.statusCode).toBe(200);
  for(const payload of [{enabled:false},{enabled:false,confirmed:false,previewHash:'a'.repeat(64)}])expect((await f.app.inject({method:'POST',url:`/v1/platform/organizations/${org}/telephony`,headers,payload})).statusCode).toBe(400);
  expect(f.service.disable).not.toHaveBeenCalled();
  expect((await f.app.inject({method:'POST',url:`/v1/platform/organizations/${org}/telephony`,headers,payload:{enabled:false,confirmed:true,previewHash:'a'.repeat(64)}})).statusCode).toBe(200);
  expect(f.service.disable).toHaveBeenCalledWith(record,actor,'a'.repeat(64));await f.app.close();
});
it('annotates organization rows and filters before paginating across IAM pages',async()=>{
 const f=setup();
 vi.mocked(f.service.enabledOrganizationIds).mockResolvedValue(['enabled-a','enabled-b','enabled-c']);
 f.request.mockImplementation(async(_token:string,path:string)=>{
   const offset=Number(new URL(path,'https://iam.example').searchParams.get('offset'));
   if(offset===0)return {rows:[{id:'disabled',name:'Disabled'},{id:'enabled-a',name:'A'}],nextOffset:2} as any;
   if(offset===2)return {rows:[{id:'enabled-b',name:'B'}],nextOffset:3} as any;
   return {rows:[{id:'enabled-c',name:'C'}],nextOffset:null} as any;
 });
 const all=await f.app.inject({url:'/v1/platform/organizations',headers});expect(all.json().rows.map((r:any)=>r.telephony_enabled)).toEqual([false,true]);
 const first=await f.app.inject({url:'/v1/platform/organizations?telephony_only=true&limit=2',headers});
 expect(first.json().rows.map((r:any)=>r.id)).toEqual(['enabled-a','enabled-b']);expect(first.json().nextOffset).toBe(2);
 const second=await f.app.inject({url:'/v1/platform/organizations?telephony_only=true&limit=2&offset=2',headers});
 expect(second.json().rows.map((r:any)=>r.id)).toEqual(['enabled-c']);expect(second.json().nextOffset).toBeNull();await f.app.close();
});
