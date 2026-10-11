import { createPortal } from 'react-dom';
import './styles/membership-removal.css';
import { useEffect, useState, useRef, useId } from 'react';
import { membershipRemoval } from '../../../packages/types/src/settings.js';
import type { z } from 'zod';
export function RemoveMembership({organizationId,userId,name,csrf,disabled,onRemoved}:{organizationId:string;userId:string;name:string;csrf:string;disabled:boolean;onRemoved:()=>void}) {
 const [options,setOptions]=useState<z.infer<typeof membershipRemoval>>(),[confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 const path=`/v1/organizations/${organizationId}/members/${userId}`;
 useEffect(()=>{const abort=new AbortController();setOptions(undefined);void fetch(path+'/removal',{credentials:'same-origin',cache:'no-store',signal:abort.signal}).then(async r=>{if(!r.ok)throw Error();const value=membershipRemoval.parse(await r.json());if(!abort.signal.aborted)setOptions(value);}).catch(()=>{if(!abort.signal.aborted)setError('Removal availability could not be checked.');});return()=>abort.abort();},[path,revision]);
 return <section className="membership-remove-section"><div className="membership-remove-row"><div><strong>Remove membership</strong><p>Unlink this user from the organization.</p></div><button type="button" className="membership-remove-trigger" disabled={disabled||busy||!options?.can_remove} onClick={()=>setConfirm(true)}>Remove…</button></div>{options?.reason&&<p className="membership-remove-reason">{options.reason}</p>}{error&&<p role="alert">{error}</p>}{confirm&&<MembershipConfirm name={name} organization="this organization" busy={busy} onCancel={()=>setConfirm(false)} onConfirm={()=>{if(!options?.can_remove||busy||disabled)return;setBusy(true);setError('');void fetch(path,{method:'DELETE',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({membership_key:options.membership_key})}).then(r=>{if(!r.ok)throw Error();onRemoved();}).catch(()=>{setError('Removal failed. Please try again. If it still fails, reload this page.');setRevision(n=>n+1);setConfirm(false);}).finally(()=>setBusy(false));}}/>}</section>;
}
function MembershipConfirm({name,organization,busy,onCancel,onConfirm}:{name:string;organization:string;busy:boolean;onCancel:()=>void;onConfirm:()=>void}) {
 const ref=useRef<HTMLDialogElement>(null);
 const title=useId(),description=useId();
 useEffect(()=>{const dialog=ref.current!;const previous=document.activeElement as HTMLElement|null;dialog.showModal();return()=>{dialog.close();previous?.focus();};},[]);
 return createPortal(<dialog ref={ref} className="membership-confirm" aria-labelledby={title} aria-describedby={description} onCancel={e=>{e.preventDefault();e.stopPropagation();if(!busy)onCancel();}}>
   <div className="membership-confirm-body">
     <span className="membership-confirm-symbol" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><circle cx="9" cy="7" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M17 11h5"/></svg></span>
     <h2 id={title}>Remove from organization?</h2>
     <p id={description}><strong>{name}</strong> will lose access to <strong>{organization}</strong>.</p>
     <p className="membership-confirm-note">Their account and other memberships will stay.</p>
   </div>
   <div className="membership-confirm-actions"><button type="button" autoFocus disabled={busy} onClick={onCancel}>Cancel</button><button type="button" className="membership-confirm-danger" disabled={busy} onClick={onConfirm}>{busy?'Removing…':'Remove member'}</button></div>
 </dialog>,document.body);
}
