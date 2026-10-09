import type { OrganizationContext } from "../../types/src/index.js";
export const tenantPermissions = {
  member: [
    "organization.profile.read",
    "directory.members.read",
    "self.preferences.write",
  ],
  admin: [
    "organization.profile.read",
    "directory.members.read",
    "self.preferences.write",
    "organization.profile.update",
    "services.assign",
  ],
  owner: [
    "organization.profile.read",
    "directory.members.read",
    "self.preferences.write",
    "organization.profile.update",
    "services.assign",
  ],
} as const;
export function permissionsFor(context: OrganizationContext) {
  return [...tenantPermissions[context.role_id]];
}
