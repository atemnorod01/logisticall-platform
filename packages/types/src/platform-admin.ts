import { z } from 'zod';
export const platformSection = z.enum(['organizations','directory','users','audit']);
export const platformQuery = z.object({search:z.string().trim().max(120).default(''),offset:z.coerce.number().int().min(0).max(1000000).default(0)}).strict();
export const companyInput = z.object({
 name:z.string().trim().min(2).max(120),organization_type:z.enum(['carrier','broker','forwarder','shipper','factoring','other']),
 dba:z.string().trim().max(160).default(''),mc:z.string().regex(/^\d{0,12}$/).default(''),dot:z.string().regex(/^\d{0,12}$/).default(''),
 phone:z.string().trim().min(3).max(40),email:z.email().max(254),street:z.string().trim().min(1).max(200),city:z.string().trim().min(1).max(100),state:z.string().trim().min(1).max(100),postal_code:z.string().trim().max(20).default(''),country:z.string().trim().min(2).max(60).default('US'),
}).strict();
export const platformCreate = z.object({request_id:z.uuid(),mode:z.enum(['directory','organization']),company_id:z.uuid().optional(),company:companyInput.optional(),owner_email:z.email().max(254).optional(),owner_name:z.string().trim().max(100).default('')}).strict().superRefine((v,ctx)=>{
 if(!v.company_id&&!v.company) ctx.addIssue({code:'custom',message:'Select an existing company or enter company details'});
 if(v.mode==='organization'&&!v.owner_email) ctx.addIssue({code:'custom',message:'Owner email required'});
 if(v.mode==='directory'&&v.company_id) ctx.addIssue({code:'custom',message:'A directory entry requires company details'});
});
export const platformResult=z.object({company_id:z.uuid(),organization_id:z.uuid().nullable(),invitation_id:z.uuid().nullable()});
export const platformRow=z.object({id:z.string(),name:z.string(),status:z.string().optional(),organization_type:z.string().optional(),organization_id:z.string().nullable().optional(),email:z.string().optional(),mc:z.string().optional(),dot:z.string().optional(),city:z.string().optional(),state:z.string().optional(),street:z.string().optional(),postal_code:z.string().optional(),country:z.string().optional(),dba:z.string().optional(),phones:z.array(z.string()).optional(),members:z.coerce.number().optional(),created_at:z.string().optional(),actor:z.string().nullable().optional(),organization:z.string().nullable().optional(),target_id:z.string().optional(),platform_admin:z.boolean().optional(),memberships:z.array(z.object({organization:z.string(),role:z.string(),status:z.string()})).optional(),invitations:z.array(z.object({id:z.uuid(),email:z.string(),expires_at:z.string()})).nullable().optional()});
export const platformPage=z.object({rows:z.array(platformRow).max(50),nextOffset:z.number().nullable()});
export type PlatformRow=z.infer<typeof platformRow>;
export type PlatformSection=z.infer<typeof platformSection>;

export const platformRecordKind=z.enum(['organizations','directory','users']);
export const companyEdit=companyInput.extend({
 phone:z.string().trim().max(40),email:z.union([z.email().max(254),z.literal('')]),
 street:z.string().trim().max(200),city:z.string().trim().max(100),state:z.string().trim().max(100),country:z.string().trim().max(60),
});
export const platformEdit=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('company'),revision:z.string().min(1).max(100),company:companyEdit}).strict(),
 z.object({kind:z.literal('user'),revision:z.string().min(1).max(100),name:z.string().trim().min(1).max(100),status:z.enum(['active','suspended'])}).strict(),
]);
export const platformRecord=platformRow.extend({revision:z.string().min(1)});
