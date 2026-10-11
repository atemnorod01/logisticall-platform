import { z } from 'zod';
export const industryQuery = z.object({
  search: z.string().trim().max(120).default(''),
  type: z.enum(['all','broker','carrier','shipper','factoring','other']).default('all'),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
}).strict();
export const industryOrganization = z.object({id:z.uuid(),name:z.string().min(1).max(120),organization_type:z.enum(['broker','carrier','shipper','factoring','other'])});
export const industryPage = z.object({organizations:z.array(industryOrganization).max(50),nextOffset:z.number().int().min(0).max(100000).nullable()});
export type IndustryOrganization = z.infer<typeof industryOrganization>;
