import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { createNumberConsole, NumberConsoleContext } from './number-provisioning/console-api.js';
import { phoneRequest } from './phone-number-api.js';
import { numberContext, type NumberContext } from '../../../packages/types/src/phone-numbers.js';
import './styles/platform-phone-numbers.css';
const TelephoneNumbers = lazy(() => import('./number-provisioning/TelephoneNumbers.js').then(m => ({default:m.TelephoneNumbers})));
export function PlatformPhoneNumbers({csrf}:{csrf:string}) {
 const client=useMemo(()=>createNumberConsole(csrf),[csrf]);
 const [context,setContext]=useState<NumberContext>(),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{let active=true;phoneRequest(numberContext,'/context',csrf).then(c=>{if(active){setContext(c);setError('');}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[retry]);
 return <section className="admin lc-platform-admin lc-platform-number-page"><div className="lc-number-console">
 {error?<><h1>Phone numbers</h1><p role="alert">{error}</p><button onClick={()=>setRetry(n=>n+1)}>Retry</button></>:context?.configured?<Suspense fallback={<p role="status">Loading phone numbers…</p>}><NumberConsoleContext.Provider value={client}><TelephoneNumbers operations demo={context.demo}/></NumberConsoleContext.Provider></Suspense>:context?<><h1>Phone numbers</h1><p>Connect Telephony Provisioning to manage phone numbers.</p></>:<p role="status">Loading phone numbers…</p>}
 </div></section>;
}
