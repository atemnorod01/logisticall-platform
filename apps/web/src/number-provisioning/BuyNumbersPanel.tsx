import {numberWorkflowMessage,numberMonthlyPrice} from './customer-language';
import {numberIntent,completeNumberIntent} from './request-intent';
import {ListPagination,usePagination} from './ListPagination';
import {useEffect,useMemo,useRef,useState} from 'react';
import {CoverageCombobox} from './CoverageCombobox';
import {useBuyRequest,useCoverage,clearCoverageCache,type BuyContext} from './number-purchase-api';
import {NumberOrderProgress} from './NumberOrderProgress';
import {locationLabel,type AvailableNumber,type NumberOrder} from './models/number-purchase-model';
export default function BuyNumbersPanel({context,onPending,onOrder,lockedOrganization}:{lockedOrganization?:{id:string;name:string}|undefined;context:BuyContext;onPending:(pending:boolean)=>void;onOrder:()=>void}){
 const buyRequest=useBuyRequest();
 const [selectedDestination,setDestination]=useState('');
 const destination=lockedOrganization?.id??selectedDestination;
 const [country,setCountry]=useState('USA'),[tollFree,setTollFree]=useState(false),[searchBy,setSearchBy]=useState('areaCode');
 const [areaCode,setAreaCode]=useState(''),[region,setRegion]=useState(''),[locality,setLocality]=useState(''),[retry,setRetry]=useState(0);
 const [rows,setRows]=useState<AvailableNumber[]>([]),[hasMore,setHasMore]=useState(false),[selected,setSelected]=useState<Set<string>>(new Set()),[searching,setSearching]=useState(false),[error,setError]=useState('');
 const [confirmation,setConfirmation]=useState<AvailableNumber[]|null>(null),[submitting,setSubmitting]=useState(false),[order,setOrder]=useState<NumberOrder>(),[notice,setNotice]=useState('');
 const confirm=useRef<HTMLDialogElement>(null),requestId=useRef(''),generation=useRef(0),controller=useRef<AbortController|null>(null);
 const accountId=destination||null;
 const destinationLabel=lockedOrganization?.name??context.destinations.find(d=>d.id===destination)?.label??'unassigned inventory';
 const countries=useCoverage('countries',context.scopeKey,accountId,'USA','',true,retry);
 const supportsRegions=countries.items.find(c=>c.value===country)?.hasRegions??true;
 const regions=useCoverage('regions',context.scopeKey,accountId,country,'',!tollFree&&searchBy==='cityState',retry);
 const localities=useCoverage('localities',context.scopeKey,accountId,country,region,!tollFree&&searchBy==='cityState'&&(!supportsRegions||!!region),retry);
 const areaCodes=useCoverage('areacodes',context.scopeKey,accountId,country,'',!tollFree&&searchBy==='areaCode',retry);
 const coverageError=[countries,regions,localities,areaCodes].find(q=>q.error)?.error;
 const mode=tollFree?'tollFree':searchBy;
 const ready=tollFree||(!coverageError&&(mode==='areaCode'?!!areaCode:!!locality&&(!supportsRegions||!!region)));
 const pagination=usePagination(rows);
 const criteria=useMemo(()=>({accountId,mode,countryCodeA3:country,numberType:tollFree?'TOLL_FREE':'LOCAL',quantity:pagination.pageSize,lca:false,...(mode==='areaCode'?{areaCode}:{}),...(mode==='cityState'?{city:locality,...(region?{state:region}:{})}:{})}),[accountId,mode,country,tollFree,areaCode,region,locality,pagination.pageSize]);
 async function search(offset:number,reset:boolean,advance=false){
  controller.current?.abort();const abort=new AbortController();controller.current=abort;const version=++generation.current;
  setSearching(true);setError('');if(reset){pagination.setPage(0);setRows([]);setHasMore(false);setSelected(new Set());}
  try{const data=await buyRequest<{items:AvailableNumber[];hasMore:boolean}>('/search',{method:'POST',body:JSON.stringify({...criteria,offset}),signal:abort.signal});if(version!==generation.current)return;
   setRows(previous=>[...new Map([...(reset?[]:previous),...data.items].map(n=>[n.phone_number,n])).values()]);setHasMore(data.hasMore);if(advance&&data.items.length)pagination.setPage(pagination.page+1);
  }catch(e){if(version===generation.current&&(e as Error).name!=='AbortError'){setError((e as Error).message);setNotice((e as Error).message);setHasMore(false);}}
  finally{if(version===generation.current)setSearching(false);}
 }
 const searchRef=useRef(search);searchRef.current=search;
 useEffect(()=>{if(ready)void searchRef.current(0,true);else{controller.current?.abort();generation.current++;setRows([]);setHasMore(false);setSelected(new Set());setSearching(false);setError('');}return()=>{controller.current?.abort();generation.current++;};},[ready,criteria]);
 useEffect(()=>{if(confirmation)confirm.current?.showModal();},[confirmation]);
 function toggle(n:string){setSelected(old=>{const next=new Set(old);next.has(n)?next.delete(n):next.add(n);return next;});}
 async function purchase(){
  if(!confirmation||submitting)return;setSubmitting(true);onPending(true);setNotice('');
  try{const result=await buyRequest<NumberOrder>('/orders',{method:'POST',body:JSON.stringify({requestId:requestId.current,confirmed:true,organizationId:accountId,numbers:confirmation})});completeNumberIntent(requestId.current);setOrder(result);setSelected(new Set());setNotice(result.status==='ERROR'||result.status==='REVIEW_REQUIRED'?result.error??'Order needs attention.':`Order ${result.customerOrderId} submitted.`);onOrder();}
  catch(e){setNotice((e as Error).message+' Check Number Orders before starting another purchase. Retrying keeps the same request ID.');}
  finally{setSubmitting(false);onPending(false);}
 }
 return <><div className="tn-buy-body">
  {notice&&<div className="tn-toast" role="status">{numberWorkflowMessage(notice)}</div>}
  {!lockedOrganization&&<section className="tn-panel tn-destination"><label className="tn-label" htmlFor="purchase-organization">Purchase for</label><select id="purchase-organization" value={destination} onChange={e=>setDestination(e.target.value)}><option value="">Unassigned inventory</option>{context.destinations.map(d=><option value={d.id} key={d.id}>{d.label}</option>)}</select></section>}
  {coverageError&&<div className="error tn-coverage-error" role="alert">{numberWorkflowMessage(coverageError)}<button className="secondary" onClick={()=>{clearCoverageCache();setRetry(v=>v+1);}}>Retry coverage</button></div>}
  <section className="tn-panel tn-criteria"><div className="tn-criteria-grid">
   {!tollFree&&<CoverageCombobox label="Country" value={country} onChange={v=>{setCountry(v);setRegion('');setLocality('');setAreaCode('');}} options={countries.items} loading={countries.loading} placeholder="Select a country" searchPlaceholder="Search countries…" empty="No countries in coverage."/>}
   <div><span className="tn-label">Number Type</span><div className="tn-type-switch"><span className={!tollFree?'chosen':''}>Local</span><button type="button" role="switch" aria-checked={tollFree} aria-label="Toggle between Local and Toll Free numbers" onClick={()=>setTollFree(v=>!v)}><span/></button><span className={tollFree?'chosen':''}>Toll Free</span></div></div>
   {tollFree?<p className="tn-help tn-toll-note">Toll-free numbers are searched across the whole toll-free pool — no country or geography needed.</p>:<><div><label className="tn-label" htmlFor="number-search-by">Search By</label><select id="number-search-by" value={searchBy} onChange={e=>setSearchBy(e.target.value)}><option value="areaCode">Area Code</option><option value="cityState">Locality (City &amp; State)</option></select></div>
    {searchBy==='areaCode'?<CoverageCombobox label="Area Code" value={areaCode} onChange={setAreaCode} options={areaCodes.items} loading={areaCodes.loading} placeholder="Select an area code" searchPlaceholder="Search area codes…" empty="No area codes for this country."/>:<><div className="tn-grid-spacer"/>{supportsRegions&&<CoverageCombobox label="State / Region" value={region} onChange={v=>{setRegion(v);setLocality('');}} options={regions.items} loading={regions.loading} placeholder="Select a region" searchPlaceholder="Search regions…" empty="No regions in coverage."/>}<CoverageCombobox label="City / Locality" value={locality} onChange={setLocality} options={localities.items} loading={localities.loading} disabled={supportsRegions&&!region} placeholder={supportsRegions&&!region?'Select a region first':'Select a city'} searchPlaceholder="Search cities…" empty="No cities in coverage for this region."/></>}
   </>}
  </div><div className="tn-search-status" aria-live="polite">{searching&&<><span className="tn-spinner"/>Searching…</>}</div></section>
  <section className="tn-panel tn-results"><h2>Available Numbers</h2><div className="tn-results-scroll"><table className="tn-table"><thead><tr><th className="tn-select-cell"><span className="visually-hidden">Select</span></th><th>Phone Number</th><th>Location</th><th>Type</th><th>Rate Center</th></tr></thead><tbody>
   {searching&&!rows.length?Array.from({length:8},(_,i)=><tr key={i} aria-hidden="true">{Array.from({length:5},(_,j)=><td key={j}><div className="tn-skeleton"/></td>)}</tr>):pagination.items.map(n=><tr key={n.phone_number}><td className="tn-select-cell"><input type="checkbox" aria-label={`Select ${n.display_number}`} checked={selected.has(n.phone_number)} disabled={searching} onChange={()=>toggle(n.phone_number)}/></td><td className="tn-mono"><strong>{n.display_number}</strong></td><td>{locationLabel(n)}</td><td>{n.number_type==='TOLL_FREE'?'Toll Free':'Local'}</td><td className="muted">{n.rate_center??'—'}</td></tr>)}
   {!searching&&!rows.length&&<tr><td colSpan={5} className="tn-empty"><strong>{error?'Search failed':ready?'No available numbers':'No results yet'}</strong><p>{numberWorkflowMessage(error)|| (ready?'Try another area code or locality.':'Choose an area code or locality to search carrier inventory automatically.')}</p></td></tr>}
  </tbody></table></div></section>
 </div>
 <ListPagination pagination={pagination} label="Available numbers" loading={searching} hasMore={hasMore} onMore={()=>void search(rows.length,false,true)}/>
 {selected.size>0&&<div className="tn-selection-bar"><div className="tn-selection-actions"><strong>{selected.size} {selected.size===1?'number':'numbers'} selected</strong><button className="primary" disabled={!context.livePurchasing||submitting||searching} onClick={()=>{requestId.current=numberIntent('purchase',accountId,rows.filter(n=>selected.has(n.phone_number)).map(n=>n.phone_number));setOrder(undefined);setConfirmation(rows.filter(n=>selected.has(n.phone_number)));}}>{destination?'Purchase & provision':'Purchase Selected'}</button></div>{!context.livePurchasing&&<p className="tn-warning">Live purchasing is disabled for this workspace.</p>}</div>}
 <dialog ref={confirm} className="tn-confirm" aria-labelledby="purchase-title" onCancel={e=>{if(submitting)e.preventDefault();}} onClose={()=>{if(!submitting){setConfirmation(null);setOrder(undefined);}}} onClick={e=>{const r=e.currentTarget.getBoundingClientRect();if(!submitting&&e.target===e.currentTarget&&(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom))e.currentTarget.close();}}>
 <div className="tn-confirm-body">{notice&&!order&&<p role="alert" className="error">{numberWorkflowMessage(notice)}</p>}<h2 id="purchase-title">{order?`Order ${order.customerOrderId}`:`Purchase ${confirmation?.length??0} Phone ${confirmation?.length===1?'Number':'Numbers'}?`}</h2>{order?<NumberOrderProgress initial={order} onUpdate={onOrder}/>:<><p className="subtitle">{destination?`Purchase and provision these numbers for ${destinationLabel}.`:'Numbers will be purchased into unassigned inventory.'}</p><ul className="tn-purchase-list">{confirmation?.map(n=><li className="tn-mono" key={n.phone_number}>{n.display_number}</li>)}</ul>{lockedOrganization&&<div className="tn-purchase-price"><span>Monthly total<small>{numberMonthlyPrice(1)} per telephone number</small></span><strong>{numberMonthlyPrice(confirmation?.length??0)}</strong></div>}<p className="tn-help">{destination?'Your numbers will be added to your phone system automatically.':'You can assign these numbers to an organization after purchase.'}{context.demo&&' No charges in this preview.'}</p></>}</div>
 <div className="tn-confirm-footer">{order?<button className="secondary" onClick={()=>confirm.current?.close()}>Close</button>:<><button className="secondary" disabled={submitting} onClick={()=>confirm.current?.close()}>Cancel</button><button className="primary" disabled={submitting||!context.livePurchasing} onClick={()=>void purchase()}>{submitting?<><span className="tn-spinner"/>Submitting…</>:`${destination?'Purchase & provision':'Purchase'} ${confirmation?.length??0} ${confirmation?.length===1?'Number':'Numbers'}`}</button></>}</div>
 </dialog></>;
}
