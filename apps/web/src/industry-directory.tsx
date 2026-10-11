import { useEffect, useState } from 'react';
import { industryPage, type IndustryOrganization } from '../../../packages/types/src/industry.js';
import { networkGroupList } from '../../../packages/types/src/groups.js';
import type { Conversation } from '../../../packages/types/src/messaging.js';
import type { messagingController } from './messaging.js';
import { Avatar, Icon } from './ui.js';
const labels = {all:'All businesses',carrier:'Carrier',broker:'Broker',shipper:'Shipper',factoring:'Factoring',other:'Other'};
export function IndustryDirectory({org,messaging,onOpen,onOwn}:{org:string;messaging:ReturnType<typeof messagingController>;onOpen:(c:Conversation)=>void;onOwn:()=>void}) {
  const [query,setQuery]=useState(''),[search,setSearch]=useState(''),[type,setType]=useState('all');
  const [rows,setRows]=useState<IndustryOrganization[]>([]),[selected,setSelected]=useState<IndustryOrganization>(),[next,setNext]=useState<number|null>(null),[offset,setOffset]=useState(0);
  const [loading,setLoading]=useState(true),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [groups,setGroups]=useState<ReturnType<typeof networkGroupList.parse>['groups']>([]),[networkLoading,setNetworkLoading]=useState(false),[networkError,setNetworkError]=useState(''),[networkNext,setNetworkNext]=useState<number|null>(null),[networkOffset,setNetworkOffset]=useState(0);
  useEffect(()=>{
    const abort=new AbortController();setLoading(true);setError('');
    if(!offset){setRows([]);setNext(null);}
    void fetch(`/v1/organizations/${org}/industry-directory?${new URLSearchParams({search,type,offset:String(offset)})}`,{credentials:'same-origin',cache:'no-store',signal:abort.signal})
      .then(async r=>{if(!r.ok)throw Error();const p=industryPage.parse(await r.json());if(abort.signal.aborted)return;setRows(old=>offset?[...new Map([...old,...p.organizations].map(c=>[c.id,c])).values()]:p.organizations);setNext(p.nextOffset);})
      .catch(()=>{if(!abort.signal.aborted)setError('Companies could not be loaded. Please try again.');})
      .finally(()=>{if(!abort.signal.aborted)setLoading(false);});
    return()=>abort.abort();
  },[org,search,type,offset]);
  useEffect(()=>{
    if(!selected||selected.id===org)return;
    const abort=new AbortController();setNetworkLoading(true);setNetworkError('');
    void fetch(`/v1/organizations/${org}/network-groups?${new URLSearchParams({search:selected.name.slice(0,100),offset:String(networkOffset)})}`,{credentials:'same-origin',cache:'no-store',signal:abort.signal})
      .then(async r=>{if(!r.ok)throw Error();const p=networkGroupList.parse(await r.json());if(abort.signal.aborted)return;const matches=p.groups.filter(g=>g.organization_id===selected.id);setGroups(old=>networkOffset?[...old,...matches]:matches);setNetworkNext(p.nextOffset);})
      .catch(()=>{if(!abort.signal.aborted)setNetworkError('Communication options could not be loaded.');})
      .finally(()=>{if(!abort.signal.aborted)setNetworkLoading(false);});
    return()=>abort.abort();
  },[org,selected,networkOffset]);
  function choose(company:IndustryOrganization){setSelected(company);setGroups([]);setNetworkError('');setNetworkOffset(0);setNetworkNext(null);}
  return <div className={`lc-contacts-body ${selected?'lc-industry-selected':''}`}>
    <section className="lc-contacts-list">
      <form className="lc-contact-tools" onSubmit={e=>{e.preventDefault();setSearch(query.trim());setOffset(0);setSelected(undefined);}}>
        <label className="lc-contact-search"><Icon name="search"/><input aria-label="Search industry directory" placeholder="Company name" maxLength={120} value={query} onChange={e=>{setQuery(e.target.value);if(!e.target.value){setSearch('');setOffset(0);}}}/></label><button className="button primary">Search</button>
      </form>
      <div className="lc-industry-filter-row"><select aria-label="Business type" value={type} onChange={e=>{setType(e.target.value);setOffset(0);setSelected(undefined);}}>{Object.entries(labels).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select><small>On LogistiCall</small></div>
      <div className="lc-contact-list-heading"><h3>{search?'Search results':'Companies'}</h3><small>{rows.length}{next!==null?' +':''} companies</small></div>
      {rows.map(company=><div className={`lc-contact-row ${selected?.id===company.id?'selected':''}`} key={company.id}><button className="lc-contact-open" onClick={()=>choose(company)}><Avatar name={company.name}/><span><strong>{company.name}</strong><small>{labels[company.organization_type]}{company.id===org?' · Your company':''}</small></span><span aria-hidden="true">›</span></button></div>)}
      {loading&&<p role="status">Loading companies…</p>}{error&&<p role="alert">{error}</p>}{!loading&&!error&&!rows.length&&<p className="quiet">No matching companies.</p>}{next!==null&&<button className="button" disabled={loading} onClick={()=>setOffset(next)}>Load more companies</button>}
    </section>
    <aside className="lc-contact-details" aria-label="Company details">
      {selected?<><button className="button lc-contact-back" onClick={()=>setSelected(undefined)}>← Back to companies</button><Avatar name={selected.name} large/><h2>{selected.name}</h2><span className="tag">{labels[selected.organization_type]}</span><p className="lc-contact-network">{selected.id===org?'Your company on LogistiCall':'On LogistiCall'}</p><hr/><h3>Connect</h3>
        {selected.id===org?<button className="button" onClick={onOwn}>View company directory</button>:<>{networkLoading&&<p role="status">Loading inboxes…</p>}{networkError&&<p role="alert">{networkError}</p>}{!networkLoading&&!networkError&&!groups.length&&<p className="quiet">This company has no published inboxes.</p>}{groups.map(g=><div className="lc-contact-inbox" key={g.id}><span>{g.name}</span><button className="button" disabled={busy} onClick={async()=>{setBusy(true);setNetworkError('');try{const c=await messaging.create({kind:'group',id:g.id,organizationId:g.organization_id});if(c)onOpen(c);else setNetworkError('Could not open this inbox.');}finally{setBusy(false);}}}><Icon name="message"/>Message</button></div>)}{networkNext!==null&&<button className="button" disabled={networkLoading} onClick={()=>setNetworkOffset(networkNext)}>Load more inboxes</button>}</>}
      </>:<div className="lc-contact-empty"><Icon name="users"/><h2>Company details</h2><p>Select a company to view its communication options.</p></div>}
    </aside>
  </div>;
}
