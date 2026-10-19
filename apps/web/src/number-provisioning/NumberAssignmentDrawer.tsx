import {numberWorkflowMessage} from './customer-language';
import {visibleInterval} from './visible-poll';
import {NumberUnassignmentDialog} from './NumberUnassignmentDialog';
import type {NumberRouting} from './models/number-routing';
import {useEffect,useRef,useState} from 'react';
import {useBuyRequest} from './number-purchase-api';
import {displayNumber} from './models/number-purchase-model';
import type {AssignmentView} from './models/number-assignment-model';
export type AssignmentDestination={id:string;label:string;customerId:string;domain:string};
export function NumberAssignmentDrawer({number,initial,destinations,onClose,onUpdate}:{number:string;initial?:AssignmentView|undefined;destinations:AssignmentDestination[];onClose:()=>void;onUpdate:()=>void}){
 const buyRequest=useBuyRequest();
 const [returning,setReturning]=useState(false);
 const dialog=useRef<HTMLDialogElement>(null);const [assignment,setAssignment]=useState(initial),[organizationId,setOrganizationId]=useState(initial?.organizationId??''),[submitting,setSubmitting]=useState(false),[error,setError]=useState('');
 const [liveRouting,setLiveRouting]=useState<NumberRouting>(),[routingLoading,setRoutingLoading]=useState(false),[routingError,setRoutingError]=useState('');
 useEffect(()=>{
  if(!assignment)return;const abort=new AbortController();setLiveRouting(undefined);setRoutingError('');setRoutingLoading(true);
  buyRequest<{routing:Record<string,NumberRouting>}>(`/routing?organizationId=${encodeURIComponent(assignment.organizationId)}`,{signal:abort.signal}).then(data=>{if(!abort.signal.aborted)setLiveRouting(data.routing[assignment.id]);}).catch(e=>{if(!abort.signal.aborted)setRoutingError(e.message);}).finally(()=>{if(!abort.signal.aborted)setRoutingLoading(false);});
  return()=>abort.abort();
 },[assignment?.id,assignment?.status,assignment?.active]);
 const destinationText=routingLoading?'Checking current PBX destination…':routingError||liveRouting?.netsapiens.error||(liveRouting?.netsapiens.destination?[liveRouting.netsapiens.destination,liveRouting.netsapiens.destinationName].filter(Boolean).join(' · '):'Unable to verify');
 const active=submitting||!!assignment?.active;
 const complete=assignment?.status==='complete',terminated=assignment?.status==='terminated';
 const canRetarget=assignment?.status==='failed'&&!assignment.pendingCreate&&assignment.portaone==='pending'&&assignment.netsapiens==='pending';
 useEffect(()=>{dialog.current?.showModal();},[]);
 useEffect(()=>{
  if(!assignment?.active)return;
  let live=true;const tick=async()=>{try{const response=await buyRequest<{assignments:AssignmentView[]}>('/assignments');const next=response.assignments.find(a=>a.id===assignment.id);if(live&&next){setAssignment(next);setError('');if(!next.active)onUpdate();}}catch(e){if(live)setError((e as Error).message);}};
  const timer=visibleInterval(()=>tick(),1500);void tick();return()=>{live=false;clearInterval(timer);};
 },[assignment?.id,assignment?.active,onUpdate]);
 async function assign(){
  setSubmitting(true);setError('');
  try{const result=await buyRequest<AssignmentView>('/assignments',{method:'POST',body:JSON.stringify({number,organizationId,confirmed:true})});setAssignment(result);onUpdate();}catch(e){setError((e as Error).message);}finally{setSubmitting(false);}
 }
 const selected=destinations.find(o=>o.id===organizationId);
 return <dialog ref={dialog} className="integration-drawer tn-assign-drawer" aria-labelledby="tn-assignment-title" onClose={e=>{if(e.target===e.currentTarget)onClose();}} onClick={e=>{const r=e.currentTarget.getBoundingClientRect();if(e.target===e.currentTarget&&(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom))e.currentTarget.close();}}>
 <div className="drawer-heading"><div><p className="eyebrow">ORGANIZATION ASSIGNMENT</p><h2 id="tn-assignment-title">{displayNumber(number)}</h2></div><button autoFocus className="close" aria-label="Close number assignment" onClick={()=>dialog.current?.close()}>×</button></div>
 {returning&&assignment&&<NumberUnassignmentDialog assignment={assignment} onClose={()=>{setReturning(false);onUpdate();onClose();}} onUpdated={onUpdate}/>}
 <div className="drawer-content"><section className="tn-panel tn-destination"><label className="tn-label" htmlFor="assign-number-organization">Organization</label><select id="assign-number-organization" value={organizationId} disabled={(!!assignment&&!canRetarget)||active} onChange={e=>setOrganizationId(e.target.value)}><option value="">Select an organization</option>{destinations.map(o=><option value={o.id} key={o.id}>{o.label}</option>)}{assignment&&!selected&&<option value={assignment.organizationId}>{assignment.organizationName}</option>}</select>{!destinations.length&&!assignment&&<p className="tn-help">Enable telephony for an organization first.</p>}</section>
 {terminated?<p className="notice">Telephony has been terminated for this organization. These numbers are no longer connected to its phone system.</p>:<p>{assignment?.source==='existing'?'Existing assignment verified. The organization link is saved and the current call routing is preserved.':'Add this number to the organization’s phone system. New numbers initially route to 9999 — Unassigned Inventory when that attendant is available; otherwise they remain unassigned in PBX inventory.'}</p>}
 <ol className="tn-system-progress" aria-live="polite">
 <li><strong>1. Verify number ownership</strong><span>{assignment?.step==='checking'&&active?'Checking…':assignment?.masterAccountId?'Verified':'Ownership checked before provisioning'}</span></li>
 <li><strong>2. Activate number</strong><span>{assignment?.portaone==='complete'?'Complete':assignment?.step==='portaone'&&active?'Creating and verifying…':'Pending'}</span><small>Hosted PBX account {selected?'0208'+selected.customerId:assignment?'0208'+assignment.customerId:'for the selected organization'}</small></li>
 <li><strong>3. Connect phone system</strong><span>{terminated?'Removed':assignment?.netsapiens==='complete'?'Complete':assignment?.step==='netsapiens'&&active?'Adding and verifying…':'Pending'}</span><small>Domain {selected?.domain??assignment?.domain??'for the selected organization'} · {assignment?`Current destination: ${numberWorkflowMessage(destinationText)}`:'Routes to Unassigned Inventory (9999) when available'}</small></li>
 </ol>
 {complete&&<p className="notice" role="status">Assigned to {assignment.organizationName}. Current PBX destination: {numberWorkflowMessage(destinationText)}.</p>}
 {(error||assignment?.error)&&<div className="error" role="alert">{numberWorkflowMessage(error||assignment?.error)}</div>}
 {assignment&&!active&&!complete&&!terminated&&<p className="tn-help">Saved progress is retained. Resume checks the saved setup before continuing.</p>}
 {active&&<p className="tn-help" role="status">Provisioning is running. You can close this drawer and return to view its progress.</p>}
 </div><div className="drawer-footer"><button className="secondary" onClick={()=>dialog.current?.close()}>Close</button>{complete&&<button className="secondary" disabled={active} onClick={()=>setReturning(true)}>{assignment.unassignment?'Resume return':'Return to inventory'}</button>}{!complete&&!terminated&&<button className="primary" disabled={!organizationId||active} onClick={()=>void assign()}>{active?'Provisioning…':assignment?'Resume assignment':'Confirm assignment'}</button>}</div>
 </dialog>;
}
