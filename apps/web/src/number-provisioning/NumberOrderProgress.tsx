import {numberWorkflowMessage} from './customer-language';
import {visibleInterval} from './visible-poll';
import {useEffect,useRef,useState} from 'react';
import {useBuyRequest} from './number-purchase-api';
import {displayNumber,isNumberOrderActive,numberOrderLabel,orderStatusLabel,numberStatusLabel,type NumberOrder,type NumberOrderStep} from './models/number-purchase-model';
export function NumberOrderProgress({initial,onUpdate}:{initial:NumberOrder;onUpdate?:(()=>void)|undefined}){
 const buyRequest=useBuyRequest();
 const [order,setOrder]=useState(initial),[error,setError]=useState(''),[resuming,setResuming]=useState(false);
 useEffect(()=>{setOrder(initial);},[initial]);
 useEffect(()=>{
  if(!isNumberOrderActive(order)&&order.status!=='REVIEW_REQUIRED')return;
  let active=true;const tick=()=>buyRequest<NumberOrder>('/orders/'+order.id).then(next=>{if(active){setOrder(next);setError('');if(next.updatedAt!==order.updatedAt)onUpdate?.();}}).catch(e=>{if(active)setError(e.message);});
  const timer=visibleInterval(()=>tick(),2000);return()=>{active=false;clearInterval(timer);};
 },[order.id,order.updatedAt,order.status,onUpdate]);
 async function resume(){setResuming(true);setError('');try{await buyRequest('/orders/'+order.id+'/resume',{method:'POST'});setOrder(await buyRequest<NumberOrder>('/orders/'+order.id));onUpdate?.();}catch(e){setError((e as Error).message);}finally{setResuming(false);}}
 function timestamp(step:NumberOrderStep){
  const times=order.numbers.map(n=>n.stepUpdatedAt?.[step]).filter((value):value is string=>!!value).sort();
  const latest=times.at(-1);
  const started=step==='bandwidth'?order.status!=='DRAFT':step==='opensips'?order.numbers.some(n=>n.opensips&&n.opensips.status!=='pending'):order.numbers.some(n=>n[step==='portaone'?'portaoneStatus':'netsapiensStatus']==='Complete');
  return <small className="tn-step-time">{latest?<>Updated <time dateTime={latest}>{new Date(latest).toLocaleString(undefined,{dateStyle:'short',timeStyle:'medium'})}</time></>:started?'Timestamp not recorded':'Not started'}</small>;
 }
 const failed=order.numbers.some(n=>n.status==='PROVISIONING_FAILED');
 const acquired=order.numbers.filter(n=>n.carrierStatus==='COMPLETE');
 const progress=(system:'portaoneStatus'|'netsapiensStatus')=>`${acquired.filter(n=>n[system]==='Complete').length} / ${order.numbers.length} complete`;
 const done=order.autoProvision?order.numbers.every(n=>n.status==='PROVISIONED'):order.status==='COMPLETE'&&(!order.opensipsRequired||order.numbers.every(n=>n.opensips?.status==='complete'));
 return <><p className="subtitle">{isNumberOrderActive(order)?'You can close this window. Progress is saved and the workflow continues automatically.':order.autoProvision?'Your numbers have been purchased. Setup progress is saved, and you can view their call destinations in Telephone Numbers.':'Purchase progress is saved. Assign completed numbers to an organization from Telephone Numbers.'}</p><div className="tn-order-status"><span className={`badge ${failed||order.status==='ERROR'||order.status==='REVIEW_REQUIRED'?'failed':done?'completed':'running'}`}>{numberOrderLabel(order)}</span><span>{order.destinationLabel}</span></div>
 <ol className="tn-system-progress">
  <li><strong>1. Purchase numbers</strong><span>{orderStatusLabel[order.status]}</span>{timestamp('bandwidth')}</li>
  {order.opensipsRequired&&<li><strong>2. Set up call routing</strong><span>{acquired.filter(n=>n.opensips?.status==='complete').length} / {order.numbers.length} complete</span>{timestamp('opensips')}</li>}
  {order.autoProvision?<><li><strong>{order.opensipsRequired?3:2}. Activate numbers</strong><span>{progress('portaoneStatus')}</span>{timestamp('portaone')}</li><li><strong>{order.opensipsRequired?4:3}. Connect phone system</strong><span>{progress('netsapiensStatus')}</span>{timestamp('netsapiens')}</li></>:<li><strong>Organization assignment</strong><span>Separate step from inventory</span></li>}
 </ol>
 <div className="tn-order-numbers">{order.numbers.map(n=><div key={n.phone_number}><strong className="tn-mono">{displayNumber(n.phone_number)}</strong><span>{numberStatusLabel[n.status]}</span>{order.autoProvision&&<small>Purchase: {n.carrierStatus} · Activation: {n.portaoneStatus} · Phone system: {n.netsapiensStatus}</small>}{order.opensipsRequired&&<small>Call routing: {n.opensips?.status??'pending'}</small>}{n.provisioningError&&<small className="error">{numberWorkflowMessage(n.provisioningError)}</small>}</div>)}</div>{(order.error||error)&&<p className="error" role="alert">{numberWorkflowMessage(order.error||error)}</p>}{failed&&<button className="secondary" disabled={resuming} onClick={()=>void resume()}>{resuming?'Resuming…':'Resume provisioning'}</button>}</>;
}
export function NumberOrderDialog({order,onClose,onUpdate}:{order:NumberOrder;onClose:()=>void;onUpdate?:(()=>void)|undefined}){
 const [copied,setCopied]=useState(false),[copyError,setCopyError]=useState('');
 useEffect(()=>{if(!copied)return;const timer=setTimeout(()=>setCopied(false),2000);return()=>clearTimeout(timer);},[copied]);
 async function copyOrderId(){try{await navigator.clipboard.writeText(order.customerOrderId);setCopied(true);setCopyError('');}catch{setCopyError('Could not copy. Select the order ID to copy it manually.');}}
 const ref=useRef<HTMLDialogElement>(null);useEffect(()=>{ref.current?.showModal();},[]);
 return <dialog ref={ref} className="tn-confirm" aria-labelledby="saved-order-title" onClose={onClose} onClick={e=>{const r=e.currentTarget.getBoundingClientRect();if(e.target===e.currentTarget&&(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom))ref.current?.close();}}><div className="tn-confirm-body"><div className="tn-order-heading"><h2 id="saved-order-title">Order {order.customerOrderId}</h2><button type="button" className="secondary tn-copy-order" aria-label="Copy order ID" onClick={()=>void copyOrderId()}>{copied?'Copied!':'Copy ID'}</button></div><span className="visually-hidden" role="status">{copied?'Order ID copied':''}</span>{copyError&&<p className="error" role="alert">{copyError}</p>}<NumberOrderProgress initial={order} onUpdate={onUpdate}/></div><div className="tn-confirm-footer"><button className="secondary" onClick={()=>ref.current?.close()}>Close</button></div></dialog>;
}
