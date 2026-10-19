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

export const domainUserSchema=z.object({
  domain:id.optional(),user:id,'name-first-name':value,'name-last-name':value,email:value,
  'login-username':value,'user-scope':value,'account-status':value,department:value,site:value,
});
export const domainDeviceSchema=z.object({
  domain:id.optional(),device:id,user:id,'name-full-name':value,'device-sip-registration-state':value,
  'device-models-model':value,'device-provisioning-mac-address':value,'device-sip-registration-uri':value,
  'device-sip-registration-ip-address':value,'device-sip-registration-user-agent':value,
  'device-sip-registration-datetime':value,
});
export const domainNumberSchema=z.object({
  domain:id.optional(),phonenumber:id,enabled:value,'dial-rule-description':value,
  'dial-rule-application':value,'dial-rule-translation-destination-user':value,'dial-rule-translation-destination-host':value,
});
export type DomainDetails=z.infer<typeof domainDetailsSchema>;
export type DomainUser=z.infer<typeof domainUserSchema>;
export type DomainDevice=z.infer<typeof domainDeviceSchema>;
export type DomainNumber=z.infer<typeof domainNumberSchema>;
export type LiveSection<T>={items:T[];error:string|null};
export type NetsapiensDomainSnapshot={domain:DomainDetails;users:LiveSection<DomainUser>;devices:LiveSection<DomainDevice>;phoneNumbers:LiveSection<DomainNumber>;fetchedAt:string};
