import {numberWorkflowMessage} from './customer-language';
import {visibleInterval} from './visible-poll';
import {useEffect,useRef,useState} from 'react';
import type {AssignmentView} from './models/number-assignment-model';
import {displayNumber} from './models/number-purchase-model';
import {useBuyRequest} from './number-purchase-api';
export function NumberUnassignmentDialog({assignment,assignments,onClose,onUpdated}:{assignment?:AssignmentView;assignments?:AssignmentView[];onClose:()=>void;onUpdated:()=>void}){
 const buyRequest=useBuyRequest();
 const dialog=useRef<HTMLDialogElement>(null),[current,setCurrent]=useState(()=>assignments??[assignment!]),[sending,setSending]=useState(false),[error,setError]=useState('');
 const completed=current.filter(a=>a.status==='unassigned').length,done=completed===current.length,active=sending||current.some(a=>a.active),started=current.some(a=>a.unassignment);
 const callback=useRef(onUpdated);callback.current=onUpdated;
 useEffect(()=>{dialog.current?.showModal();},[]);
 const ids=current.map(a=>a.id).join(',');
 useEffect(()=>{
  if(!current.some(a=>a.active))return;let mounted=true,inFlight=false;
  const tick=async()=>{if(inFlight)return;inFlight=true;try{const data=await buyRequest<{assignments:AssignmentView[]}>('/assignments');const next=current.map(a=>data.assignments.find(r=>r.id===a.id)??a);if(mounted){setCurrent(next);setError('');if(!next.some(a=>a.active))callback.current();}}catch(e){if(mounted)setError((e as Error).message);}finally{inFlight=false;}};
  const timer=visibleInterval(()=>tick(),1000);void tick();return()=>{mounted=false;clearInterval(timer);};
 },[ids,current.some(a=>a.active)]);
 async function submit(){setSending(true);setError('');try{
  const result=await buyRequest<{assignments:AssignmentView[]}>('/assignments/unassign',{method:'POST',body:JSON.stringify({assignmentIds:current.map(a=>a.id),...(new Set(current.map(a=>a.organizationId)).size===1?{organizationId:current[0]!.organizationId}:{}),confirmed:true})});setCurrent(result.assignments);callback.current();
 }catch(e){setError((e as Error).message);}finally{setSending(false);}}
 return <dialog ref={dialog} className="tn-confirm tn-return-dialog" aria-labelledby="return-number-title" onClose={e=>{if(e.target===e.currentTarget)onClose();}}>
  <div className="tn-confirm-body"><p className="eyebrow">UNASSIGN NUMBERS</p><h2 id="return-number-title">{started?`${completed} of ${current.length} unassigned`:`Unassign ${current.length} ${current.length===1?'number':'numbers'}?`}</h2><p className="subtitle">{[...new Set(current.map(a=>a.organizationName))].join(', ')}</p>
   {!started&&<p>Remove the selected numbers from their organizations’ phone systems. They will no longer receive calls for their organizations.</p>}
   <p className="tn-help">The numbers stay in platform inventory for future assignment.</p>
   <ul className="tn-return-results" aria-live="polite">{current.map(a=>{const u=a.unassignment;return <li key={a.id}><div><strong>{displayNumber(a.number)}</strong><span>{a.status==='unassigned'?'Unassigned':a.active?u?.step==='checking'?'Queued / checking':'Unassigning…':u?'Needs attention':''}</span></div>{u&&<small>Number assignment: {u.portaone==='retained'?'history retained':u.portaone==='complete'?'removed':'pending'} · Phone system: {u.netsapiens==='complete'?'removed':'pending'}</small>}{u?.error&&<p className="error">{numberWorkflowMessage(u.error)}</p>}</li>;})}</ul>
   {done&&<p className="notice" role="status">All selected numbers are available in inventory.</p>}
   {error&&<p className="error" role="alert">{numberWorkflowMessage(error)}</p>}
   {active&&<p role="status">You can close this window. All selected numbers continue processing.</p>}
   {started&&!active&&!done&&<p>Unfinished numbers remain linked. Resume checks their saved progress; completed numbers are skipped.</p>}
  </div>
  <div className="tn-confirm-footer"><button className="secondary" disabled={sending} onClick={()=>dialog.current?.close()}>{active||started?'Close':'Cancel'}</button>{!done&&<button className="primary" disabled={active} onClick={()=>void submit()}>{active?'Unassigning…':started?'Resume remaining':`Unassign ${current.length} ${current.length===1?'number':'numbers'}`}</button>}</div>
 </dialog>;
}
