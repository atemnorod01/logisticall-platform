import type { OrganizationContext } from "../../types/src/index.js";
export const tenantPermissions = {
  member: [
    "organization.profile.read",
    "directory.members.read",
    "self.preferences.write",
    "groups.inbox.read",
  ],
  admin: [
    "organization.profile.read",
    "directory.members.read",
    "self.preferences.write",
    "groups.inbox.read",
    "organization.profile.update",
    "services.assign",
    "groups.manage",
  ],
  owner: [
    "organization.profile.read",
    "directory.members.read",
    "self.preferences.write",
    "groups.inbox.read",
    "organization.profile.update",
    "services.assign",
    "groups.manage",
  ],
} as const;
export function permissionsFor(context: OrganizationContext) {
  return [...tenantPermissions[context.role_id]];
}
