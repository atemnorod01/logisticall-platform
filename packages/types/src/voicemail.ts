import { z } from "zod";
export const voicemailSettings = z
  .object({
    standardVoice: z
      .object({
        name: z.string().trim().min(1).max(200),
        lang: z.string().min(2).max(50),
        uri: z.string().max(500),
        category: z.string().min(1).max(100),
      })
      .strict()
      .nullable()
      .optional(),
    ringSeconds: z.number().int().min(10).max(120).multipleOf(5),
    greeting: z
      .object({
        mime: z.enum(["audio/webm", "audio/mp4", "audio/ogg"]),
        data: z
          .string()
          .min(4)
          .max(2796204)
          .regex(/^[A-Za-z0-9+/]+={0,2}$/),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type VoicemailSettings = z.infer<typeof voicemailSettings>;
export const defaultVoicemailSettings: VoicemailSettings = {
  ringSeconds: 45,
  greeting: null,
};
