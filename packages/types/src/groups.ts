import { z } from "zod";
export const groupInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(500).default(""),
    visibility: z.enum(["private", "network"]).default("private"),
  })
  .strict();
export const groupCreate = groupInput.extend({ id: z.uuid() }).strict();
export const groupUpdate = groupInput
  .extend({ version: z.number().int().positive(), archived: z.boolean() })
  .strict();
export const groupSchema = z.object({
  id: z.uuid(),
  organization_id: z.uuid(),
  name: z.string(),
  description: z.string(),
  visibility: z.enum(["private", "network"]),
  archived: z.boolean(),
  version: z.number().int().positive(),
  member_count: z.number().int().nonnegative().optional(),
});
export type Group = z.infer<typeof groupSchema>;
export const groupList = z.object({
  groups: z.array(groupSchema).max(50),
  nextOffset: z.number().int().nullable(),
});
export const groupMemberSchema = z.object({
  user_id: z.uuid(),
  name: z.string().min(1).max(254),
  membership_key: z.string().min(1).max(100),
});
export const groupDetail = z.object({
  group: groupSchema,
  members: z.array(groupMemberSchema).max(200),
});
export const networkGroupSchema = groupSchema
  .pick({ id: true, organization_id: true, name: true, description: true })
  .extend({ organization_name: z.string() });
export const networkGroupList = z.object({
  groups: z.array(networkGroupSchema).max(50),
  nextOffset: z.number().int().nullable(),
});
