import { useEffect, useState } from 'react';
import { platformRecord, platformEdit, type PlatformRow } from '../../../packages/types/src/platform-admin.js';
import { Avatar } from './ui.js';

export function PlatformEditor({kind,id,csrf,onCreateOrganization,onClose,onSaved}:{kind:'organizations'|'directory'|'users';id:string;csrf:string;onCreateOrganization?:(()=>void)|undefined;onClose:()=>void;onSaved:()=>void}) {
 const [record,setRecord]=useState<(PlatformRow & {revision:string})|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{const abort=new AbortController();fetch(`/v1/platform/records/${kind}/${encodeURIComponent(id)}`,{signal:abort.signal}).then(async r=>{if(!r.ok)throw Error('Could not load this record. Close the editor and try again.');return platformRecord.parse(await r.json());}).then(setRecord).catch(e=>{if(!abort.signal.aborted)setError(e.message)});return()=>abort.abort();},[kind,id]);
 async function save(event:React.FormEvent<HTMLFormElement>){
  event.preventDefault();if(!record)return;
  const data=Object.fromEntries(new FormData(event.currentTarget));
  const input=platformEdit.safeParse(kind==='users'?{kind:'user',revision:record.revision,name:data.name,status:data.status??record.status}:{kind:'company',revision:record.revision,company:data});
  if(!input.success){setError('Check the highlighted fields and enter valid company details.');return;}
  setBusy(true);setError('');
  try{const r=await fetch(`/v1/platform/records/${kind}/${encodeURIComponent(id)}`,{method:'PATCH',headers:{'content-type':'application/json','x-csrf-token':csrf},body:JSON.stringify(input.data)});
   if(!r.ok)throw Error(r.status===409?'This record changed or its company identifiers are already in use. Close and reopen the editor before saving.':r.status===403?'You cannot make this change with your current access.':'Could not save changes. Please try again.');
   platformRecord.parse(await r.json());onSaved();
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 return <form className="lc-platform-form lc-platform-editor" onSubmit={e=>void save(e)}>
  <header className="lc-platform-editor-top"><h2>{kind==='users'?'Edit user':'Edit company'}</h2><button className="button" type="button" aria-label="Close editor" onClick={onClose} disabled={busy}>×</button></header>
  <div className="lc-platform-editor-body">
  <div className="lc-platform-edit-heading">{record&&<Avatar name={record.name}/>}<strong>{record?.name}</strong></div>
  {record&&kind==='directory'&&<div className="lc-platform-company-access">{record.organization_id?<span className="lc-platform-badge">On LogistiCall</span>:<button className="button" type="button" onClick={onCreateOrganization}>Create organization</button>}</div>}
  {error&&<p role="alert">{error}</p>}
  {!record&&!error&&<p>Loading details…</p>}
  {record&&<div className="lc-platform-fields">
   {kind==='users'?<>
    <label>Display name<input name="name" defaultValue={record.name} maxLength={100} required/></label>
    <label>Sign-in email<input value={record.email??''} readOnly/><small>Managed through the account’s verified email flow.</small></label>
    <label>Account status<select name="status" defaultValue={record.status??'active'} disabled={record.platform_admin}><option value="active">Active</option><option value="suspended">Suspended</option></select><small>{record.platform_admin?'Platform administrator accounts cannot be suspended here.':'Suspension blocks access across all organizations.'}</small></label>
   </>:<>
    {[
     ['name','Company name',120],['dba','DBA',160],['mc','MC number',12],['dot','USDOT number',12],['phone','Public phone',40],['email','Company email',254],['street','Street address',200],['city','City',100],['state','State / province',100],['postal_code','Postal code',20],['country','Country',60],
    ].map(([key,label,max])=><label key={key}>{label}<input name={String(key)} defaultValue={key==='phone'?(record.phones?.[0]??''):String(record[key as keyof PlatformRow]??'')} type={key==='email'?'email':'text'} maxLength={Number(max)} required={key==='name'} pattern={key==='mc'||key==='dot'?'[0-9]*':undefined}/></label>)}
    <label>Business type<select name="organization_type" defaultValue={record.organization_type??'other'}>{[['carrier','Carrier'],['broker','Broker'],['forwarder','Freight forwarder'],['shipper','Shipper'],['factoring','Factoring'],['other','Other']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
   </>}
  </div>}
  </div><footer><button className="button" type="button" onClick={onClose} disabled={busy}>Cancel</button><button className="button primary" disabled={busy||!record}>{busy?'Saving…':'Save changes'}</button></footer>
 </form>;
}
