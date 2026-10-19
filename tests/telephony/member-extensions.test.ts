import {it,expect,vi} from 'vitest';
import {memberExtensionDirectory} from '../../apps/api/src/telephony/member-extensions';

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
