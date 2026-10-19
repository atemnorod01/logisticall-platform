import {useEffect,useState} from 'react';
import {refreshWhileVisible} from './refresh-visible';

export function useOrganizationTelephonyAccess(organizationId:string|undefined){
 const [access,setAccess]=useState<{id:string;enabled:boolean;loaded:boolean}>();
 useEffect(()=>{
  if(!organizationId){setAccess(undefined);return;}
  const abort=new AbortController();let busy=false,revoked=false;
  const refresh=async()=>{
   if(busy)return;busy=true;
   try{
    const response=await fetch(`/v1/organizations/${encodeURIComponent(organizationId)}/telephony-access`,{credentials:'include',cache:'no-store',signal:abort.signal});
    const enabled=response.ok&&(await response.json()).enabled===true;
    if(!abort.signal.aborted&&!revoked)setAccess({id:organizationId,enabled,loaded:true});
   }catch{if(!abort.signal.aborted)setAccess({id:organizationId,enabled:false,loaded:true});}
   finally{busy=false;}
  };
  const denied=(event:Event)=>{
   if((event as CustomEvent).detail===organizationId){revoked=true;setAccess({id:organizationId,enabled:false,loaded:true});}
  };
  void refresh();
  const stop=refreshWhileVisible(()=>{revoked=false;void refresh();});
  window.addEventListener('logisticall:telephony-access-denied',denied);
  return()=>{abort.abort();stop();window.removeEventListener('logisticall:telephony-access-denied',denied);};
 },[organizationId]);
 return access&&access.id===organizationId?access:{enabled:false,loaded:false};
}
