import { z } from "zod";
export const resourceSections = {
  portaone: ["customer", "accounts", "dialing-rule"],
  netsapiens: [
    "domain",
    "users",
    "devices",
    "phone-numbers",
    "auto-attendants",
    "dial-plan",
    "attendant-routing",
  ],
} as const;
export type TelephonyProvider = keyof typeof resourceSections;
export const telephonyResourceView = z.object({
  title: z.string(),
  fetchedAt: z.string(),
  pending: z.boolean().default(false),
  fields: z.array(z.object({ label: z.string(), value: z.string() })),
  columns: z.array(z.object({ key: z.string(), label: z.string() })),
  rows: z.array(z.record(z.string(), z.string())).max(10000),
});
export type TelephonyResourceView = z.infer<typeof telephonyResourceView>;
