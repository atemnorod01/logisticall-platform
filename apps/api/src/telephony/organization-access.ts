import type {Organization} from './model';

/** Tenant access begins only after provisioning completes and stops as soon as
 * disabling starts. This check reads saved state, never provider credentials. */
export function organizationTelephonyActive(row?:{state:string;data:Organization}){
 const o=row?.data;
 return !!o&&row?.state==='complete'&&!o.disabling&&!o.termination&&
  !!o.portaoneId&&!!o.netsapiensDomain&&
  o.portaoneProvisioning?.status==='complete'&&o.netsapiensProvisioning?.status==='complete';
}
