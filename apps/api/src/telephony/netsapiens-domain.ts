import { z } from "zod";

const value = z
  .union([z.string(), z.number(), z.boolean()])
  .nullable()
  .optional()
  .transform((v) => (v == null ? "" : String(v)));
const id = z.union([z.string().min(1), z.number()]).transform(String);
// Explicit allowlists keep SIP passwords, voicemail PINs and SMTP credentials out of responses.
export const domainDetailsSchema = z.object({
  domain: id,
  reseller: id,
  description: value,
  "domain-type": value,
  "dial-plan": value,
  "dial-policy": value,
  "email-send-from-address": value,
  "time-zone": value,
  "area-code": value,
  "caller-id-name": value,
  "caller-id-number": value,
  "caller-id-number-emergency": value,
  "is-domain-locked": value,
  "music-on-hold-enabled": value,
  "music-on-ring-enabled": value,
  "recording-configuration": value,
  "voicemail-transcription-enabled": value,
  "limits-max-users": value,
  "limits-max-active-calls-total": value,
  "limits-max-active-calls-offnet": value,
});
