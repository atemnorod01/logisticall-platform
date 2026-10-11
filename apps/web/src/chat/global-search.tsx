import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { globalSearchPage, type GlobalSearchHit } from "../../../../packages/types/src/messaging.js";
import type { messagingController } from "../messaging.js";
import { conversationTitle, conversationGroup } from "../conversation-identity.js";
import { commentTime } from "./format.js";
import { Icon } from "../ui.js";
const optionSchema=z.object({companies:z.array(z.object({id:z.string(),name:z.string()})),senders:z.array(z.object({id:z.string(),name:z.string()}))});
export function SearchHighlight({text,query}:{text:string;query:string}) {
  const q=query.trim(), at=q?text.toLowerCase().indexOf(q.toLowerCase()):-1;
  // Keep the match in view even when it occurs deep inside a long message.
  const start=at>80?at-60:0, excerpt=text.slice(start,start+240), index=at-start;
  return <>{start>0?"…":""}{at<0?excerpt:<>{excerpt.slice(0,index)}<mark>{excerpt.slice(index,index+q.length)}</mark>{excerpt.slice(index+q.length)}</>}{text.length>start+240?"…":""}</>;
}
export function GlobalSearch({controller,organizationId,groups,visible,selected,onSelect,onClose,onResults}:{
  controller:ReturnType<typeof messagingController>;organizationId:string;groups:{id:string;name:string}[];visible:boolean;selected:string|null;
  onSelect:(hit:GlobalSearchHit,query:string)=>void;onClose:()=>void;onResults:(results:GlobalSearchHit[])=>void;
}) {
  const [query,setQuery]=useState(""),[type,setType]=useState("all"),[inbox,setInbox]=useState("all"),[company,setCompany]=useState(""),[sender,setSender]=useState(""),[date,setDate]=useState(""),[from,setFrom]=useState(""),[to,setTo]=useState("");
  const [results,setResults]=useState<GlobalSearchHit[]>([]),[next,setNext]=useState<{beforeDate:string;beforeKey:string}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(""),[retry,setRetry]=useState(0),[recent,setRecent]=useState<string[]>([]),[options,setOptions]=useState<z.infer<typeof optionSchema>>({companies:[],senders:[]});
  useEffect(()=>onResults(results),[results,onResults]);
  const input=useRef<HTMLInputElement>(null),version=useRef(0),pending=useRef(false);
  useEffect(()=>{if(visible)input.current?.focus();},[visible]);
  useEffect(()=>{if(!visible)return;let live=true;void controller.request('/search-options').then(v=>{if(live)setOptions(optionSchema.parse(v));}).catch(()=>{});return()=>{live=false;};},[controller,visible]);
  function parameters(){
    const p=new URLSearchParams({q:query.trim(),type,inbox});if(company)p.set('company',company);if(sender)p.set('sender',sender);
    const start=new Date();start.setHours(0,0,0,0);const end=new Date(start);end.setDate(end.getDate()+1);
    if(date==='yesterday'){end.setTime(start.getTime());start.setDate(start.getDate()-1);}else if(date==='week')start.setDate(start.getDate()-6);
    if(date&&date!=='custom'){p.set('from',start.toISOString());p.set('to',end.toISOString());}
    if(date==='custom'){if(from)p.set('from',new Date(from+'T00:00:00').toISOString());if(to){const d=new Date(to+'T00:00:00');d.setDate(d.getDate()+1);p.set('to',d.toISOString());}}
    return p;
  }
  async function load(more=false,ticket=version.current){
    if(more&&pending.current)return;
    if(date==='custom'&&from&&to&&from>to){setError('Choose an end date on or after the start date.');setBusy(false);return;}
    pending.current=true;setBusy(true);setError('');
    try{const p=parameters();if(more&&next){p.set('beforeDate',next.beforeDate);p.set('beforeKey',next.beforeKey);}
      const page=globalSearchPage.parse(await controller.request('/search?'+p));
      if(ticket!==version.current)return;
      setResults(old=>more?[...old,...page.results.filter(r=>!old.some(v=>v.key===r.key))]:page.results);setNext(page.next);
    }catch{if(ticket===version.current)setError('Search could not be completed. Please retry.');}
    finally{if(ticket===version.current){setBusy(false);pending.current=false;}}
  }
  useEffect(()=>{
    const ticket=++version.current;pending.current=false;setResults([]);setNext(null);setError('');setBusy(Boolean(query.trim()));
    if(!query.trim()){setBusy(false);return;}
    const timer=setTimeout(()=>void load(false,ticket),250);return()=>{clearTimeout(timer);++version.current;};
  },[query,type,inbox,company,sender,date,from,to,retry,controller]);
  return <div className="lc-global-search" hidden={!visible}>
    <div className="inbox-head">
      <div className="inbox-title"><h1>Search</h1></div>
      <button className="button lc-search-back" onClick={onClose}>← Back to conversations</button>
      <label className="lc-message-search"><Icon name="search"/><input ref={input} type="search" aria-label="Search all conversations" placeholder="Search all conversations…" maxLength={200} value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();onClose();}}}/></label>
      <p className="lc-search-scope">Searching all of your conversations and inboxes</p>
      <div className="tabs" role="tablist" aria-label="Search type">{['all','messages','files','people'].map(t=><button key={t} role="tab" aria-selected={type===t} className={type===t?'active':''} onClick={()=>setType(t)}>{t[0]!.toUpperCase()+t.slice(1)}</button>)}</div>
      <div className="lc-search-filters">
        <select aria-label="Company" value={company} onChange={e=>setCompany(e.target.value)}><option value="">All companies</option>{options.companies.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select>
        <select aria-label="Inbox" value={inbox} onChange={e=>setInbox(e.target.value)}><option value="all">All inboxes</option><option value="mine">My chats</option>{groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select>
        <select aria-label="Date range" value={date} onChange={e=>setDate(e.target.value)}><option value="">Any time</option><option value="today">Today</option><option value="yesterday">Yesterday</option><option value="week">Last 7 days</option><option value="custom">Date range…</option></select>
        {date==='custom'&&<><label>From<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>Through<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label></>}
      </div>
    </div>
    <div className="lc-search-results" aria-busy={busy}>
      {!query.trim()?<div className="lc-search-recent"><small>RECENT SEARCHES</small>{recent.length ? recent.map(q=><button key={q} onClick={()=>setQuery(q)}><span aria-hidden="true">◷</span>{q}<span aria-hidden="true">↗</span></button>) : <p>Your recent searches will appear here.</p>}</div>:<>
        <p className="lc-search-count" role="status">{busy&&!results.length?'Searching…':`${results.length}${next?'＋':''} results`}</p>
        {results.map(hit=><button key={hit.key} className={`lc-search-result ${selected===hit.key?'selected':''}`} aria-pressed={selected===hit.key} onClick={()=>{setRecent(old=>[query.trim(),...old.filter(v=>v!==query.trim())].slice(0,5));onSelect(hit,query);}}>
          <span className="lc-company-title-row"><strong>{conversationTitle(hit.conversation,organizationId)}</strong>{conversationGroup(hit.conversation,organizationId)&&<span className="lc-peer-group-badge">{conversationGroup(hit.conversation,organizationId)}</span>}</span>
          <small>{hit.author} · {commentTime(hit.createdAt)}</small>
          <span className="lc-search-hit-kind">{hit.internal?'🔒 Internal comment · ':''}{hit.kind==='files'?'File · ':hit.kind==='people'?'Person · ':''}{hit.conversation.inbox.kind==='group'?hit.conversation.inbox.name:'My chats'}</span>
          <span className="lc-search-excerpt"><SearchHighlight text={hit.text||'Attachment'} query={query}/></span>
        </button>)}
        {!busy&&!error&&!results.length&&<p className="lc-search-empty">No matches. Try another phrase or broaden your filters.</p>}
        {next&&<button className="button" disabled={busy} onClick={()=>void load(true)}>{busy?'Loading…':'More results'}</button>}
      </>}
      {error&&<p role="alert" className="lc-search-empty">{error} <button className="button" onClick={()=>setRetry(v=>v+1)}>Retry</button></p>}
    </div>
  </div>;
}
