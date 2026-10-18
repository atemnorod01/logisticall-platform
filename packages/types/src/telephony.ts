import { z } from "zod";
export const telephonyStatus = z.object({
  preview: z.boolean().optional(),
  operation: z.enum(["enable", "disable"]).optional(),
  completedSteps: z.array(z.string()).optional(),
  operationStep: z.string().nullable().optional(),
  configured: z.boolean(),
  enabled: z.boolean(),
  state: z.enum(["disabled", "running", "interrupted", "failed", "complete"]),
  portaoneCustomerId: z.string().nullable(),
  netsapiensDomain: z.string().nullable(),
  portaoneStep: z.string().nullable(),
  netsapiensStep: z.string().nullable(),
  aliasCount: z.number().int(),
  attendantReady: z.boolean(),
  message: z.string().nullable(),
});
export type TelephonyStatus = z.infer<typeof telephonyStatus>;
export const telephonyEnable = z.object({ enabled: z.literal(true) }).strict();
export const telephonyIntegrations = z.object({
  available: z.boolean(),
  portaone: z.boolean(),
  netsapiens: z.boolean(),
  template: z.boolean(),
  portaoneLogin: z.string().default(""),
  netsapiensClientId: z.string().default(""),
  netsapiensUsername: z.string().default(""),
  netsapiensExpiresAt: z.string().nullable().default(null),
  netsapiensError: z.string().nullable().default(null),
});
export type TelephonyIntegrations = z.infer<typeof telephonyIntegrations>;

export const telephonyDisablePreview = z.object({
  action: z.literal("terminate"),
  previewHash: z.string().regex(/^[a-f0-9]{64}$/),
  description: z.string(),
  steps: z.array(z.string()),
});
export type TelephonyDisablePreview = z.infer<typeof telephonyDisablePreview>;
export const telephonyDisableInput = z.object({ enabled: z.literal(false), confirmed: z.literal(true), previewHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
