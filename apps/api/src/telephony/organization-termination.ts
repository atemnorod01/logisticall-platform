import {createHash} from 'node:crypto';
import type {Organization} from './model';
import type {Store} from './store';
export class RemovalRejected extends Error {}
export type RemovalStep='terminate'|'customer'|'domain';
export interface OrganizationTermination {
 status:'running'|'failed'|'complete'; step:string; customerId:string|null; domain:string|null;
 requestedBy:string; requestedAt:string; completed:RemovalStep[]; pending?:RemovalStep; error?:string;
}
export interface TerminationProviders {
 inspect(org:Organization):Promise<{terminated:boolean;customerAbsent:boolean;domainAbsent:boolean}>;
 terminateCustomer(org:Organization):Promise<void>;
 deleteCustomer(org:Organization):Promise<void>;
 deleteDomain(org:Organization):Promise<void>;
}
export function removalHash(org:Organization){return createHash('sha256').update(JSON.stringify({id:org.id,customer:org.portaoneId,domain:org.netsapiensDomain,createdAt:org.createdAt})).digest('hex');}
export function assertRemovable(org:Organization){
 if(org.portaoneId==='292825')throw Error('Infrastructure customers cannot be removed.');
 if(org.portaoneProvisioning?.status==='running'||org.netsapiensProvisioning?.status==='running'||org.portaoneProvisioning?.pendingCreate||org.portaoneProvisioning?.pendingAliases?.length||org.netsapiensProvisioning?.pendingCreate)throw Error('Resolve unfinished provisioning before disabling telephony.');
}
export async function runTermination(store:Store,id:string,actor:string,providers:TerminationProviders){
 let org=(await store.organizations()).find(row=>row.id===id);if(!org)throw Error('Telephony record not found.');
 assertRemovable(org);
 if(org.termination?.status==='complete')return org;
 const t:OrganizationTermination=structuredClone(org.termination??{status:'running',step:'Verify provider resources',customerId:org.portaoneId,domain:org.netsapiensDomain,requestedBy:actor,requestedAt:new Date().toISOString(),completed:[]});
 const save=async()=>{org={...org!,disabling:true,termination:structuredClone(t)};await store.addOrganization(org);};
 try {
  if(t.customerId!==org.portaoneId||t.domain!==org.netsapiensDomain)throw Error('Provider links changed. Review before continuing.');
  t.status='running';delete t.error;await save();
  let state=await providers.inspect(org);
  const steps:{key:RemovalStep;label:string;matches:()=>boolean;write:()=>Promise<void>}[]=[
   {key:'terminate',label:'Terminate PortaOne customer',matches:()=>state.terminated||state.customerAbsent,write:()=>providers.terminateCustomer(org!)},
   {key:'customer',label:'Delete PortaOne customer',matches:()=>state.customerAbsent,write:()=>providers.deleteCustomer(org!)},
   {key:'domain',label:'Delete NetSapiens domain',matches:()=>state.domainAbsent,write:()=>providers.deleteDomain(org!)},
  ];
  for(const step of steps){
   t.step=step.label;await save();
   if(!step.matches()){
    if(t.completed.includes(step.key))throw Error('A previously removed resource has reappeared. Manual review is required.');
    if(t.pending)throw Error('A previous request has an unconfirmed outcome. No duplicate request was sent; resume after verifying with the provider.');
    t.pending=step.key;await save();
    try{await step.write();}catch(e){
     if(e instanceof RemovalRejected){delete t.pending;await save();throw e;}
     // A lost response may still represent a successful write. Read back, never blindly replay.
     state=await providers.inspect(org!);if(!step.matches())throw e;
    }
    state=await providers.inspect(org!);
    if(!step.matches())throw Error('The provider has not confirmed this change. Resume to verify its outcome.');
   }
   if(t.pending===step.key)delete t.pending;
   if(!t.completed.includes(step.key))t.completed.push(step.key);
   await save();
  }
  t.step='Verify both systems';await save();state=await providers.inspect(org!);
  if(!state.customerAbsent||!state.domainAbsent)throw Error('Provider resources are still present.');
  t.status='complete';t.step='Telephony disabled';await save();
 }catch(e){t.status='failed';t.error=e instanceof Error?e.message:'Disable failed.';await save();}
 return org!;
}
