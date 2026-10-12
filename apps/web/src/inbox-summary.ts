import {useEffect,useState} from 'react';
import {subscribeWorkspace} from './realtime.js';
type Summary={messages:number;inboxes:{id:string;name:string;unread:number}[]};
const empty:Summary={messages:0,inboxes:[]};
// One request and subscription shared by the navigation badge and inbox tabs.
const stores=new Map<string,{value:Summary;listen:(l:(s:Summary)=>void)=>()=>void}>();
export function useInboxSummary(org:string|undefined,user:string|undefined) {
 const key=`${org}:${user}`;
 const [state,setState]=useState({key:'',value:empty});
 useEffect(()=>{
  if(!org || !user)return;
  let store=stores.get(key);
  if(!store){
   const listeners=new Set<(s:Summary)=>void>();
   let busy=false,pending=false,live=true,timer:ReturnType<typeof setTimeout>|undefined;
   const abort=new AbortController();
   const load=async()=>{
    if(!live)return;
    if(busy){pending=true;return;} busy=true;
    try {
     const response=await fetch(`/v1/organizations/${org}/messaging/inboxes`,{credentials:'same-origin',cache:'no-store',signal:AbortSignal.any([abort.signal,AbortSignal.timeout(10000)])});
     if(!response.ok)throw Error();
     const value=await response.json() as Summary;
     if(live && Array.isArray(value.inboxes) && Number.isInteger(value.messages)){current.value=value;for(const listener of listeners)listener(value);}
    }catch{ /* Preserve the last verified result during a transient failure. */ }
    finally{busy=false;if(pending&&live){pending=false;schedule();}}
   };
   const schedule=()=>{if(!live||document.visibilityState!=='visible'||timer)return;timer=setTimeout(()=>{timer=undefined;void load();},100);};
   const unsubscribe=subscribeWorkspace(org,user,event=>{if(event.kind!=='typing'&&event.kind!=='calls'&&event.kind!=='profiles')schedule();});
   const fallback=setInterval(schedule,60000);
   document.addEventListener('visibilitychange',schedule);window.addEventListener('online',schedule);
   const current={value:empty,listen(listener:(s:Summary)=>void){
    listeners.add(listener);listener(current.value);
    return()=>{listeners.delete(listener);if(!listeners.size){live=false;abort.abort();clearTimeout(timer);clearInterval(fallback);unsubscribe();document.removeEventListener('visibilitychange',schedule);window.removeEventListener('online',schedule);stores.delete(key);}};
   }};
   store=current;stores.set(key,store);void load();
  }
  return store.listen(value=>setState({key,value}));
 },[org,user,key]);
 return state.key===key?state.value:empty;
}
