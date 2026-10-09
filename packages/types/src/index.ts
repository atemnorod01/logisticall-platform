import { z } from "zod";
export const organizationContext = z.object({
  user_id: z.uuid(),
  organization_id: z.uuid(),
  name: z.string(),
  role_id: z.enum(["owner", "admin", "member"]),
  membership_status: z.literal("active"),
  organization_status: z.literal("active"),
});
export type OrganizationContext = z.infer<typeof organizationContext>;
export const organizationMembership = organizationContext
  .omit({ user_id: true })
  .extend({
    membership_status: z.enum(["pending", "active", "suspended"]),
    organization_status: z.enum(["inactive", "active", "suspended"]),
  });
export const organizationMemberships = z.array(organizationMembership).max(100);
export type OrganizationMembership = z.infer<typeof organizationMembership>;

export const directoryContact = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(254),
  email: z.email().max(254),
  presence: z
    .enum(["available", "away", "busy", "offline", "unknown"])
    .default("unknown"),
});
export type DirectoryContact = z.infer<typeof directoryContact>;
export const directoryResult = z.object({
  organization_id: z.uuid(),
  contacts: z.array(directoryContact).max(100),
});
export const directoryPage = directoryResult.extend({
  nextOffset: z.number().int().min(0).max(100000).nullable(),
});
