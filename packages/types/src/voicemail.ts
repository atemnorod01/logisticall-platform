import { z } from "zod";
export const voicemailSettings = z
  .object({
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
