import {useEffect,useState} from 'react';
import {useBuyRequest} from './number-purchase-api';
import {PaginatedPanel} from './ListPagination';
import {InfiniteScroll,useInfiniteData} from '../infinite-scroll';
import {useTableSort} from './TableSort';
import {visibleInterval} from './visible-poll';
import type {NumberOrder} from './models/number-purchase-model';
import type {NumberRelease} from './models/number-release-model';
type Row={id:string;kind:'purchase'|'release';reference:string;destination:string;count:number;status:string;created:string};
export function NumberOrdersTable({visible,onPurchase,onRelease}:{visible:boolean;onPurchase:(o:NumberOrder)=>void;onRelease:(r:NumberRelease)=>void}){
 const buyRequest=useBuyRequest();
 const [total,setTotal]=useState(0),[error,setError]=useState('');
 const sort=useTableSort<Row>([],{order:r=>r.reference,destination:r=>r.destination,numbers:r=>r.count,status:r=>r.status,created:r=>r.created},'created','desc');
 const list=useInfiniteData<Row>({queryKey:sort.key,enabled:visible,id:row=>row.kind+row.id,read:async(offset,signal)=>{
  const data=await buyRequest<{items:Row[];total:number}>('/order-directory?'+new URLSearchParams({limit:'30',offset:String(offset),sort:sort.field,direction:sort.direction}),{signal});
  if(!signal.aborted)setTotal(data.total);
  return {items:data.items,nextOffset:data.items.length&&offset+data.items.length<data.total?offset+data.items.length:null};
 }});
 const {items:rows,loading}=list;
 useEffect(()=>{if(!visible)return;const timer=visibleInterval(list.refresh,5000);return()=>clearInterval(timer);},[visible,list.refresh]);
 async function open(row:Row){try{if(row.kind==='purchase')onPurchase(await buyRequest<NumberOrder>('/orders/'+row.id));else onRelease(await buyRequest<NumberRelease>('/releases/'+row.id));}catch(e){setError((e as Error).message);}}
 return <PaginatedPanel className="tn-orders-panel" fillParent><div className="panel-title"><h2>Number orders</h2><span className="count">{total} orders</span></div>{error&&<p className="error">{error}</p>}<div className="table-wrap"><table><thead><tr>{sort.header('order','ORDER')}{sort.header('destination','DESTINATION')}{sort.header('numbers','NUMBERS')}{sort.header('status','STATUS')}{sort.header('created','CREATED')}</tr></thead><tbody>{rows.map(r=><tr key={r.kind+r.id}><td><button className="portaone-customer-link" onClick={()=>void open(r)}>{r.reference}</button></td><td>{r.destination}</td><td>{r.count}</td><td>{r.status}</td><td>{new Date(r.created).toLocaleString()}</td></tr>)}{!rows.length&&<tr><td colSpan={5} className="empty">{loading?'Loading orders…':'No number orders yet.'}</td></tr>}</tbody></table><InfiniteScroll label="Number orders" hasMore={list.nextOffset!==null} loading={loading} error={list.error} onMore={list.loadMore} onRetry={list.retry} progress={rows.length} enabled={visible} resetKey={sort.key}/></div></PaginatedPanel>;
}
