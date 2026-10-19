import {useEffect,useState} from 'react';
import {useBuyRequest} from './number-purchase-api';
import {PaginatedPanel,ListPagination} from './ListPagination';
import {useTableSort} from './TableSort';
import {visibleInterval} from './visible-poll';
import type {NumberOrder} from './models/number-purchase-model';
import type {NumberRelease} from './models/number-release-model';
type Row={id:string;kind:'purchase'|'release';reference:string;destination:string;count:number;status:string;created:string};
export function NumberOrdersTable({visible,onPurchase,onRelease}:{visible:boolean;onPurchase:(o:NumberOrder)=>void;onRelease:(r:NumberRelease)=>void}){
 const buyRequest=useBuyRequest();
 const [rows,setRows]=useState<Row[]>([]),[total,setTotal]=useState(0),[page,setPage]=useState(0),[size,setSize]=useState(10),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 const sort=useTableSort(rows,{order:r=>r.reference,destination:r=>r.destination,numbers:r=>r.count,status:r=>r.status,created:r=>r.created},'created','desc');
 const query=new URLSearchParams({limit:String(size),offset:String(page*size),sort:sort.field,direction:sort.direction}).toString();
 useEffect(()=>{setPage(0);},[sort.key]);
 useEffect(()=>{if(!visible)return;const abort=new AbortController();const load=async()=>{try{setLoading(true);const data=await buyRequest<{items:Row[];total:number}>('/order-directory?'+query,{signal:abort.signal});setRows(data.items);setTotal(data.total);setError('');if(page>0&&page*size>=data.total)setPage(Math.max(0,Math.ceil(data.total/size)-1));}catch(e){if(!abort.signal.aborted)setError((e as Error).message);}finally{if(!abort.signal.aborted)setLoading(false);}};void load();const timer=visibleInterval(load,5000);return()=>{abort.abort();clearInterval(timer);};},[visible,query]);
 async function open(row:Row){try{if(row.kind==='purchase')onPurchase(await buyRequest<NumberOrder>('/orders/'+row.id));else onRelease(await buyRequest<NumberRelease>('/releases/'+row.id));}catch(e){setError((e as Error).message);}}
 return <PaginatedPanel className="tn-orders-panel" fillParent><div className="panel-title"><h2>Number orders</h2><span className="count">{total} orders</span></div>{error&&<p className="error">{error}</p>}<div className="table-wrap"><table><thead><tr>{sort.header('order','ORDER')}{sort.header('destination','DESTINATION')}{sort.header('numbers','NUMBERS')}{sort.header('status','STATUS')}{sort.header('created','CREATED')}</tr></thead><tbody>{rows.map(r=><tr key={r.kind+r.id}><td><button className="portaone-customer-link" onClick={()=>void open(r)}>{r.reference}</button></td><td>{r.destination}</td><td>{r.count}</td><td>{r.status}</td><td>{new Date(r.created).toLocaleString()}</td></tr>)}{!rows.length&&<tr><td colSpan={5} className="empty">{loading?'Loading orders…':'No number orders yet.'}</td></tr>}</tbody></table></div><ListPagination platform label="Number orders" loading={loading} pagination={{total,page,pageSize:size,pages:Math.max(1,Math.ceil(total/size)),setPage,setPageSize:n=>{setSize(n);setPage(0);}}}/></PaginatedPanel>;
}
