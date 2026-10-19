import {OrganizationPageHeader} from '../organization-page-header';
import {Icon} from '../ui';
import {numberWorkflowMessage} from './customer-language';
import {NumberBulkAssignmentDialog} from './NumberBulkAssignmentDialog';
import {NumberUnassignmentDialog} from './NumberUnassignmentDialog';
import {NumberSelectionMenu} from './NumberSelectionMenu';
import {numberSelectionActions,type NumberSelectionAction} from './number-selection';
import {useNumberConsole} from './console-api.js';
import {NumberOrdersTable} from './NumberOrdersTable';
import {acquiredAfterRelease} from './models/number-ownership';
import {visibleInterval} from './visible-poll';
import {NumberReleaseDialog} from './NumberReleaseDialog';
import {releaseLabel,releaseBlocksNumber,type NumberRelease} from './models/number-release-model';
import {NumberRouteDrawer} from './NumberRouteDrawer';
import {useManagementRequest,routeLabel,routeState,type GatewaySnapshot} from './operations-api';
import {CoverageCombobox} from './CoverageCombobox';
import {useTableSort} from './TableSort';
import {ListPagination,PaginatedPanel,usePagination} from './ListPagination';
import type {NumberRouting} from './models/number-routing';
import {NumberAssignmentDrawer,type AssignmentDestination} from './NumberAssignmentDrawer';
import type {AssignmentView} from './models/number-assignment-model';
import {lazy,Suspense,useCallback,useEffect,useRef,useState} from 'react';
import {useBuyRequest,type BuyContext} from './number-purchase-api';
import {NumberOrderDialog} from './NumberOrderProgress';
import {isNumberOrderActive,numberOrderLabel,numberStatusLabel,type NumberOrder} from './models/number-purchase-model';
const BuyNumbersPanel=lazy(()=>import('./BuyNumbersPanel'));
import type {TelephoneInventory} from './models/telephone-numbers';
type InventoryResponse={configured:boolean;snapshot:TelephoneInventory|null};
export function TelephoneNumbers({operations=false,demo=false,organization}:{operations?:boolean;demo?:boolean;organization?:{id:string;name:string}|undefined}){
 const buyRequest=useBuyRequest(),managementRequest=useManagementRequest(),consoleFetch=useNumberConsole().fetch;
 async function request(path='',options?:RequestInit):Promise<InventoryResponse>{
  const response=await consoleFetch('/telephone-numbers'+path,{...options,cache:'no-store',headers:{'Content-Type':'application/json',...options?.headers}});
  const data=await response.json().catch(()=>({message:'Unable to reach the server. Please try again.'}));
  if(!response.ok)throw new Error(data.message||'Unable to load telephone numbers.');return data;
 }
 const [gateways,setGateways]=useState<GatewaySnapshot>(),[gatewayError,setGatewayError]=useState(''),[gatewayRevision,setGatewayRevision]=useState(0),[routeNumber,setRouteNumber]=useState<string>();
 useEffect(()=>{if(!operations)return;const abort=new AbortController();managementRequest<GatewaySnapshot>('/bootstrap',{signal:abort.signal}).then(s=>{setGateways(s);setGatewayError('');}).catch(e=>{if(!abort.signal.aborted){setGateways(undefined);setGatewayError(e.message);}});return()=>abort.abort();},[operations,gatewayRevision]);
 const [releases,setReleases]=useState<NumberRelease[]>([]),[numberSelection,setNumberSelection]=useState<Set<string>>(()=>new Set()),[releaseNumbers,setReleaseNumbers]=useState<string[]>(),[releaseOrder,setReleaseOrder]=useState<NumberRelease>(),[releasesLoaded,setReleasesLoaded]=useState(false),[assignmentsLoaded,setAssignmentsLoaded]=useState(false);
 const reloadReleases=useCallback(()=>{return buyRequest<{releases:NumberRelease[]}>('/releases').then(d=>{setReleases(d.releases);setReleasesLoaded(true);}).catch(e=>{setReleasesLoaded(false);setError(e.message);});},[]);
 useEffect(()=>{void reloadReleases();},[reloadReleases]);
 useEffect(()=>{if(!releases.some(r=>['submitting','processing','review'].includes(r.status)||r.numbers.some(n=>n.carrier==='released'&&!n.cleanupUpdatedAt)))return;const timer=visibleInterval(reloadReleases,4000);return()=>clearInterval(timer);},[releases,reloadReleases]);
 const [tab,setTab]=useState<'inventory'|'orders'>('inventory');
 const [data,setData]=useState<InventoryResponse>(),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [context,setContext]=useState<BuyContext>(),[orders,setOrders]=useState<NumberOrder[]>([]),[open,setOpen]=useState(false),[purchasePending,setPurchasePending]=useState(false),[viewOrder,setViewOrder]=useState<NumberOrder>();
 const [savedAssignments,setAssignments]=useState<AssignmentView[]>([]),[destinations,setDestinations]=useState<AssignmentDestination[]>([]),[assignmentNumber,setAssignmentNumber]=useState<string>();
 const [bulkAssign,setBulkAssign]=useState<string[]>(),[bulkUnassign,setBulkUnassign]=useState<AssignmentView[]>();
 const [routing,setRouting]=useState<Record<string,NumberRouting>>({}),[routingLoading,setRoutingLoading]=useState(false),[routingError,setRoutingError]=useState(''),[routingRevision,setRoutingRevision]=useState(0);
 const assignments=savedAssignments.filter(a=>a.status!=='unassigned');
 const released=new Set(savedAssignments.filter(a=>a.status==='unassigned').map(a=>a.number));
 const routingKey=JSON.stringify(assignments.map(a=>[a.id,a.updatedAt,a.active]));
 useEffect(()=>{
  const abort=new AbortController();setRouting({});setRoutingError('');
  if(!assignments.length){setRoutingLoading(false);return;}
  setRoutingLoading(true);
  buyRequest<{routing:Record<string,NumberRouting>}>('/routing',{signal:abort.signal}).then(d=>{if(!abort.signal.aborted)setRouting(d.routing);}).catch(e=>{if(!abort.signal.aborted)setRoutingError(e.message);}).finally(()=>{if(!abort.signal.aborted)setRoutingLoading(false);});
  return()=>abort.abort();
 },[routingKey,routingRevision]);
 const reloadAssignments=useCallback(()=>{return buyRequest<{assignments:AssignmentView[];destinations:AssignmentDestination[]}>('/assignments').then(d=>{setAssignments(d.assignments);setDestinations(d.destinations);setAssignmentsLoaded(true);}).catch(e=>{setAssignmentsLoaded(false);setError(e.message);});},[]);
 useEffect(()=>{void reloadAssignments();},[reloadAssignments]);
 useEffect(()=>{if(!assignments.some(a=>a.active))return;const timer=visibleInterval(reloadAssignments,2000);return()=>clearInterval(timer);},[assignments,reloadAssignments]);
 const reloadOrders=useCallback(()=>{return buyRequest<{orders:NumberOrder[]}>(operations?'/orders?inventory=true':'/orders').then(d=>{setOrders(d.orders);if(operations)setGatewayRevision(v=>v+1);return reloadAssignments();}).catch(e=>setError(e.message));},[reloadAssignments,operations]);
 useEffect(()=>{buyRequest<BuyContext>('/context').then(setContext).catch(e=>setError(e.message));reloadOrders();},[reloadOrders]);
 useEffect(()=>{if(!orders.some(o=>isNumberOrderActive(o)||o.status==='REVIEW_REQUIRED'))return;const timer=visibleInterval(reloadOrders,5000);return()=>clearInterval(timer);},[orders,reloadOrders]);
 useEffect(()=>{if(open)drawer.current?.showModal();},[open]);
 const [search,setSearch]=useState(''),[organizationFilter,setOrganizationFilter]=useState('');const drawer=useRef<HTMLDialogElement>(null);
 useEffect(()=>{let active=true;request().then(value=>{if(active)setData(value);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[]);
 async function sync(){setBusy(true);setError('');try{setData(await request('/sync',{method:'POST',body:'{}'}));if(organization){await reloadOrders();setRoutingRevision(v=>v+1);}}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 const snapshot=data?.snapshot;
 const releaseFor=(number:string)=>releases.find(r=>releaseBlocksNumber(r,number)&&!acquiredAfterRelease(r,number,orders));
 const returnedToCarrier=(number:string)=>!!releaseFor(number)?.numbers.find(n=>n.number===number)?.cleanupUpdatedAt;
 const afterRelease=()=>{reloadReleases();setNumberSelection(old=>new Set([...old].filter(n=>!releaseNumbers?.includes(n))));void request().then(setData).catch(e=>setError(e.message));setGatewayRevision(v=>v+1);};
 const purchased=new Map([...orders].reverse().filter(o=>!snapshot||(o.accountId===snapshot.account.id&&o.siteId===snapshot.site.id&&o.peerId===snapshot.location.id)).flatMap(o=>o.numbers.filter(n=>n.status!=='BANDWIDTH_FAILED').map(n=>[n.phone_number,{...n,destinationLabel:o.destinationLabel,...(released.has(n.phone_number)?{organizationId:null,status:'UNASSIGNED' as const,portaoneStatus:'Not assigned' as const,netsapiensStatus:'Not assigned' as const}:{})}] as const)));
 const rows=[...new Map([...(snapshot?.numbers??[]).map(n=>[n.number,n] as const),...Array.from(purchased.keys()).map(number=>[number,{number,callingNameDisplay:null}] as const),...(operations?gateways?.config.routes??[]:[]).map(r=>[r.did,{number:r.did,callingNameDisplay:null}] as const)]).values()].filter(n=>(!organization||(!released.has(n.number)&&purchased.get(n.number)?.status!=='UNASSIGNED'))&&!returnedToCarrier(n.number)).sort((a,b)=>a.number.localeCompare(b.number)),digits=search.replace(/\D/g,'');
 const organizationOptions=[...new Map([
  ...Array.from(purchased.values()).filter(n=>n.organizationId).map(n=>[n.organizationId!,n.destinationLabel] as const),
  ...assignments.map(a=>[a.organizationId,a.organizationName] as const),
  ...destinations.map(d=>[d.id,d.label] as const)
 ]).entries()].map(([value,label])=>({value,label})).sort((a,b)=>a.label.localeCompare(b.label));
 const filtered=rows.filter(row=>{
  const organizationId=assignments.find(a=>a.number===row.number)?.organizationId??purchased.get(row.number)?.organizationId;
  const label=released.has(row.number)?undefined:gateways?.organizations[row.number];const matchedId=organizationId??destinations.find(d=>d.label===label)?.id;
  const matchesOrganization=!organizationFilter||(organizationFilter==='unassigned'?!matchedId&&!label:matchedId===organizationFilter);
  return matchesOrganization&&(!search.trim()||(digits?row.number.includes(digits):false));
 });
 function rowDetails(number:string){
  const assignment=assignments.find(a=>a.number===number),purchase=purchased.get(number),live=assignment?routing[assignment.id]:undefined;
  const opensipsPending=purchase?.opensips&&purchase.opensips.status!=='complete';
  const routingIssue=live&&(live.portaone.error||live.portaone.warning||live.netsapiens.error||live.netsapiens.warning);
  const release=releaseFor(number);
  const status=release?releaseLabel(release):assignment?.status==='terminated'?'Terminated · PBX removed':assignment?.unassignment?(assignment.active?'Returning to inventory…':'Return needs attention'):released.has(number)?'In inventory':opensipsPending?purchase.opensips?.status==='failed'?'Call routing needs attention':'Setting up call routing…':routingIssue?'Check routing':assignment?assignment.status==='complete'?'Provisioned':assignment.active?'Provisioning…':'Needs attention':purchase?numberStatusLabel[purchase.status]:operations&&gateways?.config.routes.some(r=>r.did===number)&&!snapshot?.numbers.some(n=>n.number===number)?'Routing only':'In inventory';
  return {organization:assignment?.organizationName??(purchase?.organizationId?purchase.destinationLabel:released.has(number)?null:gateways?.organizations[number]??null),status,live};
 }
 const inventorySort=useTableSort(filtered,{number:r=>r.number,organization:r=>rowDetails(r.number).organization,status:r=>rowDetails(r.number).status,route:r=>routeLabel(gateways,gateways?.config.routes.find(x=>x.did===r.number)?.destination),account:r=>rowDetails(r.number).live?.portaone.account,domain:r=>rowDetails(r.number).live?.netsapiens.domain,destination:r=>rowDetails(r.number).live?.netsapiens.destination,user:r=>rowDetails(r.number).live?.users?.map(u=>u.name||u.email).join(' ')},'number');
 const combinedOrders=[...orders.map(o=>({id:o.id,reference:o.customerOrderId,destination:o.destinationLabel,count:o.numbers.length,status:numberOrderLabel(o),created:o.createdAt,purchase:o,release:undefined as NumberRelease|undefined})),...releases.map(r=>({id:r.id,reference:r.customerOrderId,destination:'Return to carrier',count:r.numbers.length,status:releaseLabel(r),created:r.createdAt,purchase:undefined as NumberOrder|undefined,release:r}))];
 const orderSort=useTableSort(combinedOrders,{order:o=>o.reference,destination:o=>o.destination,numbers:o=>o.count,status:o=>o.status,created:o=>Date.parse(o.created)},'created','desc');
 const inventoryPage=usePagination(inventorySort.items,`${search}|${organizationFilter}|${inventorySort.key}`,30);
 const ordersPage=usePagination(orderSort.items,orderSort.key);
 const selectionActions=(number:string)=>{const actions=numberSelectionActions({
  ready:releasesLoaded&&assignmentsLoaded&&!!context?.livePurchasing,
  owned:!!snapshot?.numbers.some(n=>n.number===number)||purchased.get(number)?.carrierStatus==='COMPLETE',
  assignment:assignments.find(a=>a.number===number),organization:rowDetails(number).organization,
  pending:orders.some(o=>o.numbers.some(n=>n.phone_number===number&&!['PROVISIONED','UNASSIGNED','BANDWIDTH_FAILED'].includes(n.status))),
  releasing:!!releaseFor(number),
 });return organization?{...actions,assign:false,release:false}:actions;};
 const canSelect=(number:string)=>Object.values(selectionActions(number)).some(Boolean);
 const selectablePage=inventoryPage.items.filter(n=>canSelect(n.number));
 const selectedNumbers=rows.filter(n=>numberSelection.has(n.number)&&canSelect(n.number)).map(n=>n.number);
 const selectionByAction={assign:selectedNumbers.filter(n=>selectionActions(n).assign),unassign:selectedNumbers.filter(n=>selectionActions(n).unassign),release:selectedNumbers.filter(n=>selectionActions(n).release)};
 const allSelectable=inventorySort.items.filter(n=>canSelect(n.number)).slice(0,500).map(n=>n.number);
 const toggleSelection=(numbers:string[],checked:boolean)=>setNumberSelection(old=>{const next=new Set(old);for(const number of numbers){if(checked&&next.size<500)next.add(number);else if(!checked)next.delete(number);}return next;});
 function selectionAction(action:NumberSelectionAction){
  if(action==='assign')setBulkAssign(selectionByAction.assign);
  else if(action==='unassign')setBulkUnassign(assignments.filter(a=>selectionByAction.unassign.includes(a.number)));
  else setReleaseNumbers(selectionByAction.release);
 }
 function finishSelection(numbers:string[]){toggleSelection(numbers,false);void reloadAssignments();setRoutingRevision(v=>v+1);if(operations)setGatewayRevision(v=>v+1);}
 function format(number:string){return /^\+1\d{10}$/.test(number)?`+1 (${number.slice(2,5)}) ${number.slice(5,8)}-${number.slice(8)}`:number;}
 const tabNavigation=(<div className="profile-tabs telephone-tabs" role="tablist" aria-label="Telephone numbers">
   {(['inventory','orders'] as const).map((item,index)=><button key={item} id={`telephone-${item}-tab`} role="tab" aria-selected={tab===item} aria-controls={`telephone-${item}-panel`} tabIndex={tab===item?0:-1} onClick={()=>setTab(item)} onKeyDown={event=>{
    const next=event.key==='ArrowRight'||event.key==='ArrowLeft'?1-index:event.key==='Home'?0:event.key==='End'?1:null;
    if(next!==null){event.preventDefault();const selected=next===0?'inventory':'orders';setTab(selected);document.getElementById(`telephone-${selected}-tab`)?.focus();}
   }}>{item==='inventory'?'Telephone Numbers':'Number Orders'}</button>)}
  </div>);
 const purchaseAction=context?.canPurchase?<button className={organization?'button primary':'primary'} onClick={()=>setOpen(true)}>{organization?<Icon name="plus"/>:'＋ '}Search &amp; buy</button>:null;
 return <>
  {organization?<OrganizationPageHeader title="Telephone Numbers" description="Buy and manage your organization’s telephone numbers." tabs={tabNavigation} actions={purchaseAction} meta={tab==='inventory'?`${rows.length} ${rows.length===1?'number':'numbers'}`:undefined}/>:<>
   <div className="page-title"><div><h1>Telephone Numbers</h1><p className="subtitle">Buy numbers, assign organizations, and choose where calls go.</p></div></div>
   <div className="tn-tab-bar">{tabNavigation}{purchaseAction}</div>
  </>}
  {error&&<div className="error" role="alert">{numberWorkflowMessage(error)}</div>}
  <div hidden={tab!=='inventory'} role="tabpanel" id="telephone-inventory-panel" aria-labelledby="telephone-inventory-tab">
  <PaginatedPanel className="telephone-inventory" fillParent={operations||!!organization}>
   {(!organization||selectedNumbers.length>0)&&<div className={`panel-title tn-inventory-heading${selectedNumbers.length?' tn-has-selection':''}`}>{selectedNumbers.length?<>
    <h2 aria-live="polite">{selectedNumbers.length} selected</h2>
    <NumberSelectionMenu counts={{assign:selectionByAction.assign.length,unassign:selectionByAction.unassign.length,release:selectionByAction.release.length}} onAction={selectionAction}/>
    <div className="tn-selection-controls">{!allSelectable.every(n=>numberSelection.has(n))&&<button className="tn-text-action" onClick={()=>setNumberSelection(new Set(allSelectable))}>Select all {allSelectable.length}</button>}<button className="tn-text-action" onClick={()=>setNumberSelection(new Set())}>Clear selection</button></div>
   </>:<><span className="count">{rows.length} {rows.length===1?'number':'numbers'}</span></>}</div>}
   <div className={`telephone-inventory-tools${organization?' lc-org-search-toolbar':''}`}><label className="telephone-search"><input aria-label="Search telephone numbers" type="search" placeholder="Search telephone numbers…" value={search} onChange={e=>{setSearch(e.target.value);}}/></label>{!organization&&<div className="telephone-organization-filter"><CoverageCombobox label="Filter by organization" hideLabel value={organizationFilter} onChange={setOrganizationFilter} options={[{value:'',label:'All organizations'},{value:'unassigned',label:'Unassigned numbers'},...organizationOptions]} placeholder="All organizations" searchPlaceholder="Search organizations…" empty="No matching organizations."/></div>}<button className="secondary" disabled={loading||busy||!data?.configured} onClick={()=>void sync()}>{busy?'Refreshing…':organization?'Refresh numbers':'Refresh from Carrier'}</button>{!organization&&<button className="secondary" disabled={routingLoading||(!operations&&!assignments.length)} onClick={()=>{setRoutingRevision(v=>v+1);if(operations)setGatewayRevision(v=>v+1);}}>{routingLoading?'Checking routing…':'Refresh routing'}</button>}</div>
   {routingError&&<p className="error" role="alert">{numberWorkflowMessage(routingError)}</p>}{operations&&gatewayError&&<p className="error" role="alert">Routing could not be loaded: {gatewayError}</p>}

   <div className="table-wrap"><table><thead><tr><th><input type="checkbox" aria-label="Select numbers on this page" ref={el=>{if(el)el.indeterminate=selectablePage.some(n=>numberSelection.has(n.number))&&!selectablePage.every(n=>numberSelection.has(n.number));}} checked={selectablePage.length>0&&selectablePage.every(n=>numberSelection.has(n.number))} disabled={!selectablePage.length} onChange={e=>toggleSelection(selectablePage.map(n=>n.number),e.target.checked)}/></th>{inventorySort.header('number','TELEPHONE NUMBER')}{!organization&&inventorySort.header('organization','ORGANIZATION')}{!operations&&inventorySort.header('status','STATUS')}{operations&&inventorySort.header('route','ROUTE TO')}{!organization&&inventorySort.header('account','PORTAONE ACCOUNT')}{!operations&&!organization&&inventorySort.header('domain','NETSAPIENS DOMAIN')}{inventorySort.header('destination','PBX DESTINATION')}{inventorySort.header('user','USER')}<th>ACTION</th></tr></thead><tbody>
    {inventoryPage.items.map(row=>{const assignment=assignments.find(a=>a.number===row.number),purchase=purchased.get(row.number),live=assignment?routing[assignment.id]:undefined;const opensipsPending=purchase?.opensips&&purchase.opensips.status!=='complete';const routingIssue=live&&(live.portaone.error||live.portaone.warning||live.netsapiens.error||live.netsapiens.warning);const pending=assignment?(routingLoading?'Checking…':'Unable to verify'):'—';const owned=snapshot?.numbers.some(n=>n.number===row.number)||purchase?.carrierStatus==='COMPLETE';return <tr key={row.number} aria-selected={numberSelection.has(row.number)&&canSelect(row.number)}><td><input type="checkbox" aria-label={`Select ${format(row.number)}`} checked={numberSelection.has(row.number)&&canSelect(row.number)} disabled={!canSelect(row.number)||!numberSelection.has(row.number)&&selectedNumbers.length>=500} onChange={e=>toggleSelection([row.number],e.target.checked)}/></td><td><strong>{format(row.number)}</strong>{operations&&<small>{rowDetails(row.number).status}</small>}</td>{!organization&&<td>{rowDetails(row.number).organization??'Not assigned in portal'}</td>}{!operations&&<td><span className={`badge ${routingIssue||purchase?.opensips?.status==='failed'?'failed':opensipsPending?'running':assignment?.status==='complete'?'completed':assignment?.status==='failed'?'failed':'running'}`}>{rowDetails(row.number).status}</span></td>}{operations&&<td className="tn-routing-cell"><button className="portaone-customer-link" disabled={!!releaseFor(row.number)||!releasesLoaded} onClick={()=>setRouteNumber(row.number)}>{gateways?routeLabel(gateways,gateways.config.routes.find(r=>r.did===row.number)?.destination):gatewayError?'Unavailable':'Loading…'}</button><small className="operations-route-status">{routeState(gateways,row.number)}</small></td>}{!organization&&<td className="tn-routing-cell">{live?.portaone.account??live?.portaone.error??pending}{live?.portaone.warning&&<small className="tn-warning">{live.portaone.warning}</small>}</td>}{!operations&&!organization&&<td className="tn-routing-cell">{live?.netsapiens.domain??live?.netsapiens.error??pending}{live?.netsapiens.warning&&<small className="tn-warning">{live.netsapiens.warning}</small>}</td>}<td className="tn-routing-cell">{operations&&live?.netsapiens.domain&&<small>Domain {live.netsapiens.domain}</small>}{live?.netsapiens.error?numberWorkflowMessage(live.netsapiens.error):live?.netsapiens.destination??pending}{live?.netsapiens.application&&live.netsapiens.destination!=='Unassigned'&&<small>{live.netsapiens.destinationName??(live.netsapiens.nameUnavailable?'Name unavailable':['to-user','to-user-residential'].includes(live.netsapiens.application)?'Name not set':live.netsapiens.application)}</small>}{live?.netsapiens.host&&live.netsapiens.host!=='[*]'&&live.netsapiens.host!==live.netsapiens.domain&&<small>Host: {live.netsapiens.host}</small>}</td><td className="tn-routing-cell tn-member-cell">{live?.usersUnavailable?'Unavailable':live?.users?.length?live.users.map(user=><div key={user.id}>{user.name||user.email}<small>{user.email}</small></div>):routingLoading&&assignment?'Loading…':routingError&&assignment?'Unavailable':'—'}</td><td><button className="secondary" disabled={!releasesLoaded||!owned&&!assignment} onClick={()=>{const release=releaseFor(row.number);if(release){setReleaseOrder(release);return;}const order=orders.find(o=>(o.autoProvision||o.opensipsRequired)&&o.numbers.some(n=>n.phone_number===row.number));if(order&&!released.has(row.number)&&(opensipsPending||order.autoProvision&&!assignment))setViewOrder(order);else setAssignmentNumber(row.number);}}>{releaseFor(row.number)?'View release':assignment?.unassignment?'View return':opensipsPending?'View progress':assignment?['complete','terminated'].includes(assignment.status)?'View assignment':assignment.active?'View progress':'Resume assignment':purchase?.organizationId?'View progress':'Assign'}</button></td></tr>;})}
    {!filtered.length&&(!organization||loading||!data?.configured||!snapshot||!!search)&&<tr><td colSpan={organization?6:operations?8:9} className="empty">{loading?'Loading telephone numbers…':!data?.configured?'Number provisioning is not connected.':!snapshot?'Refresh from Carrier to import the location’s telephone numbers.':search||organizationFilter?'No matching telephone numbers.':organization?'No telephone numbers are assigned to your organization.':'No telephone numbers are assigned to this location.'}</td></tr>}
   </tbody></table></div>
   <ListPagination pagination={inventoryPage} label="Telephone numbers" platform={operations||!!organization}/>
  </PaginatedPanel>
  </div>
  <div hidden={tab!=='orders'} role="tabpanel" id="telephone-orders-panel" aria-labelledby="telephone-orders-tab">
  {operations?<NumberOrdersTable visible={tab==='orders'} onPurchase={setViewOrder} onRelease={setReleaseOrder}/>:<PaginatedPanel className="tn-orders-panel" fillParent={!!organization}><div className="panel-title"><h2>Number orders</h2><span className="count">{combinedOrders.length} orders</span></div><div className="table-wrap"><table><thead><tr>{orderSort.header('order','ORDER')}{orderSort.header('destination','DESTINATION')}{orderSort.header('numbers','NUMBERS')}{orderSort.header('status','STATUS')}{orderSort.header('created','CREATED')}</tr></thead><tbody>{ordersPage.items.map(o=><tr key={o.id}><td><button className="portaone-customer-link" onClick={()=>o.release?setReleaseOrder(o.release):setViewOrder(o.purchase)}>{o.reference}</button></td><td>{o.destination}</td><td>{o.count}</td><td>{o.status}</td><td>{new Date(o.created).toLocaleString()}</td></tr>)}{!combinedOrders.length&&<tr><td colSpan={5} className="empty">No number orders yet.</td></tr>}</tbody></table></div><ListPagination pagination={ordersPage} label="Number orders" platform={!!organization}/></PaginatedPanel>}
  </div>
  <dialog ref={drawer} className="integration-drawer tn-buy-drawer" aria-labelledby="new-telephone-number-title" onClose={e=>{if(e.target===e.currentTarget)setOpen(false);}} onCancel={e=>{if(purchasePending)e.preventDefault();}} onClick={e=>{const r=e.currentTarget.getBoundingClientRect();if(!purchasePending&&e.target===e.currentTarget&&(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom))e.currentTarget.close();}}>
   <div className="drawer-heading"><h2 id="new-telephone-number-title">Search &amp; buy numbers</h2><button autoFocus className="close" aria-label="Close new phone number" disabled={purchasePending} onClick={()=>drawer.current?.close()}>×</button></div>
   {open&&context&&<Suspense fallback={<div className="tn-buy-body"><span className="tn-spinner"/>Loading number search…</div>}><BuyNumbersPanel lockedOrganization={organization} context={{...context,demo:context.demo??demo}} onPending={setPurchasePending} onOrder={reloadOrders}/></Suspense>}
  </dialog>
  {operations&&routeNumber&&<NumberRouteDrawer number={routeNumber} onClose={()=>setRouteNumber(undefined)} onUpdated={()=>setGatewayRevision(v=>v+1)}/>}
  {bulkAssign&&<NumberBulkAssignmentDialog numbers={bulkAssign} destinations={destinations} onClose={()=>{finishSelection(bulkAssign);setBulkAssign(undefined);}} onUpdated={reloadAssignments}/>}
  {bulkUnassign&&<NumberUnassignmentDialog assignments={bulkUnassign} onClose={()=>{finishSelection(bulkUnassign.map(a=>a.number));setBulkUnassign(undefined);}} onUpdated={reloadAssignments}/>}
  {assignmentNumber&&<NumberAssignmentDrawer number={assignmentNumber} initial={assignments.find(a=>a.number===assignmentNumber)} destinations={destinations} onClose={()=>setAssignmentNumber(undefined)} onUpdate={reloadAssignments}/>}
  {(releaseNumbers||releaseOrder)&&<NumberReleaseDialog numbers={releaseNumbers} initial={releaseOrder} onClose={()=>{setReleaseNumbers(undefined);setReleaseOrder(undefined);afterRelease();}} onUpdated={afterRelease}/>}
  {viewOrder&&<NumberOrderDialog order={viewOrder} onClose={()=>setViewOrder(undefined)} onUpdate={reloadOrders}/>}
 </>;
}
