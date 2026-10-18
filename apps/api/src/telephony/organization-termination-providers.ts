import {z} from 'zod';
import type {PortaoneRead} from './portaone-accounts';
import {PortaoneFault} from './portaone';
import {portaoneCustomerReference} from './portaone-provisioning';
import type {NetsapiensClient} from './netsapiens';
import type {Organization} from './model';
import {RemovalRejected,type TerminationProviders} from './organization-termination';
export function terminationProviders(request:PortaoneRead,ns:Pick<NetsapiensClient,'readProvisionDomain'|'deleteDomain'>):TerminationProviders {
 async function customer(org:Organization){
  if(!org.portaoneId)return;
  let offset=0;const seen=new Set<number>();let found=false;
  while(offset<100000){
   const result=await request('/Customer/get_customer_list',{with_terminated:1,get_auth_info:0,offset,limit:100,get_total:1});
   const rows=z.array(z.object({i_customer:z.number(),i_parent:z.number()})).parse(result.customer_list);
   for(const row of rows){if(seen.has(row.i_customer))throw Error('Customer inventory changed during verification.');seen.add(row.i_customer);if(String(row.i_customer)===org.portaoneId)found=true;if(String(row.i_parent)===org.portaoneId)throw Error('Customer has subcustomers. Review before disabling.');}
   offset+=rows.length;
   const total=result.total==null?undefined:z.coerce.number().int().nonnegative().parse(result.total);
   if(total!==undefined&&offset>=total||!rows.length&&total===undefined)break;
   if(!rows.length||offset>=100000)throw Error('Incomplete customer inventory.');
  }
  if(!found)return;
  const result=await request('/Customer/get_customer_info',{i_customer:Number(org.portaoneId),get_auth_info:0});
  const row=z.object({i_customer:z.number(),i_parent:z.number(),i_customer_type:z.number().optional(),bill_status:z.string(),refnum:z.string()}).parse(result.customer_info);
  if(String(row.i_customer)!==org.portaoneId||row.i_parent!==289507||row.i_customer_type!==undefined&&row.i_customer_type!==1||![org.id,portaoneCustomerReference(org.id)].includes(row.refnum))throw Error('PortaOne customer ownership does not match this organization.');
  return row;
 }
 async function domain(org:Organization){
  if(!org.netsapiensDomain)return;
  const row=await ns.readProvisionDomain(org.netsapiensDomain);
  if(row&&(row.domain!==org.netsapiensDomain||row.domain!==org.portaoneId||String(row.reseller)!=='289507'))throw Error('NetSapiens domain ownership does not match this organization.');
  return row;
 }
 async function write(path:string,org:Organization){
  try{const result=await request(path,{i_customer:Number(org.portaoneId),...(path.includes('terminate')?{suppress_notification:1}:{})});if(Number(result.success)!==1)throw new RemovalRejected('PortaOne did not confirm the operation. Review customer dependencies before retrying.');}
  catch(e){if(e instanceof PortaoneFault)throw new RemovalRejected(e.message);throw e;}
 }
 return {
  inspect:async org=>{const [po,nsDomain]=await Promise.all([customer(org),domain(org)]);return {terminated:po?.bill_status==='C',customerAbsent:!po,domainAbsent:!nsDomain};},
  terminateCustomer:async org=>{const row=await customer(org);if(row&&row.bill_status!=='C')await write('/Customer/terminate_customer',org);},
  deleteCustomer:async org=>{const row=await customer(org);if(!row)return;if(row.bill_status!=='C')throw new RemovalRejected('Customer must be terminated before deletion.');await write('/Customer/delete_customer',org);},
  deleteDomain:async org=>{if(await customer(org))throw new RemovalRejected('PortaOne customer must be removed before deleting NetSapiens.');if(await domain(org))await ns.deleteDomain(org.netsapiensDomain!);},
 };
}
