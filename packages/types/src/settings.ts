import { z } from "zod";
export const profileEdit = z
  .object({ name: z.string().trim().min(1).max(100) })
  .strict();
export const organizationEdit = z
  .object({ name: z.string().trim().min(1).max(120) })
  .strict();
export const inviteEdit = profileEdit.extend({ email: z.email().max(254) });
export const invitationRow = z.object({
  id: z.uuid(),
  email: z.email(),
  display_name: z.string(),
  role_id: z.string(),
  expires_at: z.string(),
  created_at: z.string(),
});
export const invitationRows = z.array(invitationRow).max(50);
export const invitationLink = z.object({
  url: z.url().refine((v) => new URL(v).protocol === "https:"),
  expires_at: z.string().nullable(),
  requires_sign_in: z.boolean(),
});
