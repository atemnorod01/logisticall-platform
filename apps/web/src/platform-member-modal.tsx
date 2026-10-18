import {createPortal} from 'react-dom';
import {useEffect, useRef, useState, type CSSProperties} from 'react';
import {PlatformEditor} from './platform-editor.js';

/** Present the existing platform user card over its organization member list. */
export function PlatformMemberModal({id,csrf,anchor,onClose,onSaved}:{
 id:string; csrf:string; anchor:HTMLElement; onClose:()=>void; onSaved:()=>void;
}) {
 const dialog=useRef<HTMLDialogElement>(null);
 const [bounds,setBounds]=useState<CSSProperties>({});
 useEffect(()=>{
  const container=anchor.closest('.lc-platform-editor-panel')??anchor;
  const measure=()=>{
   const rect=container.getBoundingClientRect();
   const left=Math.max(8,rect.left),top=Math.max(8,rect.top);
   setBounds({left,top,width:Math.min(rect.width,window.innerWidth-left-8),height:Math.min(rect.height,window.innerHeight-top-8)});
  };
  measure();
  const observer=new ResizeObserver(measure);observer.observe(container);
  window.addEventListener('resize',measure);
  const modal=dialog.current;modal?.showModal();
  return ()=>{observer.disconnect();window.removeEventListener('resize',measure);modal?.close();if(anchor.isConnected)anchor.focus();};
 },[anchor]);
 return createPortal(<dialog ref={dialog} className="lc-platform-member-modal lc-platform-admin" style={bounds} aria-label="Edit member user"
  onCancel={event=>{event.preventDefault();if(!dialog.current?.querySelector<HTMLButtonElement>('button[aria-label="Close details"]')?.disabled)onClose();}}
  onSubmit={event=>event.stopPropagation()}>
  <div className="lc-platform-editor-panel">
   <PlatformEditor kind="users" id={id} csrf={csrf} onClose={onClose} onSaved={onSaved}/>
  </div>
 </dialog>,document.getElementById('app')!);
}
