import type {OpensipsRouteProgress} from './opensips';
import {z} from 'zod';
export const searchInputSchema=z.object({
 accountId:z.string().min(1).nullable().default(null),mode:z.enum(['areaCode','cityState','tollFree','rateCenter']),
 countryCodeA3:z.enum(['USA','CAN']).default('USA'),numberType:z.enum(['LOCAL','TOLL_FREE']).optional(),
 quantity:z.number().int().transform(n=>Math.max(1,Math.min(50,n))).default(10),offset:z.number().int().min(0).max(4990).default(0),lca:z.boolean().default(false),
 areaCode:z.string().regex(/^[2-9]\d{2}$/).optional(),city:z.string().trim().min(1).max(100).optional(),state:z.string().trim().min(1).max(40).optional(),rateCenter:z.string().trim().min(1).max(100).optional(),
}).strict().superRefine((v,c)=>{if(v.mode==='areaCode'&&!v.areaCode||v.mode==='cityState'&&!v.city||v.mode==='rateCenter'&&(!v.rateCenter||!v.state))c.addIssue({code:'custom',message:'Complete the number search criteria.'});});
export type NumberSearchInput=z.infer<typeof searchInputSchema>;
export const availableNumberSchema=z.object({phone_number:z.string().regex(/^\+1[2-9]\d{9}$/),display_number:z.string(),area_code:z.string(),city:z.string().nullable(),state:z.string().nullable(),rate_center:z.string().nullable(),number_type:z.enum(['LOCAL','TOLL_FREE'])});
export type AvailableNumber=z.infer<typeof availableNumberSchema>;
export function normalizeNumber(value:string){const n=value.replace(/[()\s+-]/g,'');const full=n.length===10?'1'+n:n;if(!/^1[2-9]\d{9}$/.test(full))throw new Error('Invalid US/Canada telephone number.');return '+'+full;}
export function displayNumber(n:string){return /^\+1\d{10}$/.test(n)?`(${n.slice(2,5)}) ${n.slice(5,8)}-${n.slice(8)}`:n;}
export function locationLabel(n:AvailableNumber){return [n.city,n.state].filter(Boolean).join(', ')||'—';}
export type CoverageOption={value:string;label:string;hint?:string;hasRegions?:boolean};
export type CoverageCountry={value:string;label:string;hasRegions:boolean;tollFree:boolean;regions:{value:string;localities:{value:string;areaCodes:string[];quantity:number|null}[]}[];areaCodes:string[]};
export type NumberState='ORDER_SUBMITTED'|'BANDWIDTH_PROCESSING'|'AWAITING_PROVISIONING'|'UNASSIGNED'|'BANDWIDTH_FAILED'|'REVIEW_REQUIRED'|'PROVISIONING'|'PROVISIONED'|'PROVISIONING_FAILED';
export type NumberOrderStep='bandwidth'|'opensips'|'portaone'|'netsapiens';
export type PurchasedNumber=AvailableNumber&{stepUpdatedAt?:Partial<Record<NumberOrderStep,string>>;orderId:string;organizationId:string|null;status:NumberState;carrierStatus:string;opensips?:OpensipsRouteProgress;assignmentId?:string;provisioningError?:string;portaoneStatus:'Pending'|'Not assigned'|'Complete';netsapiensStatus:'Pending'|'Not assigned'|'Complete'};
export type NumberOrder={id:string;requestId:string;customerOrderId:string;carrierOrderId?:string;accountId:string;siteId:string;peerId:string;organizationId:string|null;destinationLabel:string;autoProvision?:boolean;opensipsRequired?:boolean;provisionTarget?:{customerId:string;domain:string};createdBy:string;createdAt:string;updatedAt:string;status:'DRAFT'|'SUBMITTING'|'SUBMITTED'|'PROCESSING'|'COMPLETE'|'PARTIAL'|'ERROR'|'REVIEW_REQUIRED';error?:string;numbers:PurchasedNumber[];};
export const purchaseInputSchema=z.object({requestId:z.string().uuid(),confirmed:z.literal(true),organizationId:z.string().min(1).nullable(),numbers:z.array(availableNumberSchema).min(1).max(50)}).strict();
export const isOrderSettling=(o:NumberOrder)=>['DRAFT','SUBMITTING','SUBMITTED','PROCESSING'].includes(o.status);
export const orderStatusLabel:Record<NumberOrder['status'],string>={DRAFT:'Preparing order',SUBMITTING:'Submitting to carrier',SUBMITTED:'Order submitted',PROCESSING:'Carrier processing',COMPLETE:'Purchase complete',PARTIAL:'Partially completed',ERROR:'Order failed',REVIEW_REQUIRED:'Needs review'};
export const numberStatusLabel:Record<NumberState,string>={ORDER_SUBMITTED:'Order submitted',BANDWIDTH_PROCESSING:'Carrier processing',AWAITING_PROVISIONING:'Awaiting provisioning',UNASSIGNED:'Unassigned inventory',BANDWIDTH_FAILED:'Carrier failed',REVIEW_REQUIRED:'Needs review',PROVISIONING:'Provisioning',PROVISIONED:'Provisioned',PROVISIONING_FAILED:'Provisioning needs attention'};

export const isNumberOrderActive=(o:NumberOrder)=>isOrderSettling(o)||!!(o.autoProvision||o.opensipsRequired)&&o.numbers.some(n=>['AWAITING_PROVISIONING','PROVISIONING'].includes(n.status));
export function numberOrderLabel(o:NumberOrder){
 if(!o.autoProvision&&!o.opensipsRequired)return orderStatusLabel[o.status];
 if(o.numbers.some(n=>n.status==='PROVISIONING_FAILED'))return 'Provisioning needs attention';
 if(isOrderSettling(o))return orderStatusLabel[o.status];
 if(o.numbers.some(n=>['AWAITING_PROVISIONING','PROVISIONING'].includes(n.status)))return 'Provisioning';
 if(!o.autoProvision&&o.numbers.every(n=>n.status==='UNASSIGNED'&&n.opensips?.status==='complete'))return 'Inventory ready';
 if(o.numbers.every(n=>n.status==='PROVISIONED'))return 'Provisioning complete';
 if(o.numbers.some(n=>n.status==='PROVISIONED'))return 'Partially provisioned';
 return orderStatusLabel[o.status];
}
