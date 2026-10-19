import {it,expect} from 'vitest';
import {customerBelongsToOrganization,verifiedAdoption} from '../../apps/api/src/telephony/organization-adoption';
import {organizationTelephonyActive} from '../../apps/api/src/telephony/organization-access';
import type {Organization} from '../../apps/api/src/telephony/model';
const org:Organization={id:'11111111-1111-4111-8111-111111111111',name:'Imported tenant',createdAt:new Date().toISOString(),portaoneId:'123',netsapiensDomain:'123',adoption:{status:'verified',legacyOrganizationId:'22222222-2222-4222-8222-222222222222',customerId:'123',domain:'123',customerReference:null,masterAccountId:42,ipAliases:[],attendant:'9999',verifiedAt:new Date().toISOString()}};
const {adoption:omitted,...native}=org;
it('admits only the verified imported provider pair and preserves disabled access gates',()=>{
 expect(verifiedAdoption(org)).toBeTruthy();expect(organizationTelephonyActive({data:org,state:'complete'})).toBe(true);
 for(const data of [{...org,portaoneId:'456'},{...org,netsapiensDomain:'456'},native,{...org,disabling:true},{...org,termination:{status:'complete'} as NonNullable<Organization['termination']>},{...org,adoption:{...org.adoption!,verifiedAt:'invalid'}}])expect(organizationTelephonyActive({data,state:'complete'})).toBe(false);
 expect(organizationTelephonyActive({data:org,state:'failed'})).toBe(false);
});
it('preserves the verified historic reference but rejects reseller, customer and reference drift',()=>{
 const c={i_customer:123,i_parent:289507,refnum:null};expect(customerBelongsToOrganization(org,c)).toBe(true);
 for(const patch of [{i_customer:456},{i_parent:1},{refnum:'another-customer'}])expect(customerBelongsToOrganization(org,{...c,...patch})).toBe(false);
 expect(customerBelongsToOrganization(native,c)).toBe(false);
 expect(customerBelongsToOrganization(native,{...c,refnum:org.id.replaceAll('-','')})).toBe(true);
});
