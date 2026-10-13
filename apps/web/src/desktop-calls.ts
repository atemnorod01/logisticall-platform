import {useRingtone} from "./ringtones.js";
import {useEffect, useRef, useState} from 'react';
import {openCallWindow} from './call-window.js';
import type {Calling} from './calls-ui.js';
type CallAction={id:string;action:'open'|'accept'|'decline'};
declare global {
  interface Window {
    logisticallDesktop?: {
      nativeRinging?:boolean;
      active?(value:boolean):void;
      onPresentation?(callback:(mode:'dock'|'detach')=>void):()=>void;
      incoming(value:{id:string;name:string;detail:string;expiresAt:number;ringtone?:string;volume?:number}|null):void;
      onAction(callback:(action:CallAction)=>void):()=>void;
      showWorkspace():void;
    };
  }
}
export function useDesktopCall(calling:Calling) {
  const bridge=typeof window==='undefined'?undefined:window.logisticallDesktop;
  const latest=useRef(calling);latest.current=calling;
  const popup=useRef<ReturnType<typeof openCallWindow>>(null);
  const [target,setTarget]=useState<HTMLElement|null>(null);
  function close() {popup.current?.close();popup.current=null;setTarget(null);}
  function open(focus=true) {
    if(popup.current){if(focus)popup.current.focus();return;}
    popup.current=openCallWindow(()=>{popup.current=null;setTarget(null);},focus);
    setTarget(popup.current?.root??null);
  }
  useEffect(()=>{
    if(!bridge)return;
    const unsubscribe=bridge.onAction(({id,action})=>{
      const {state,controller}=latest.current;
      if(state.current?.id!==id || state.current.status!=='ringing' || !controller.incoming(state.current))return;
      if(action==='decline'){void controller.end();return;}
      open();
      if(action==='accept')void controller.accept();
    });
    const unsubscribePresentation=bridge.onPresentation?.(mode=>{
      const {state,controller}=latest.current;
      if(!state.current?.acceptedAt || state.current.status==='ended' || !controller.owns(state.current))return;
      if(mode==='dock')close();else open(false);
    });
    return ()=>{unsubscribe();unsubscribePresentation?.();bridge.active?.(false);bridge.incoming(null);popup.current?.close();};
  },[bridge]);
  const ringtone=useRingtone(calling.user);
  const call=calling.state.current;
  const active=!!call?.acceptedAt && call.status!=='ended' && calling.controller.owns(call);
  useEffect(()=>{bridge?.active?.(active);},[bridge,active]);
  const ringing=call && calling.controller.incoming(call) && call.status==='ringing';
  useEffect(()=>{
    bridge?.incoming(ringing && call ? {ringtone:ringtone.id,volume:ringtone.volume,id:call.id,name:call.caller.name,detail:[call.caller.organizationName,call.team?.name].filter(Boolean).join(' · '),expiresAt:call.createdAt+(call.ringSeconds??45)*1000}:null);
  },[bridge,ringing,ringtone.id,ringtone.volume,call?.id,call?.caller.name,call?.caller.organizationName,call?.team?.name]);
  useEffect(()=>{
    if(!call || call.status==='ended' || (!ringing&&!calling.controller.owns(call)))close();
  },[call?.id,call?.status,ringing,calling.controller]);
  return {target,open:bridge?()=>open():undefined,focus:()=>popup.current?.focus(),dock:()=>{close();bridge?.showWorkspace();},accept:()=>{if(bridge)open();void calling.controller.accept();}};
}
