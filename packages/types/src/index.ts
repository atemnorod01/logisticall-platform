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
