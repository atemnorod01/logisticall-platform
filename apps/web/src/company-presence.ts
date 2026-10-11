import { useEffect, useState } from 'react';
import { z } from 'zod';
const result=z.object({presence:z.record(z.string(),z.enum(['available','away','busy','offline','unknown']))});
export function useCompanyPresence(ids:string[],organization?:string){
 const key=[...new Set(ids)].sort().join(',');
 const [states,setStates]=useState<Record<string,string>>({});
 useEffect(()=>{
  if (!key) { setStates({}); return; }
  const abort=new AbortController();let timer:ReturnType<typeof setTimeout>;
  async function refresh(){
   const companies=key?key.split(','):[],next:Record<string,string>={};
   for(let i=0;i<companies.length;i+=50){
    const batch=companies.slice(i,i+50);
    try{const path=organization?`/v1/organizations/${organization}/industry-presence`:'/v1/platform/directory-presence';const response=await fetch(`${path}?${new URLSearchParams({ids:batch.join(',')})}`,{signal:abort.signal,cache:'no-store'});if(!response.ok)throw Error();Object.assign(next,result.parse(await response.json()).presence);}catch{for(const id of batch)next[id]='unknown';}
   }
   if(!abort.signal.aborted){setStates(next);timer=setTimeout(()=>void refresh(),10000);}
  }
  void refresh();return()=>{abort.abort();clearTimeout(timer);};
 },[key,organization]);
 return states;
}
