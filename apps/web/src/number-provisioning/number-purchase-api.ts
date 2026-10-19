import {useNumberConsole,type NumberConsoleClient} from './console-api.js';
import {useCallback,useEffect,useState} from 'react';
import type {CoverageOption} from './models/number-purchase-model';
import {readApiResponse} from './api-response';
export type BuyContext={demo?:boolean;canPurchase:boolean;livePurchasing:boolean;destinations:{id:string;label:string}[];site:string;location:string;scopeKey:string;provisioningDeferred:boolean};
const clients=new WeakMap<NumberConsoleClient,Map<string,Promise<unknown>>>();
export function useBuyRequest(){
 const client=useNumberConsole();
 if(!clients.has(client))clients.set(client,new Map());
 const reads=clients.get(client)!;
 return useCallback(async function buyRequest<T>(path:string,options?:RequestInit):Promise<T>{
 const consoleFetch=client.fetch,key=client.key+path;
 const read=async()=>{const response=await consoleFetch('/number-purchase'+path,{...options,cache:'no-store',headers:{'Content-Type':'application/json',...options?.headers}});return readApiResponse<T>(response,'Number request failed.');};
 if(options?.signal||(options?.method??'GET')!=='GET')return read();
 const pending=reads.get(key);if(pending)return structuredClone(await pending) as T;
 const work=read().finally(()=>{if(reads.get(key)===work)reads.delete(key);});reads.set(key,work);return structuredClone(await work);
 },[client]);
}
const cache=new Map<string,{until:number;items:CoverageOption[]}>();
const pending=new Map<string,Promise<{items:CoverageOption[]}>>();
export function clearCoverageCache(){cache.clear();}
export function useCoverage(kind:string,scopeKey:string,accountId:string|null,country:string,region:string,enabled=true,retry=0){
 const buyRequest=useBuyRequest(),client=useNumberConsole();
 const key=JSON.stringify([client.key,scopeKey,accountId,kind,country,region]);
 const [state,setState]=useState<{key:string;items:CoverageOption[];loading:boolean;error:string}>({key,items:[],loading:enabled,error:''});
 useEffect(()=>{
  let active=true;if(!enabled){setState({key,items:[],loading:false,error:''});return;}
  const cached=cache.get(key);if(cached&&cached.until>Date.now()){setState({key,items:cached.items,loading:false,error:''});return;}
  setState({key,items:[],loading:true,error:''});
  const query=new URLSearchParams({country,region,...(accountId?{accountId}:{}),...(retry?{force:'true'}:{})});
  let promise=pending.get(key);if(!promise){promise=buyRequest<{items:CoverageOption[]}>(`/coverage/${kind}?${query}`).then(data=>{cache.set(key,{until:Date.now()+12*60*60*1000,items:data.items});return data;}).finally(()=>pending.delete(key));pending.set(key,promise);}
  promise.then(data=>{if(active)setState({key,items:data.items,loading:false,error:''});}).catch(e=>{if(active)setState({key,items:[],loading:false,error:e.message});});
  return()=>{active=false;};
 },[key,enabled,retry]);
 return state.key===key?state:{key,items:[],loading:enabled,error:''};
}
