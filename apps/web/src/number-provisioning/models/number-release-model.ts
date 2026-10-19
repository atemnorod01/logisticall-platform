import {z} from 'zod';
import type {TelephoneScope} from './telephone-numbers';
import type {OpensipsRouteProgress} from './opensips';
export const releaseInput=z.object({requestId:z.string().uuid(),confirmed:z.literal(true),numbers:z.array(z.string().regex(/^\+1[2-9]\d{9}$/)).min(1).max(500).refine(n=>new Set(n).size===n.length)}).strict();
export type ReleasedNumber={number:string;carrier:'pending'|'released'|'failed';carrierUpdatedAt?:string;opensips:OpensipsRouteProgress;cleanupUpdatedAt?:string;error?:string};
export type NumberRelease=TelephoneScope&{id:string;requestId:string;customerOrderId:string;carrierOrderId?:string;createdBy:string;createdAt:string;updatedAt:string;status:'submitting'|'processing'|'review'|'complete'|'partial'|'failed';error?:string;numbers:ReleasedNumber[]};
export const releaseLabel=(r:NumberRelease)=>r.numbers.some(n=>n.carrier==='released'&&(n.opensips.status!=='complete'||!n.cleanupUpdatedAt))?'Released — routing cleanup pending':({submitting:'Submitting disconnect',processing:'Release pending',review:'Needs review',complete:'Returned to carrier',partial:'Partially returned',failed:'Disconnect failed'}[r.status]);
export const releaseBlocksNumber=(r:NumberRelease,number:string)=>r.numbers.some(n=>n.number===number&&n.carrier!=='failed');
