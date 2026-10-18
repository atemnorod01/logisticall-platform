import {createPortal} from 'react-dom';
import {useEffect, useId, useRef, useState, type CSSProperties} from 'react';
import {platformRecord, platformEdit} from '../../../packages/types/src/platform-admin.js';
import type {z} from 'zod';
import {Avatar} from './ui.js';
import {LoadingSkeleton} from './loading-skeleton.js';

export function PlatformUserModal({id,csrf,anchor,onClose,onSaved}:{
 id:string; csrf:string; anchor:HTMLElement; onClose:()=>void; onSaved:()=>void;
}) {
 const dialog=useRef<HTMLDialogElement>(null), title=useId(), lock=useRef(false);
 const [record,setRecord]=useState<z.infer<typeof platformRecord>|null>(null);
 const [name,setName]=useState(''),[status,setStatus]=useState('active');
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const [bounds,setBounds]=useState<CSSProperties>({});
 useEffect(()=>{
  const container=anchor.closest('.lc-platform-editor-panel, .lc-platform-content') ?? anchor;
  const measure=()=>{
   const rect=container.getBoundingClientRect();
   const width=Math.max(0,Math.min(520,rect.width-24,window.innerWidth-24));
   const left=Math.max(12,Math.min(rect.left+(rect.width-width)/2,window.innerWidth-width-12));
   const top=Math.max(12,Math.min(rect.top+24,window.innerHeight-320));
   setBounds({left,top,width,maxHeight:Math.max(0,window.innerHeight-top-12)});
  };
  measure();
  const observer=new ResizeObserver(measure);observer.observe(container);
  window.addEventListener('resize',measure);
  const modal=dialog.current;modal?.showModal();
  return ()=>{observer.disconnect();window.removeEventListener('resize',measure);modal?.close();if(anchor.isConnected)anchor.focus();};
 },[anchor]);
 useEffect(()=>{
  const abort=new AbortController();
  fetch(`/v1/platform/records/users/${encodeURIComponent(id)}`,{signal:abort.signal})
   .then(async response=>{
    if(!response.ok)throw Error('Could not load this user. Close and try again.');
    return platformRecord.parse(await response.json());
   }).then(user=>{if(!abort.signal.aborted){setRecord(user);setName(user.name);setStatus(user.status??'active');}})
   .catch(error=>{if(!abort.signal.aborted)setError(error.message);});
  return ()=>abort.abort();
 },[id]);
 const dirty=!!record&&(name.trim()!==record.name||status!==record.status);
 async function save(event:React.FormEvent){
  event.preventDefault();event.stopPropagation();
  if(!record||lock.current||!dirty)return;
  const input=platformEdit.safeParse({kind:'user',revision:record.revision,name,status});
  if(!input.success){setError('Enter a valid display name.');return;}
  lock.current=true;setBusy(true);setError('');
  try{
   const response=await fetch(`/v1/platform/records/users/${encodeURIComponent(id)}`,{
    method:'PATCH',headers:{'content-type':'application/json','x-csrf-token':csrf},body:JSON.stringify(input.data),
   });
   if(!response.ok)throw Error(response.status===409?'This user changed while you were editing. Close and reopen before saving.':response.status===403?'You cannot make this change with your current access.':'Could not save changes. Please try again.');
   platformRecord.parse(await response.json());
   onSaved();
  }catch(error){setError((error as Error).message);}
  finally{lock.current=false;setBusy(false);}
 }
 return createPortal(<dialog ref={dialog} className="lc-platform-user-modal" style={bounds} aria-labelledby={title}
  onCancel={event=>{event.preventDefault();if(!lock.current)onClose();}}>
  <form onSubmit={event=>void save(event)} aria-busy={busy}>
   <header className="lc-member-editor-heading">
    <h2 id={title}>Edit user</h2>
    <button type="button" className="button" aria-label="Close user editor" disabled={busy} onClick={onClose}>×</button>
   </header>
   <div className="lc-platform-user-modal-body">
    {error&&<p role="alert">{error}</p>}
    {!record&&!error&&<LoadingSkeleton variant="details" rows={3}/>}
    {record&&<>
     <div className="lc-member-row"><Avatar name={record.name||record.email||'User'}/><div><strong>{record.name}</strong><small>{record.email}</small></div></div>
     <div className="lc-platform-fields">
      <label>Display name<input value={name} maxLength={100} required disabled={busy} onChange={event=>setName(event.target.value)}/></label>
      <label>Sign-in email<input value={record.email??''} type="email" readOnly/></label>
      <label>Account status<select value={status} disabled={busy||record.platform_admin} onChange={event=>setStatus(event.target.value)}><option value="active">Active</option><option value="suspended">Suspended</option></select></label>
     </div>
     <p className="lc-muted">{record.platform_admin?'Platform administrator accounts cannot be suspended here.':'Suspension blocks access across all organizations.'}</p>
    </>}
   </div>
   <footer>
    <button type="button" className="button" disabled={busy} onClick={onClose}>Cancel</button>
    <button type="submit" className="button primary" disabled={busy||!dirty||!name.trim()}>{busy?'Saving…':'Save changes'}</button>
   </footer>
  </form>
 </dialog>,document.getElementById('app')!);
}
