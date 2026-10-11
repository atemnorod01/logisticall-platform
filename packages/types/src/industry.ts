import { z } from 'zod';
export const industryQuery = z.object({
  search: z.string().trim().max(120).default(''),
  type: z.enum(['all','broker','carrier','forwarder','shipper','factoring','other']).default('all'),
  offset: z.coerce.number().int().min(0).max(1000000).default(0),
}).strict();
export const industryOrganization = z.object({
  id:z.uuid(), name:z.string().min(1).max(160),
  organization_type:z.enum(['broker','carrier','forwarder','shipper','factoring','other']),
  organization_id:z.uuid().nullable().default(null),on_platform:z.boolean().default(false),
  dba:z.string().default(''),mc:z.string().default(''),dot:z.string().default(''),ff:z.string().default(''),
  status:z.enum(['active','inactive','unknown']).default('unknown'),
  phones:z.array(z.string()).max(2).default([]),street:z.string().default(''),city:z.string().default(''),state:z.string().default(''),postal_code:z.string().default(''),country:z.string().default('US'),
  email:z.string().default(''),email_kind:z.enum(['registration','public_contact','sample']).default('public_contact'),website:z.string().default(''),
  source:z.enum(['synthetic','public_sources','company_profile','fmcsa']).default('company_profile'),sources:z.array(z.string()).default([]),verified_at:z.string().nullable().default(null),
});
export const industryPage = z.object({organizations:z.array(industryOrganization).max(50),nextOffset:z.number().int().min(0).max(1000000).nullable()});
export type IndustryOrganization = z.infer<typeof industryOrganization>;
