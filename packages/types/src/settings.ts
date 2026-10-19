import { z } from "zod";
export const profileEdit = z
  .object({ name: z.string().trim().min(1).max(100) })
  .strict();
export const organizationType = z.enum([
  "broker",
  "carrier",
  "forwarder",
  "shipper",
  "factoring",
  "other",
]);
export const organizationProfile = z.object({
  organization_id: z.uuid(),
  name: z.string().max(120),
  organization_type: organizationType,
  description: z.string().max(1000),
});
export const organizationEdit = z
  .object({
    name: z.string().trim().min(1).max(120),
    organization_type: organizationType.optional(),
    description: z.string().trim().max(1000).optional(),
  })
  .strict();
export const inviteEdit = profileEdit.extend({ email: z.email().max(254) });
export const pbxExtension = z.string().regex(/^\d{2,6}$/, 'Use 2–6 digits.').refine(v=>!['112','911','988','9999'].includes(v), 'This extension is reserved.');
export const memberInviteInput = inviteEdit.extend({extension:pbxExtension.optional(),request_id:z.uuid().optional()});
export const invitationRow = z.object({
  id: z.uuid(),
  email: z.email(),
  display_name: z.string(),
  role_id: z.string(),
  user_id: z.uuid().nullable().optional(),
  expires_at: z.string(),
  created_at: z.string(),
});
export const invitationRows = z.array(invitationRow).max(50);
export const invitationLink = z.object({
  url: z.url().refine((v) => new URL(v).protocol === "https:"),
  expires_at: z.string().nullable(),
  requires_sign_in: z.boolean(),
});
export const managedMember = z.object({
  user_id: z.uuid(),
  name: z.string(),
  email: z.email(),
  role_id: z.enum(["owner", "admin", "member"]),
  status: z.enum(["pending", "active", "suspended", "archived"]),
  phone_numbers: z.array(z.string()).optional(),
  extensions: z.array(z.string()).optional(),
  presence: z.string().optional(),
  can_edit_name: z.boolean(),
  can_edit_access: z.boolean(),
  can_edit_role: z.boolean(),
});
export const memberEdit = z
  .object({
    name: z.string().trim().min(1).max(100),
    role_id: managedMember.shape.role_id,
    status: z.enum(["pending", "active", "suspended"]),
    expected: managedMember
      .pick({ name: true, role_id: true, status: true })
      .extend({ status: z.enum(["pending", "active", "suspended"]) })
      .strict(),
  })
  .strict().refine(v=>v.expected.status==='pending'?v.status==='pending':v.status!=='pending',
   {message:'Pending invitations require acceptance before activation.'});
export const managedMemberPage = z.object({
  members: z.array(managedMember).max(50),
  nextOffset: z.number().int().nullable(),
});

export const passwordResetLink = z.object({
  url: z.url().refine((v) => new URL(v).protocol === "https:"),
  expires_at: z.iso.datetime(),
});
export const memberRemovalAction = (status: string) => status === 'pending' ? 'revoke' : status === 'suspended' ? 'delete' : null;
export const memberRemovalRequest = z.object({
 membership_key:z.string().min(1).max(100),preview_hash:z.string().length(64),expected_status:z.enum(['pending','suspended']),
}).strict();
export const membershipRemoval = z.object({archive_supported:z.boolean().default(false),can_remove:z.boolean(),reason:z.string().nullable(),membership_key:z.string().min(1).max(100)});

export const memberArchivePreview=z.object({
 can_remove:z.boolean(),reason:z.string().nullable(),membership_key:z.string(),
 preview_hash:z.string(),extensions:z.array(z.string()),phone_numbers:z.array(z.string()),
 resume:z.boolean().default(false),
 action:z.enum(['revoke','delete']).nullable(),
});
export type MemberTelephony={extensions:string[];phone_numbers:string[]};
