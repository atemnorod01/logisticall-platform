import {it,expect,vi} from 'vitest';
import {memberExtensionDirectory,memberTelephonyDirectory} from '../../apps/api/src/telephony/member-extensions';

it('matches exact normalized emails in the selected domain and excludes non-user resources',async()=>{
 const read=vi.fn(async(domain:string)=>[
  {email:' Person@Example.com ',user:domain==='one'?'0201':'701','user-scope':'Basic User'},
  {email:'person@example.com',user:'202','user-scope':'Office Manager'},
  {email:'person@example.com',user:'202','user-scope':'Office Manager'},
  {email:'person@example.com',user:'9999','user-scope':'No Portal'},
  {email:'blank@replaceme.com',user:'001','user-scope':'Basic User'},
  {email:'',user:'002','user-scope':'Basic User'},
 ]);
 const lookup=memberExtensionDirectory(async org=>({domain:org}),read);
 expect(await lookup('one',['person@example.com','other@example.com','blank@replaceme.com'])).toEqual({'person@example.com':['0201','202'],'other@example.com':[],'blank@replaceme.com':[]});
 expect((await lookup('two',['person@example.com']))['person@example.com']).toEqual(['202','701']);
 expect(read.mock.calls.map(c=>c[0])).toEqual(['one','two']);
});

it('resolves existing residential routes and new direct routes to the same member without guessing from caller ID',async()=>{
 const number=(phone:string,application='to-user-residential',host='pbx',domain='pbx',destination='201')=>({
  phonenumber:phone,domain,'dial-rule-application':application,
  'dial-rule-translation-destination-host':host,'dial-rule-translation-destination-user':destination,
 });
 const lookup=memberTelephonyDirectory(async()=>({domain:'pbx'}),async()=>[
  {domain:'pbx',email:'Person@Example.com',user:'201','user-scope':'Basic User','caller-id-number':'12165550999'},
  {domain:'pbx',email:'attendant@example.com',user:'44444','user-scope':'No Portal'},
  {domain:'pbx',email:'inventory@example.com',user:'9999','user-scope':'Basic User'},
  {domain:'other',email:'person@example.com',user:'202','user-scope':'Basic User'},
 ],async()=>[
  number('12165550100'),number('12165550101','to-user'),number('12165550100'),
  number('12165550102','call-queue'),number('12165550103','to-user','other'),
  number('12165550104','to-user','pbx','other'),number('12165550105','to-user','pbx','pbx','44444'),
  number('12165550106','to-user','pbx','pbx','9999'),number('12165550107','to-user','pbx','pbx','202'),
 ]);
 expect(await lookup('org',['person@example.com','attendant@example.com','inventory@example.com'])).toEqual({
  'person@example.com':{extensions:['201'],phone_numbers:['12165550100','12165550101']},
  'attendant@example.com':{extensions:[],phone_numbers:[]},'inventory@example.com':{extensions:[],phone_numbers:[]},
 });
});

it('coalesces cached reads but rechecks enablement, binding changes, expiration and failures',async()=>{
 let clock=0,domain:string|undefined='one';
 const source=vi.fn(async()=>[{email:'person@example.com',user:'201','user-scope':'Basic User'}]);
 const binding=vi.fn(async()=>domain?{domain}:undefined);
 const lookup=memberExtensionDirectory(binding,source,()=>clock);
 await Promise.all([lookup('org',['person@example.com']),lookup('org',['person@example.com'])]);
 expect(source).toHaveBeenCalledTimes(1);
 domain=undefined;expect(await lookup('org',['person@example.com'])).toEqual({});
 domain='two';await lookup('org',[]);expect(source).toHaveBeenCalledTimes(2);
 clock=61000;source.mockRejectedValueOnce(Error('unavailable'));
 await expect(lookup('org',[])).rejects.toThrow('unavailable');
 await lookup('org',[]);expect(source).toHaveBeenCalledTimes(4);
 expect(binding).toHaveBeenCalledTimes(6);
});
