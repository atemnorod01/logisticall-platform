import { z } from "zod";
import type { Organization } from "./model";

export const netsapiensTimezones = [
  "US/Eastern",
  "US/Central",
  "US/Mountain",
  "US/Pacific",
  "US/Alaska",
  "US/Hawaii",
  "America/Phoenix",
  "America/Toronto",
  "America/Vancouver",
  "America/Winnipeg",
  "America/Edmonton",
  "Canada/Atlantic",
  "Canada/Newfoundland",
] as const;
export const netsapiensOptionsSchema = z
  .object({
    timezone: z.enum(netsapiensTimezones),
    recording: z.enum(["yes", "no"]),
    externalCallLimit: z.number().int().min(0).max(10000),
    areaCode: z.string().regex(/^(?:[2-9]\d{2})?$/),
  })
  .strict();
export type NetsapiensOptions = z.infer<typeof netsapiensOptionsSchema>;
export const defaultNetsapiensOptions: NetsapiensOptions = {
  timezone: "US/Eastern",
  recording: "no",
  externalCallLimit: 0,
  areaCode: "",
};
export const netsapiensProvisionInput = z
  .object({ confirmed: z.literal(true), options: netsapiensOptionsSchema })
  .strict();
// Shared baseline: each customer gets its own identity and dial plan, never a copied number or SMTP credential.
export const netsapiensDomainDefaults = {
  "email-send-from-address": "no-reply@logisticall.app",
  "domain-type": "Standard",
  "dial-policy": "US and Canada",
  "music-on-hold-enabled": "yes",
  "music-on-ring-enabled": "no",
  "is-domain-locked": "no",
  "voicemail-transcription-enabled": "no",
  "limits-max-users": 0,
  "limits-max-active-calls-total": 0,
} as const;
export type NetsapiensDomainPayload = Record<string, string | number>;
export interface NetsapiensProvisioning {
  status: "running" | "failed" | "complete";
  step: string;
  domain: string;
  announcement?:
    import("./netsapiens-announcement").AnnouncementProgress | undefined;
  pendingCreate?: boolean | undefined;
  payload?: NetsapiensDomainPayload;
  options?: NetsapiensOptions | undefined;
  error?: string;
}
export interface NetsapiensProvisionApi {
  readProvisionDomain(
    domain: string,
  ): Promise<Record<string, string | number> | undefined>;
  createProvisionDomain(payload: NetsapiensDomainPayload): Promise<void>;
  provisionAnnouncement(
    domain: string,
    state: import("./netsapiens-announcement").AnnouncementProgress,
    save: (step: string) => Promise<void>,
  ): Promise<void>;
  verifyProvisionResources(
    domain: string,
    onStep?: (step: "owner" | "dial-plan") => Promise<void>,
  ): Promise<void>;
}
export class NetsapiensCreateRejected extends Error {}
export function canProvisionNetsapiens(organization: Organization) {
  return (
    !!organization.portaoneId &&
    !organization.netsapiensDomain &&
    (!organization.portaoneProvisioning ||
      organization.portaoneProvisioning.status === "complete")
  );
}
export function netsapiensDomainPayload(
  organization: Organization,
  options: NetsapiensOptions,
): NetsapiensDomainPayload {
  const domain = z
    .string()
    .regex(/^[1-9]\d*$/)
    .parse(organization.portaoneId);
  const name = z.string().trim().min(2).max(100).parse(organization.name);
  const settings = netsapiensOptionsSchema.parse(options);
  return {
    ...netsapiensDomainDefaults,
    domain,
    reseller: "289507",
    description: name,
    "dial-plan": domain,
    "caller-id-name": name,
    "time-zone": settings.timezone,
    "recording-configuration": settings.recording,
    "limits-max-active-calls-offnet": settings.externalCallLimit,
    ...(settings.areaCode ? { "area-code": Number(settings.areaCode) } : {}),
    synchronous: "yes",
  };
}
