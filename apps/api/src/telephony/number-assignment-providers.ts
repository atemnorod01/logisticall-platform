import {z} from 'zod';
import {PortaoneFault} from './portaone';
import type {PortaoneRead} from './portaone-accounts';
import type {NetsapiensClient} from './netsapiens';
import type {TelephoneInventory} from '../../../web/src/number-provisioning/models/telephone-numbers';
import {NumberAssignmentRejected} from './number-errors';
export interface NumberAssignmentProviders {
 inventory():Promise<TelephoneInventory>;
 checkCustomer(customerId:string):Promise<number>;
 findAlias(number:string,customerId:string,masterAccountId:number):Promise<number|undefined>;
 createAlias(number:string,masterAccountId:number):Promise<void>;
 checkDomain(domain:string):Promise<void>;
 defaultDestination(domain:string):Promise<'9999'|null>;
 findNumber(number:string,domain:string,destination?:'9999'|null,allowUnassigned?:boolean):Promise<boolean>;
 routeNumber(number:string,domain:string,description:string,destination:'9999'):Promise<void>;
 createNumber(number:string,domain:string,description:string,destination?:'9999'|null):Promise<void>;
}
const id=z.number().int().positive();
export function numberAssignmentProviders(po:PortaoneRead,ns:Pick<NetsapiensClient,'readProvisionDomain'|'findInventoryNumber'|'createInventoryNumber'|'inventoryAttendantDestination'|'routeInventoryNumber'|'status'>,inventory:()=>Promise<TelephoneInventory>):NumberAssignmentProviders{
 return {
  inventory,
  async checkCustomer(customerId){
   if(!/^[1-9]\d*$/.test(customerId))throw new Error('Invalid PortaOne customer ID.');
   const {customer_info:c}=await po('/Customer/get_customer_info',{i_customer:Number(customerId),get_auth_info:0,get_rt_auth_info:0}) as any;
   if(c?.i_customer!==Number(customerId)||c.bill_status!=='O'||c.blocked==='Y')throw new Error('The PortaOne customer is inactive or unavailable.');
   const {account_info:a}=await po('/Account/get_account_info',{id:'0208'+customerId,get_auth_info:0}) as any;
   if(a?.id!=='0208'+customerId||a.i_customer!==Number(customerId)||a.billing_model!==1||a.i_product!==30739||a.bill_status!=='O'||a.blocked==='Y')throw new Error('The standard active Hosted PBX account could not be verified.');
   return id.parse(a.i_account);
  },
  async findAlias(number,customerId,master){
   const found=new Map<number,any>();
   // Both accepted representations must be checked to prevent creating a second identity for the same TN.
   for(const name of [number.slice(1),number]){
    let offset=0;
    for(;;){
     const result=await po('/Account/get_account_list',{id:name,limit:100,offset,get_total:1,get_only_real_accounts:0,with_terminated:1,get_auth_info:0});
     if(!Array.isArray(result.account_list))throw new Error('Could not verify existing PortaOne number aliases.');
     for(const a of result.account_list){if(String(a.id).replace(/^\+/,'')===number.slice(1))found.set(id.parse(a.i_account),a);}
     offset+=result.account_list.length;
     const total=result.total==null?undefined:z.coerce.number().int().nonnegative().parse(result.total);
     if(total!==undefined&&offset>=total||total===undefined&&result.account_list.length<100)break;
     if(!result.account_list.length||offset>=100000)throw new Error('Incomplete PortaOne alias lookup.');
    }
   }
   if(found.size>1)throw new Error('PortaOne contains multiple accounts for this telephone number. Review them before assigning.');
   if(!found.size)return undefined;
   const internalId=Array.from(found.keys())[0];
   const {account_info:a}=await po('/Account/get_account_info',{i_account:internalId,get_auth_info:0}) as any;
   if(a?.i_account!==internalId||String(a.id).replace(/^\+/,'')!==number.slice(1)||a.i_customer!==Number(customerId)||a.i_master_account!==master||a.billing_model!==2||a.blocked!=='N'||a.bill_status!=='O')throw new Error('This telephone number already exists in PortaOne with a different account, customer, or inactive status. It has not been changed.');
   return internalId;
  },
  async createAlias(number,master){
   try{await po('/Account/add_alias',{alias_info:{i_master_account:master,id:number.slice(1),i_account_role:1,blocked:'N',realm:''}});}
   catch(e){if(e instanceof PortaoneFault&&!/exist|duplicate/i.test(e.code))throw new NumberAssignmentRejected(e.message);throw e;}
  },
  async checkDomain(domain){const details=await ns.readProvisionDomain(domain);if(!details||details.domain!==domain||details.reseller!==(await ns.status()).reseller||details['is-domain-locked']==='yes')throw new Error('The NetSapiens domain is unavailable or outside this reseller.');},
  defaultDestination:domain=>ns.inventoryAttendantDestination(domain),
  findNumber:(number,domain,destination,allowUnassigned)=>ns.findInventoryNumber(number,domain,destination,allowUnassigned),
  routeNumber:(number,domain,description,destination)=>ns.routeInventoryNumber(number,domain,description,destination),
  createNumber:(number,domain,description,destination)=>ns.createInventoryNumber(number,domain,description,destination),
 };
}
