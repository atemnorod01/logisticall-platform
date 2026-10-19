import type {Organization} from './model';

/** Adoption remains valid only for the exact provider pair verified at import. */
export function verifiedAdoption(org:Organization){
 const a=org.adoption;
 return a?.status==='verified'&&/^[0-9a-f-]{36}$/i.test(a.legacyOrganizationId)&&
  a.customerId===org.portaoneId&&a.domain===org.netsapiensDomain&&a.domain===a.customerId&&
  Number.isSafeInteger(a.masterAccountId)&&a.masterAccountId>0&&a.attendant==='9999'&&
  Number.isFinite(Date.parse(a.verifiedAt)) ? a : undefined;
}

export function customerBelongsToOrganization(org:Organization,customer:{i_customer?:unknown;i_parent?:unknown;refnum?:unknown}){
 if(customer.i_customer!==Number(org.portaoneId)||customer.i_parent!==289507)return false;
 const adoption=verifiedAdoption(org);
 if(adoption)return (customer.refnum??null)===adoption.customerReference;
 return [org.id,org.id.replaceAll('-','')].includes(String(customer.refnum));
}
