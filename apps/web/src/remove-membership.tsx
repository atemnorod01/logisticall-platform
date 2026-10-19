import {formatMemberPhone} from './member-phone';
import { createPortal } from 'react-dom';
import './styles/membership-removal.css';
import { useEffect, useState, useRef, useId } from 'react';
import { memberArchivePreview } from '../../../packages/types/src/settings.js';
import type { z } from 'zod';
export function RemoveMembership({organizationId,userId,name,status,csrf,disabled,onRemoved,onError,deferPreview=false}:{organizationId:string;userId:string;name:string;status:'pending'|'suspended';csrf:string;disabled:boolean;onRemoved:()=>void;onError:(message:string)=>void;deferPreview?:boolean}) {
 const [options,setOptions]=useState<z.infer<typeof memberArchivePreview>>(),[confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0),[requested,setRequested]=useState(false);
 const setError=onError;
 const path=`/v1/organizations/${organizationId}/members/${userId}`;
 const revoking=status==='pending',action=revoking?'revoke':'delete';
 useEffect(()=>{if(deferPreview&&!requested)return;const abort=new AbortController();setOptions(undefined);void fetch(path+'/removal',{credentials:'same-origin',cache:'no-store',signal:abort.signal}).then(async r=>{if(!r.ok)throw Error();const value=memberArchivePreview.parse(await r.json());if(!abort.signal.aborted){setOptions(value);if(deferPreview&&requested){if(value.can_remove&&value.action===action)setConfirm(true);else setError(value.reason??'Refresh this member before removing them.');}}}).catch(()=>{if(!abort.signal.aborted)setError('Removal options could not be loaded. Close and reopen this member to try again.');});return()=>abort.abort();},[path,revision,status,deferPreview,requested]);
 return <div className="membership-remove-action"><button type="button" className="membership-remove-trigger" title={options?.reason??undefined} disabled={disabled||busy||(!options?(!deferPreview||requested):(!options.can_remove||options.action!==action))} onClick={()=>{if(deferPreview&&!options)setRequested(true);else setConfirm(true);}}>{revoking?'Revoke':'Delete user'}</button>{confirm&&<MembershipConfirm revoking={revoking} extensions={options?.extensions??[]} numbers={options?.phone_numbers??[]} resume={options?.resume??false} name={name} organization="this organization" busy={busy} onCancel={()=>setConfirm(false)} onConfirm={()=>{if(!options?.can_remove||options.action!==action||busy||disabled)return;setBusy(true);setError('');void fetch(path,{method:'DELETE',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({membership_key:options.membership_key,preview_hash:options.preview_hash,expected_status:status})}).then(r=>{if(!r.ok)throw Error();onRemoved();}).catch(()=>{setError('The removal did not finish. Refresh the member, then retry to resume any completed steps.');setRevision(n=>n+1);setConfirm(false);}).finally(()=>setBusy(false));}}/>}</div>;
}
function MembershipConfirm({name,organization,busy,onCancel,onConfirm,extensions,numbers,resume,revoking}:{name:string;organization:string;busy:boolean;onCancel:()=>void;onConfirm:()=>void;extensions:string[];numbers:string[];resume:boolean;revoking:boolean}) {
 const ref=useRef<HTMLDialogElement>(null);
 const title=useId(),description=useId();
 useEffect(()=>{const dialog=ref.current!;const previous=document.activeElement as HTMLElement|null;dialog.showModal();return()=>{dialog.close();previous?.focus();};},[]);
 return createPortal(<dialog ref={ref} className="membership-confirm" aria-labelledby={title} aria-describedby={description} onCancel={e=>{e.preventDefault();e.stopPropagation();if(!busy)onCancel();}}>
   <div className="membership-confirm-body">
     <span className="membership-confirm-symbol" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><circle cx="9" cy="7" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M17 11h5"/></svg></span>
     <h2 id={title}>{revoking?'Revoke this invitation?':'Delete this user?'}</h2>
     <p id={description}><strong>{name}</strong>{revoking?' will be removed from ':' will lose access to '}<strong>{organization}</strong>.</p>
     {revoking&&<p className="membership-confirm-note">Their invitation will stop working.</p>}
     <p className="membership-confirm-note">Their membership will be archived. Their Platform account, call history, message history, and other organizations are retained.</p>
     {!!numbers.length&&<div className="membership-archive-resources"><strong>Return to unassigned · 9999</strong><ul>{numbers.map(n=><li key={n}>{formatMemberPhone(n)}</li>)}</ul></div>}
     {!!extensions.length&&<div className="membership-archive-resources"><strong>Delete extensions</strong><p>{extensions.join(', ')}</p><small>These extension numbers become available for another user.</small></div>}
     {resume&&<p role="status">A previous attempt needs to finish. Completed steps will be checked and kept.</p>}
   </div>
   <div className="membership-confirm-actions"><button type="button" autoFocus disabled={busy} onClick={onCancel}>Cancel</button><button type="button" className="membership-confirm-danger" disabled={busy} onClick={onConfirm}>{busy?(revoking?'Revoking…':'Deleting…'):resume?'Resume removal':revoking?'Revoke':'Delete user'}</button></div>
 </dialog>,document.body);
}
