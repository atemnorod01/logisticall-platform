import {useLayoutEffect,useRef,type ReactNode} from 'react';
import {PlatformPagination} from '../platform-pagination';
import {usePagination} from '../use-pagination';
export {usePagination} from '../use-pagination';

type PaginationState=Omit<ReturnType<typeof usePagination>,'items'>;
export function ListPagination({pagination:p,label,loading=false,hasMore=false,onMore,platform=false}:{pagination:PaginationState;label:string;loading?:boolean;hasMore?:boolean;onMore?:()=>void;platform?:boolean}) {
 if(platform)return <PlatformPagination label={label} page={p.page} pageSize={p.pageSize} pageSizes={[10,20,30,50]} loading={loading} onPageSizeChange={p.setPageSize} previousDisabled={p.page===0} nextDisabled={p.page+1>=p.pages&&!hasMore} onPrevious={()=>p.setPage(p.page-1)} onNext={()=>p.page+1>=p.pages&&hasMore?onMore?.():p.setPage(p.page+1)}/>;
 return <nav className="list-pagination" aria-label={`${label} pagination`}>
  <label>Rows per page <select disabled={loading} aria-label={`${label} rows per page`} value={p.pageSize} onChange={e=>p.setPageSize(Number(e.target.value))}>{[10,20,30,50].map(n=><option key={n} value={n}>{n}</option>)}</select></label>
  <span className="list-range" aria-live="polite">{p.total?`${p.page*p.pageSize+1}–${Math.min((p.page+1)*p.pageSize,p.total)} of ${p.total}${hasMore?'+':''}`:'0 results'}</span>
  <div className="list-page-buttons"><button className="secondary" aria-label={`${label} previous page`} disabled={loading||p.page===0} onClick={()=>p.setPage(p.page-1)}>Previous</button><span>Page {p.page+1} of {p.pages}{hasMore?'+':''}</span><button className="secondary" aria-label={`${label} next page`} disabled={loading||(p.page+1>=p.pages&&!hasMore)} onClick={()=>p.page+1>=p.pages&&hasMore?onMore?.():p.setPage(p.page+1)}>Next</button></div>
 </nav>;
}
// Bound page-level tables to the viewport; only their rows scroll, keeping controls visible.
export function PaginatedPanel({children,className='',fillParent=false}:{children:ReactNode;className?:string;fillParent?:boolean}) {
 const ref=useRef<HTMLElement>(null);
 useLayoutEffect(()=>{
  if(fillParent)return;
  const element=ref.current;if(!element)return;
  const measure=()=>{if(element.getClientRects().length)element.style.height=`${Math.max(320,window.innerHeight-element.getBoundingClientRect().top-20)}px`;};
  measure();const observer=new ResizeObserver(measure);observer.observe(element.parentElement!);
  window.addEventListener('resize',measure);
  return()=>{observer.disconnect();window.removeEventListener('resize',measure);};
 },[fillParent]);
 return <section ref={ref} className={`panel paginated-panel ${className}`}>{children}</section>;
}
export function PaginatedItems<T>({items,label,children}:{items:readonly T[];label:string;children:(items:readonly T[])=>ReactNode}){
 const pagination=usePagination(items);
 return <>{children(pagination.items)}<ListPagination pagination={pagination} label={label}/></>;
}
