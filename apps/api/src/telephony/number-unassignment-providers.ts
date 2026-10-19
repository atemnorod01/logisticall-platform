import {z} from 'zod';
import {PortaoneFault} from './portaone';
import {DeletionRejected} from './number-errors';
import type {PortaoneRead} from './portaone-accounts';
import type {NetsapiensClient} from './netsapiens';
import type {NumberAssignment} from '../../../web/src/number-provisioning/models/number-assignment-model';
export interface NumberUnassignmentProviders {
 check(a:NumberAssignment):Promise<void>;
 alias(a:NumberAssignment):Promise<number|undefined>;
 number(a:NumberAssignment):Promise<Record<string,unknown>|undefined>;
 removeAlias(a:NumberAssignment,id:number):Promise<void>;
 removeNumber(a:NumberAssignment,record:Record<string,unknown>):Promise<void>;
}
const id=z.number().int().positive();
export function numberUnassignmentProviders(po:PortaoneRead,ns:Pick<NetsapiensClient,'readProvisionDomain'|'status'|'inventoryNumberForRemoval'|'removeInventoryNumber'>):NumberUnassignmentProviders{
 async function alias(a:NumberAssignment){
  const found=new Map<number,Record<string,unknown>>();
  for(const name of [a.number.slice(1),a.number]){
   let offset=0;
   for(;;){
    const result=await po('/Account/get_account_list',{id:name,limit:100,offset,get_total:1,get_only_real_accounts:0,with_terminated:1,get_auth_info:0});
    const rows=z.array(z.record(z.string(),z.unknown())).parse(result.account_list);
    for(const row of rows)if(String(row.id).replace(/^\+/,'')===a.number.slice(1))found.set(id.parse(row.i_account),row);
    offset+=rows.length;const total=result.total==null?undefined:z.coerce.number().int().nonnegative().parse(result.total);
    if(total!==undefined&&offset>=total||total===undefined&&rows.length<100)break;
    if(!rows.length||offset>=100000)throw new Error('Incomplete PortaOne alias lookup.');
   }
  }
  if(found.size>1)throw new Error('Multiple PortaOne accounts match this number. Nothing was removed.');
  if(!found.size)return undefined;
  const internalId=[...found.keys()][0];
  const {account_info:r}=await po('/Account/get_account_info',{i_account:internalId,get_auth_info:0}) as any;
  if(r?.i_account!==internalId||String(r.id).replace(/^\+/,'')!==a.number.slice(1)||r.i_customer!==Number(a.customerId)||r.i_master_account!==a.masterAccountId||r.billing_model!==2||a.aliasId&&a.aliasId!==internalId)throw new Error('The PortaOne alias no longer belongs to this assignment. Nothing was removed.');
  return internalId;
 }
 return {
  async check(a){
   if(!/^\+1[2-9]\d{9}$/.test(a.number)||!/^\d+$/.test(a.customerId)||!/^\d+$/.test(a.domain)||!a.masterAccountId)throw new Error('The saved number assignment is incomplete.');
   const {customer_info:c}=await po('/Customer/get_customer_info',{i_customer:Number(a.customerId),get_auth_info:0,get_rt_auth_info:0}) as any;
   const {account_info:m}=await po('/Account/get_account_info',{i_account:a.masterAccountId,get_auth_info:0}) as any;
   if(c?.i_customer!==Number(a.customerId)||c.i_parent!==289507||m?.i_customer!==c.i_customer||m.i_account!==a.masterAccountId||m.id!=='0208'+a.customerId||m.billing_model!==1)throw new Error('The PortaOne customer or PBX account ownership could not be verified.');
   const domain=await ns.readProvisionDomain(a.domain);
   if(!domain||domain.domain!==a.domain||domain.reseller!==(await ns.status()).reseller)throw new Error('NetSapiens domain ownership could not be verified.');
  },
  alias,
  number:a=>ns.inventoryNumberForRemoval(a.number,a.domain),
  async removeAlias(a,expected){
   const current=await alias(a);if(current===undefined)return;
   if(current!==expected)throw new DeletionRejected('The PortaOne alias identity changed before removal.');
   try{const result=await po('/Account/delete_alias',{alias_info:{i_account:current,i_master_account:a.masterAccountId},release_assigned_did:0,force:0});if(result.success!==1)throw new Error('PortaOne did not confirm alias removal. Resume to verify its outcome.');}
   catch(e){if(e instanceof PortaoneFault)throw new DeletionRejected(e.message);throw e;}
  },
  removeNumber:(a,record)=>ns.removeInventoryNumber(a.number,a.domain,record),
 };
}
