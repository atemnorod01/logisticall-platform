import {useEffect,useLayoutEffect,useRef,useState,useSyncExternalStore} from 'react';
import {InfiniteListData,type InfinitePage} from './infinite-list-data';
import './styles/infinite-scroll.css';

export function useInfiniteData<T>({queryKey,read,id,refreshKey=0,enabled=true}:{queryKey:string;read:(offset:number,signal:AbortSignal)=>Promise<InfinitePage<T>>;id:(item:T)=>string;refreshKey?:number;enabled?:boolean}){
 const [data]=useState(()=>new InfiniteListData<T>(id));
 const state=useSyncExternalStore(data.subscribe,data.getSnapshot);
 const reader=useRef(read);reader.current=read;
 const loadedKey=useRef('');
 useEffect(()=>{
  loadedKey.current=queryKey;
  if(enabled)data.reset(reader.current);
  return()=>data.cancel();
 },[data,queryKey,enabled]);
 useEffect(()=>{if(enabled&&refreshKey)data.refresh();},[data,refreshKey,enabled]);
 return {...state,items:loadedKey.current===queryKey?state.items:[],loadMore:data.loadMore,retry:data.retry,refresh:data.refresh};
}

/** Reveal already-fetched inventories incrementally without replacing earlier rows. */
export function useInfiniteItems<T>(items:readonly T[],resetKey='',size=30){
 const [view,setView]=useState({key:resetKey,count:size});
 const count=view.key===resetKey?view.count:size;
 if(view.key!==resetKey)setView({key:resetKey,count:size});
 return {items:items.slice(0,count),hasMore:count<items.length,loadMore:()=>setView(old=>({key:resetKey,count:(old.key===resetKey?old.count:size)+size}))};
}

function scrollContainer(element:HTMLElement){
 let root=element.parentElement;
 while(root&&!/(auto|scroll)/.test(getComputedStyle(root).overflowY))root=root.parentElement;
 return root;
}

export function InfiniteScroll({hasMore,loading=false,error='',onMore,onRetry=onMore,progress,label,enabled=true,resetKey}:{hasMore:boolean;loading?:boolean;error?:string;onMore:()=>void;onRetry?:()=>void;progress:number|string;label:string;enabled?:boolean;resetKey?:string}){
 const ref=useRef<HTMLDivElement>(null),action=useRef(onMore);action.current=onMore;
 useLayoutEffect(()=>{
  if(resetKey!==undefined&&enabled&&ref.current)scrollContainer(ref.current)?.scrollTo(0,0);
 },[resetKey]);
 useEffect(()=>{
  const element=ref.current;if(!element||!enabled||!hasMore||loading||error||typeof IntersectionObserver==='undefined')return;
  const root=scrollContainer(element);
  let fired=false;
  const observer=new IntersectionObserver(entries=>{
   if(!fired&&entries.some(entry=>entry.isIntersecting)&&element.getClientRects().length){fired=true;action.current();}
  },{root,rootMargin:'0px 0px 160px 0px'});
  observer.observe(element);return()=>observer.disconnect();
 },[hasMore,loading,error,progress,enabled]);
 return <div ref={ref} className="lc-infinite-scroll" style={!hasMore&&!loading&&!error?{display:'none'}:undefined} aria-label={`${label} loading`}>
  {error?<><span role="alert">{error}</span><button type="button" className="button" onClick={onRetry}>Retry</button></>:loading?<span role="status">Loading {label.toLowerCase()}…</span>:<button type="button" className="button" onClick={onMore}>Load more {label.toLowerCase()}</button>}
 </div>;
}
