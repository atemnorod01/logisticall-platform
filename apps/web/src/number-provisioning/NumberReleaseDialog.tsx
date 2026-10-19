import {numberWorkflowMessage} from './customer-language';
import {numberIntent,completeNumberIntent} from './request-intent';
import {visibleInterval} from './visible-poll';
import {useEffect,useRef,useState} from 'react';
import {useBuyRequest} from './number-purchase-api';
import {displayNumber} from './models/number-purchase-model';
import {releaseLabel,type NumberRelease} from './models/number-release-model';
export function NumberReleaseDialog({numbers,initial,onClose,onUpdated}:{numbers?:string[]|undefined;initial?:NumberRelease|undefined;onClose:()=>void;onUpdated:()=>void}){
 const buyRequest=useBuyRequest();
 const dialog=useRef<HTMLDialogElement>(null),requestId=useRef<string>(crypto.randomUUID()),callback=useRef(onUpdated);callback.current=onUpdated;
 const [order,setOrder]=useState(initial),[busy,setBusy]=useState(false),[error,setError]=useState(''),[confirm,setConfirm]=useState(false),[carrierId,setCarrierId]=useState(''),[copied,setCopied]=useState(false);
 const [notifications,setNotifications]=useState<{ready:boolean;message?:string}>({ready:false,message:'Checking release notifications…'});
 const selected=order?.numbers.map(n=>n.number)??numbers??[];
 useEffect(()=>{dialog.current?.showModal();},[]);
 useEffect(()=>{if(order)return;let live=true;const read=async()=>{try{const status=await buyRequest<{ready:boolean;message?:string}>('/notifications');if(live)setNotifications(status);}catch{if(live)setNotifications({ready:false,message:'Could not check release notifications. Please retry shortly.'});}};void read();const timer=visibleInterval(()=>read(),5000);return()=>{live=false;clearInterval(timer);};},[order?.id]);
 useEffect(()=>{if(!order||['complete','failed'].includes(order.status))return;let live=true,inFlight=false;const timer=visibleInterval(async()=>{if(inFlight)return;inFlight=true;try{const next=await buyRequest<NumberRelease>('/releases/'+order.id);if(live&&next){setOrder(next);if(next.updatedAt!==order.updatedAt)callback.current();}}catch{}finally{inFlight=false;}},3000);return()=>{live=false;clearInterval(timer);};},[order?.id,order?.updatedAt]);
 async function submit(){setBusy(true);setError('');try{requestId.current=numberIntent('release',null,selected);const r=await buyRequest<NumberRelease>('/releases',{method:'POST',body:JSON.stringify({requestId:requestId.current,numbers:selected,confirmed:true})});completeNumberIntent(requestId.current);setOrder(r);callback.current();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function check(){if(!order)return;setBusy(true);setError('');try{const data=await buyRequest<{release:NumberRelease}>(`/releases/${order.id}/check`,{method:'POST',body:JSON.stringify(carrierId.trim()?{carrierOrderId:carrierId.trim()}:{})});setOrder(data.release);callback.current();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <dialog ref={dialog} className="tn-confirm tn-return-dialog" aria-labelledby="release-title" onCancel={e=>{if(busy)e.preventDefault();}} onClose={e=>{if(e.target===e.currentTarget)onClose();}}>
  <div className="tn-confirm-body"><p className="eyebrow">RETURN TO CARRIER</p><h2 id="release-title">{order?releaseLabel(order):`Release ${selected.length} ${selected.length===1?'number':'numbers'}?`}</h2>
   {order?<><p className="tn-help">Order {order.customerOrderId} <button className="tn-text-action" onClick={()=>{void navigator.clipboard.writeText(order.customerOrderId).then(()=>setCopied(true)).catch(()=>setError('Could not copy the order ID.'));}}>{copied?'Copied':'Copy order ID'}</button></p>{order.carrierOrderId&&<p className="tn-help">Carrier order: {order.carrierOrderId}</p>}<p>1. Release numbers<br/>2. Remove call routing</p></>:<p>These numbers will be returned to the carrier and removed from your inventory. Call routing will be removed after the release is confirmed.</p>}
   <ul className="tn-return-results">{selected.map(number=>{const n=order?.numbers.find(n=>n.number===number);return <li key={number}><div><strong>{displayNumber(number)}</strong>{n&&<span>{n.carrier==='failed'?'Not released':n.cleanupUpdatedAt?'Returned':n.carrier==='released'?'Routing cleanup pending':'Release pending'}</span>}</div>{n&&<><small>Carrier: {n.carrier}{n.carrierUpdatedAt?` · ${new Date(n.carrierUpdatedAt).toLocaleString()}`:''}</small><small>Call routing: {n.opensips.status}{n.cleanupUpdatedAt?` · ${new Date(n.cleanupUpdatedAt).toLocaleString()}`:''}</small>{n.error&&<p className="error">{numberWorkflowMessage(n.error)}</p>}</>}</li>;})}</ul>
   {!order&&<p className="tn-help" role="status">{notifications.ready?'Release notifications are ready.':numberWorkflowMessage(notifications.message)}</p>}
   {!order&&<label className="release-confirm"><input type="checkbox" checked={confirm} onChange={e=>setConfirm(e.target.checked)}/>I understand these numbers are being released from our carrier account, not just unassigned from an organization.</label>}
   {order?.error&&<p className="error">{numberWorkflowMessage(order.error)}</p>}{error&&<p className="error" role="alert">{numberWorkflowMessage(error)}</p>}
   {order&&!order.carrierOrderId&&order.status==='review'&&<label>Carrier release order ID<input value={carrierId} onChange={e=>setCarrierId(e.target.value)} placeholder="Paste the existing order ID to verify"/><small>This checks the existing order; it never submits another disconnect.</small></label>}
   {order&&<p className="tn-help">Progress is saved. You can close this window and reopen this disconnect in Number Orders.</p>}
  </div>
  <div className="tn-confirm-footer"><button className="secondary" disabled={busy} onClick={()=>dialog.current?.close()}>{order?'Close':'Cancel'}</button>{order?<button className="secondary" disabled={busy} onClick={()=>void check()}>{busy?'Checking…':'Check status / retry cleanup'}</button>:<button className="primary" disabled={busy||!confirm||!selected.length||!notifications.ready} onClick={()=>void submit()}>{busy?'Submitting…':`Release ${selected.length} ${selected.length===1?'number':'numbers'}`}</button>}</div>
 </dialog>;
}
