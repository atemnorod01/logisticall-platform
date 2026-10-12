import { LoadingSkeleton } from "./loading-skeleton.js";
import { useCompanyPresence } from './company-presence.js';
import { useEffect, useState } from 'react';
import { industryPage, type IndustryOrganization } from '../../../packages/types/src/industry.js';
import { networkGroupList } from '../../../packages/types/src/groups.js';
import type { Conversation } from '../../../packages/types/src/messaging.js';
import type { messagingController } from './messaging.js';
import { Avatar, Icon } from './ui.js';
const labels = {all:'All businesses',carrier:'Carrier',forwarder:'Freight forwarder',broker:'Broker',shipper:'Shipper',factoring:'Factoring',other:'Other'};
function businessLabel(company:IndustryOrganization){return company.fmcsa_entity_type.includes('CARRIER')&&company.fmcsa_entity_type.includes('BROKER')?'Carrier / Broker':labels[company.organization_type];}
export function IndustryDirectory({org,messaging,onOpen}:{org:string;messaging:ReturnType<typeof messagingController>;onOpen:(c:Conversation)=>void}) {
  const [query,setQuery]=useState(''),[search,setSearch]=useState(''),[type,setType]=useState('all'),[onPlatformOnly,setOnPlatformOnly]=useState(false);
  const [rows,setRows]=useState<IndustryOrganization[]>([]),[selected,setSelected]=useState<IndustryOrganization>(),[next,setNext]=useState<number|null>(null),[offset,setOffset]=useState(0);
  const [loading,setLoading]=useState(true),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [groups,setGroups]=useState<ReturnType<typeof networkGroupList.parse>['groups']>([]),[networkLoading,setNetworkLoading]=useState(false),[networkError,setNetworkError]=useState(''),[networkNext,setNetworkNext]=useState<number|null>(null),[networkOffset,setNetworkOffset]=useState(0);
  const companyPresence=useCompanyPresence([...rows,...(selected?[selected]:[])].flatMap(c=>c.on_platform&&c.organization_id?[c.organization_id]:[]),org);
  useEffect(()=>{
    const abort=new AbortController();setLoading(true);setError('');
    if(!offset)setNext(null);
    void fetch(`/v1/organizations/${org}/industry-directory?${new URLSearchParams({search,type,offset:String(offset),onPlatformOnly:String(onPlatformOnly)})}`,{credentials:'same-origin',cache:'no-store',signal:abort.signal})
      .then(async r=>{if(!r.ok)throw Error();const p=industryPage.parse(await r.json());p.organizations=p.organizations.filter(company=>company.id!==org);if(abort.signal.aborted)return;setRows(old=>offset?[...new Map([...old,...p.organizations].map(c=>[c.id,c])).values()]:p.organizations);setNext(p.nextOffset);})
      .catch(()=>{if(!abort.signal.aborted)setError('Companies could not be loaded. Please try again.');})
      .finally(()=>{if(!abort.signal.aborted)setLoading(false);});
    return()=>abort.abort();
  },[org,search,type,offset,onPlatformOnly]);
  useEffect(()=>{
    if(!selected?.on_platform||!selected.organization_id||selected.organization_id===org)return;
    const abort=new AbortController();setNetworkLoading(true);setNetworkError('');
    void fetch(`/v1/organizations/${org}/network-groups?${new URLSearchParams({organizationId:selected.organization_id,offset:String(networkOffset)})}`,{credentials:'same-origin',cache:'no-store',signal:abort.signal})
      .then(async r=>{if(!r.ok)throw Error();const p=networkGroupList.parse(await r.json());if(abort.signal.aborted)return;const matches=p.groups.filter(g=>g.organization_id===selected.organization_id);setGroups(old=>networkOffset?[...old,...matches]:matches);setNetworkNext(p.nextOffset);})
      .catch(()=>{if(!abort.signal.aborted)setNetworkError('Communication options could not be loaded.');})
      .finally(()=>{if(!abort.signal.aborted)setNetworkLoading(false);});
    return()=>abort.abort();
  },[org,selected,networkOffset]);
  function choose(company:IndustryOrganization){setSelected(company);setGroups([]);setNetworkError('');setNetworkOffset(0);setNetworkNext(null);}
  return <div className={`lc-contacts-body ${selected?'lc-industry-selected':''}`}>
    <section className="lc-contacts-list">
      <form className="lc-contact-tools" onSubmit={e=>{e.preventDefault();setSearch(query.trim());setOffset(0);setSelected(undefined);}}>
        <label className="lc-contact-search"><Icon name="search"/><input aria-label="Search industry directory" placeholder="Company name, DBA, MC or DOT number" maxLength={120} value={query} onChange={e=>{setQuery(e.target.value);if(!e.target.value){setSearch('');setOffset(0);}}}/></label><button className="button primary">Search</button>
      </form>
      <div className="lc-industry-filter-row"><select aria-label="Business type" value={type} onChange={e=>{setType(e.target.value);setOffset(0);setSelected(undefined);}}>{Object.entries(labels).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select><label className="lc-industry-network-filter"><input type="checkbox" checked={onPlatformOnly} onChange={e=>{setOnPlatformOnly(e.target.checked);setOffset(0);setSelected(undefined);}}/>On LogistiCall only</label></div>
      <div className="lc-contact-list-heading"><h3>{search?'Search results':'Companies'}</h3><small>{rows.length}{next!==null?' +':''} {rows.length===1&&next===null?'company':'companies'}</small></div>
      {rows.map(company=><div className={`lc-contact-row ${selected?.id===company.id?'selected':''}`} key={company.id}><button className="lc-contact-open" onClick={()=>choose(company)}><Avatar name={company.name} inNetwork={company.on_platform} presence={company.on_platform&&company.organization_id?companyPresence[company.organization_id]??'unknown':undefined}/><span><strong>{company.name}</strong><small>{businessLabel(company)}{company.city ? ` · ${company.city}, ${company.state}` : ""}</small><small>{[company.mc && `MC ${company.mc}`, company.dot && `DOT ${company.dot}`, company.ff && `FF ${company.ff}`].filter(Boolean).join(" · ")}</small><span className="lc-registry-badges">{company.source==='synthetic' && <span className="tag">Sample</span>}{company.status==='inactive'&&<span className="tag">Inactive</span>}</span></span><span aria-hidden="true">›</span></button></div>)}
      {loading&&!rows.length&&<LoadingSkeleton />}{error&&<p role="alert">{error}</p>}{!loading&&!error&&!rows.length&&<p className="quiet">No matching companies.</p>}{next!==null&&<button className="button" disabled={loading} onClick={()=>setOffset(next)}>Load more companies</button>}
    </section>
    <aside className="lc-contact-details" aria-label="Company details">
      {selected?<>
        <button className="button lc-contact-back" onClick={()=>setSelected(undefined)}>← Back to companies</button>
        <div className="lc-contact-identity"><Avatar name={selected.name} large inNetwork={selected.on_platform} presence={selected.on_platform&&selected.organization_id?companyPresence[selected.organization_id]??'unknown':undefined}/><h2>{selected.name}</h2>{selected.dba&&<p>DBA {selected.dba}</p>}<div className="lc-registry-badges"><span className="tag">{businessLabel(selected)}</span>{selected.source==='synthetic'&&<span className="tag">Sample company</span>}</div></div>
        <dl className="lc-registry-facts">
          <div><dt>Registration status</dt><dd>{selected.status==='unknown'?'Not verified':selected.status==='active'?'Active':'Inactive'}</dd></div>
          {selected.mc&&<div><dt>MC number</dt><dd>{selected.mc}</dd></div>}{selected.dot&&<div><dt>USDOT number</dt><dd>{selected.dot}</dd></div>}{selected.ff&&<div><dt>FF number</dt><dd>{selected.ff}</dd></div>}
          {(selected.organization_type==='carrier'||selected.organization_type==='broker')&&<>
            <div><dt>Power units</dt><dd>{selected.power_units===null?'Not reported':selected.power_units.toLocaleString()}</dd></div>
            <div><dt>Drivers</dt><dd>{selected.drivers===null?'Not reported':selected.drivers.toLocaleString()}</dd></div>
            {selected.fleet_as_of&&<div><dt>Fleet data as of</dt><dd>{selected.fleet_as_of}</dd></div>}
          </>}
          <div><dt>Address</dt><dd>{selected.street?<>{selected.street}<br/>{[selected.city,selected.state,selected.postal_code].filter(Boolean).join(' ')}<br/>{selected.country}</>:'Not provided'}</dd></div>
          <div><dt>Phone</dt><dd>{selected.phones.length?selected.phones.map(phone=><a key={phone} href={`tel:${phone.replace(/[^+0-9]/g,'')}`}>{phone}</a>):'Not provided'}</dd></div>
          <div><dt>{selected.email_kind==='registration'?'Registration email':'Contact email'}</dt><dd>{selected.email?<a href={`mailto:${selected.email}`}>{selected.email}</a>:'Not provided'}</dd></div>
          {selected.website&&/^https?:\/\//.test(selected.website)&&<div><dt>Website</dt><dd><a href={selected.website} target="_blank" rel="noreferrer">{new URL(selected.website).hostname}</a></dd></div>}
        </dl>
        {selected.on_platform&&<section className="lc-registry-teams"><h3>Public teams</h3>
          {networkLoading&&!groups.length&&<LoadingSkeleton rows={3} />}{networkError&&<p role="alert">{networkError}</p>}
          {!networkLoading&&!networkError&&!groups.length&&<p className="quiet">This company has no public teams.</p>}
          {groups.map(g=><div className="lc-contact-inbox" key={g.id}><span><strong>{g.name}</strong>{g.description&&<small>{g.description}</small>}</span><button className="button" disabled={busy} onClick={async()=>{setBusy(true);setNetworkError('');try{const c=await messaging.create({kind:'group',id:g.id,organizationId:g.organization_id});if(c)onOpen(c);else setNetworkError('Could not open this team.');}finally{setBusy(false);}}}><Icon name="message"/>Message</button></div>)}
          {networkNext!==null&&<button className="button" disabled={networkLoading} onClick={()=>setNetworkOffset(networkNext)}>Load more teams</button>}
        </section>}
        {selected.source==='synthetic'?<p className="note">Synthetic sample. Registration numbers and contact details are for demonstration only.</p>:selected.sources.length>0&&<details className="lc-registry-sources"><summary>Sources{selected.verified_at?` · checked ${selected.verified_at}`:''}</summary>{selected.sources.filter(url=>/^https?:\/\//.test(url)).map((url,i)=><a href={url} key={url} target="_blank" rel="noreferrer">{new URL(url).hostname} {i+1}</a>)}{selected.email_kind!=='registration'&&<p>Published business contact; registration email has not been verified.</p>}</details>}
      </>:<div className="lc-contact-empty"><Icon name="users"/><h2>Company details</h2><p>Select a company to view its registration, contact details and public teams.</p></div>}
    </aside>
  </div>;
}
