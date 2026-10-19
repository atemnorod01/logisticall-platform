import type {NumberOrder} from './number-purchase-model';
import type {NumberRelease} from './number-release-model';
export function acquiredAfterRelease(release:NumberRelease,number:string,orders:NumberOrder[]){
 const n=release.numbers.find(n=>n.number===number);
 return !!n?.cleanupUpdatedAt&&n.carrier==='released'&&n.opensips.status==='complete'&&orders.some(o=>o.accountId===release.accountId&&Date.parse(o.createdAt)>Date.parse(n.cleanupUpdatedAt!)&&o.numbers.some(n=>n.phone_number===number&&n.carrierStatus==='COMPLETE'));
}
export function releasedSincePurchase(order:NumberOrder,number:string,releases:NumberRelease[]){
 return releases.some(r=>r.accountId===order.accountId&&r.numbers.some(n=>n.number===number&&n.carrier==='released'&&n.opensips.status==='complete'&&!!n.cleanupUpdatedAt&&Date.parse(n.cleanupUpdatedAt)>Date.parse(order.createdAt)));
}
export function releaseFullyCleaned(release:NumberRelease,number:string){const n=release.numbers.find(n=>n.number===number);return !!n&&n.carrier==='released'&&n.opensips.status==='complete'&&!!n.cleanupUpdatedAt;}
