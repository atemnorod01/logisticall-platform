import {it,expect,vi} from 'vitest';
import {NetsapiensClient} from '../../apps/api/src/telephony/netsapiens';
import type {IntegrationVault} from '../../apps/api/src/telephony/integration-vault';
function fixture(){
 let users=[{domain:'123',user:'201',email:'person@example.com','user-scope':'Basic User','name-first-name':'Person','name-last-name':'Example','account-status':'standard'}];
 let numbers=[{domain:'123',phonenumber:'12165550100',enabled:'yes','dial-rule-description':'Direct number','dial-rule-application':'to-user','dial-rule-translation-destination-user':'201','dial-rule-translation-destination-host':'123'}];
 const writes:string[]=[];
 const request=vi.fn<typeof fetch>(async(input,init)=>{
  const path=new URL(String(input)).pathname.replace('/ns-api/v2','');
  if(init?.method==='PUT'){writes.push('route');Object.assign(numbers[0]!,JSON.parse(String(init.body)));return new Response(null,{status:202});}
  if(init?.method==='DELETE'){writes.push('delete');users=[];return new Response(null,{status:202});}
  if(path==='/domains/123')return Response.json({domain:'123',reseller:'289507'});
  if(path==='/domains/123/users')return Response.json(users);
  if(path==='/domains/123/phonenumbers')return Response.json(numbers);
  if(path==='/domains/123/autoattendants')return Response.json([{domain:'123',user:'9999','attendant-name':'Unassigned Inventory'}]);
  if(path==='/domains/123/users/9999')return Response.json({domain:'123',user:'9999','dial-plan':'123_9999'});
  if(path==='/domains/123/users/9999/answerrules/*')return Response.json({domain:'123',user:'9999',enabled:'yes','forward-always':{enabled:'yes',parameters:['Announce_999903']}});
  throw Error('Unexpected request '+path);
 });
 const vault={get:async()=>({clientId:'test',clientSecret:'test',accessToken:'test',refreshToken:'test',expiresAt:Date.now()+3600000,reseller:'289507'}),locked:async(_key:string,work:any)=>work(vault),put:async()=>{}} as unknown as IntegrationVault;
 const client=new NetsapiensClient(vault,request);
 return {client,writes,changeEmail:()=>{users[0]!.email='other@example.com';},changeRoute:()=>{numbers[0]!['dial-rule-translation-destination-user']='202';}};
}
const member={organizationId:'org',userId:'user',email:'person@example.com',membershipKey:'key'};
it('returns numbers to 9999 before deleting an extension, verifying each provider outcome',async()=>{
 const f=fixture(),snapshot=await f.client.memberArchiveResources('123',member);
 await expect(f.client.deleteMemberExtension(snapshot,snapshot.users[0]!)).rejects.toThrow('still has an assigned number');expect(f.writes).toEqual([]);
 await f.client.returnMemberNumber(snapshot,snapshot.numbers[0]!);
 await f.client.deleteMemberExtension(snapshot,snapshot.users[0]!);
 expect(f.writes).toEqual(['route','delete']);
 await f.client.returnMemberNumber(snapshot,snapshot.numbers[0]!,true);await f.client.deleteMemberExtension(snapshot,snapshot.users[0]!,true);
 expect(f.writes).toEqual(['route','delete']);
});
it('refuses changed ownership and does not replay an uncertain deletion or routing write',async()=>{
 const f=fixture(),snapshot=await f.client.memberArchiveResources('123',member);
 await expect(f.client.returnMemberNumber(snapshot,snapshot.numbers[0]!,true)).rejects.toThrow('unconfirmed');
 await expect(f.client.deleteMemberExtension(snapshot,snapshot.users[0]!,true)).rejects.toThrow('unconfirmed');
 f.changeEmail();await expect(f.client.deleteMemberExtension(snapshot,snapshot.users[0]!)).rejects.toThrow('ownership changed');
 f.changeRoute();await expect(f.client.returnMemberNumber(snapshot,snapshot.numbers[0]!)).rejects.toThrow('routing changed');
 expect(f.writes).toEqual([]);
});
