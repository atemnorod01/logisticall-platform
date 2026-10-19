type Binding = {domain:string}|undefined;
type Row = Record<string,string>;

/** Display matches only: never grants access or changes PBX/Platform identities. */
export function memberExtensionDirectory(
 binding:(organizationId:string)=>Promise<Binding>,
 users:(domain:string)=>Promise<Row[]>,
 now:()=>number=Date.now,
){
 const cache=new Map<string,{expires:number;value:Promise<Record<string,string[]>>}>();
 return async (organizationId:string,emails:string[]):Promise<Record<string,string[]>>=>{
  // Recheck tenant enablement before consulting any cached provider data.
  const current=await binding(organizationId);
  if(!current)return {};
  const key=organizationId+':'+current.domain;
  let entry=cache.get(key);
  if(!entry||entry.expires<=now()){
   for(const [k,v] of cache)if(v.expires<=now())cache.delete(k);
   if(cache.size>=1000)cache.delete(cache.keys().next().value!);
   const value=users(current.domain).then(rows=>{
    const result:Record<string,string[]>=Object.create(null);
    for(const row of rows){
     const email=(row.email??'').trim().toLowerCase(),extension=(row.user??'').trim();
     const role=(row['user-scope']??'').replace(/[\s_-]+/g,'').toLowerCase();
     if(!email||email==='blank@replaceme.com'||role==='noportal'||!/^\d{1,20}$/.test(extension))continue;
     const list=result[email]??=[];if(!list.includes(extension))list.push(extension);
    }
    for(const list of Object.values(result))list.sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
    return result;
   });
   entry={expires:now()+60000,value};cache.set(key,entry);
   void value.catch(()=>{if(cache.get(key)?.value===value)cache.delete(key);});
  }
  const directory=await entry.value;
  return Object.fromEntries(emails.map(email=>[email,directory[email.trim().toLowerCase()]??[]]));
 };
}

/** Includes only direct number destinations in this tenant, never caller-ID numbers. */
export function memberPhoneNumbers(domain:string,extensions:string[],rows:Row[]){
 return [...new Set(rows.filter(row=>
  (!row.domain||row.domain===domain)&&row['dial-rule-application']==='to-user'&&
  row['dial-rule-translation-destination-host']===domain&&
  extensions.includes(row['dial-rule-translation-destination-user']??'')
 ).map(row=>row.phonenumber??'').filter(Boolean))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
}
export function memberTelephonyDirectory(binding:(id:string)=>Promise<Binding>,users:(domain:string)=>Promise<Row[]>,numbers:(domain:string)=>Promise<Row[]>,now:()=>number=Date.now){
 let extensions=memberExtensionDirectory(binding,users,now);
 const cache=new Map<string,{expires:number;value:Promise<Row[]>}>();
 const lookup=async(id:string,emails:string[])=>{
  const current=await binding(id);if(!current)return {};
  const key=id+':'+current.domain;
  let entry=cache.get(key);
  if(!entry||entry.expires<=now()){
   for(const [k,v] of cache)if(v.expires<=now())cache.delete(k);
   if(cache.size>=1000)cache.delete(cache.keys().next().value!);
   entry={expires:now()+60000,value:numbers(current.domain)};cache.set(key,entry);
   const value=entry.value;void value.catch(()=>{if(cache.get(key)?.value===value)cache.delete(key);});
  }
  const [ext,rows]=await Promise.all([extensions(id,emails),entry.value]);
  return Object.fromEntries(emails.map(email=>[email,{extensions:ext[email]??[],phone_numbers:memberPhoneNumbers(current.domain,ext[email]??[],rows)}]));
 };
 return Object.assign(lookup,{invalidate:()=>{cache.clear();extensions=memberExtensionDirectory(binding,users,now);}});
}
