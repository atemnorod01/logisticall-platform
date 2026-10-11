import { z } from 'zod';
export const personalContactInput=z.object({
 name:z.string().trim().min(1).max(254),company:z.string().trim().max(254).default(''),
 email:z.union([z.email().max(254),z.literal('')]).default(''),phone:z.string().trim().max(60).default(''),
 mc:z.string().trim().max(30).default(''),dot:z.string().trim().max(30).default(''),
 sourceGroupId:z.uuid().optional(),sourceConversationId:z.uuid().optional(),sourcePersonId:z.uuid().optional(),sourceOrganizationId:z.uuid().optional(),
 note:z.string().max(4000).default(''),
}).strict();
export const personalContact=personalContactInput.extend({id:z.uuid()});
export type PersonalContact=z.infer<typeof personalContact>;
