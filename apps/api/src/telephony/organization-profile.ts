import { z } from "zod";

export const contactFields = {
  companyName: { label: "Company name", api: "companyname" },
  firstName: { label: "First name", api: "firstname" },
  lastName: { label: "Last name", api: "lastname" },
  contactPerson: { label: "Contact person", api: "cont1" },
  phone: { label: "Phone number", api: "phone1" },
  email: { label: "Email", api: "email" },
  country: { label: "Country", api: "country" },
  addressLine1: { label: "Address line 1", api: "baddr1" },
  addressLine2: { label: "Address line 2", api: "address_line_2" },
  city: { label: "City", api: "city" },
  state: { label: "State / province", api: "state" },
  postalCode: { label: "Postal code", api: "zip" },
} as const;
export type ContactProfile = Record<keyof typeof contactFields, string | null>;

// Only configuration fields are retained. Never persist an entire provider response.
export const standardFields = {
  i_parent: "Parent reseller ID",
  i_customer_type: "Customer type",
  i_customer_class: "Customer class ID",
  i_balance_control_type: "Billing model",
  iso_4217: "Currency",
  credit_limit: "Credit limit",
  i_billing_period: "Billing period ID",
  i_time_zone: "Time zone ID",
  time_zone_name: "Time zone",
  i_ui_time_zone: "Interface time zone ID",
  ui_time_zone_name: "Interface time zone",
  invoice_generation_enabled: "Invoice generation",
  onetime_invoice_generation_enabled: "Out-of-turn invoices",
  send_invoices: "Send invoices",
  ot_send_invoices: "Send out-of-turn invoices",
  generate_invoice_earlier: "Generate invoices early",
  i_template: "Invoice template ID",
  ot_i_template: "Out-of-turn template ID",
  inclusive_taxation: "Inclusive taxation",
  estimate_taxes: "Estimate taxes",
  i_billing_processor: "Taxation method ID",
  i_lang: "Language",
  callshop_enabled: "Callshop enabled",
  suspend_on_insuff_funds: "Suspend on insufficient funds",
  override_tariffs_enabled: "Override tariffs",
  i_tariff: "Outgoing tariff ID",
  i_tariff_incoming: "Incoming tariff ID",
  i_traffic_profile: "Traffic profile ID",
  i_vd_plan: "Volume discount plan ID",
  balance_transfer_allowed: "Balance transfers allowed",
  purge_after_months: "Retention in months",
  max_abbreviated_length: "Maximum extension length",
  pdf_generation_mode: "PDF generation mode",
  in_date_format: "Input date format",
  out_date_format: "Output date format",
  in_time_format: "Input time format",
  out_time_format: "Output time format",
  out_date_time_format: "Output date/time format",
} as const;
const featureAttributes: Record<string, readonly string[]> = {
  cli: [
    "centrex",
    "display_number",
    "display_number_check",
    "display_name_override",
    "attest",
    "account_group",
  ],
  paging: ["paging_prefix"],
  endpoint_redirect: [],
  rtpp_level: [],
  music_on_hold: ["i_moh"],
  legal_intercept: [],
  call_supervision: [
    "spy",
    "spy_dtmf",
    "whisper",
    "whisper_dtmf",
    "barge_in",
    "barge_in_dtmf",
  ],
  sip_static_contact: ["use_tcp", "user", "port", "host"],
  bundle_discount: ["i_bd_plan"],
  call_barring: ["call_barring_rules"],
  cli_trust: ["accept_caller", "supply_caller"],
  distinctive_ring_vpn: [],
  voice_quality: ["i_vq_profile"],
  first_login_greeting: [],
  sim_calls_limit: [
    "restrict_on_net",
    "max_calls_in",
    "max_bandwidth",
    "max_calls_out",
    "i_network_connectivity",
    "max_bandwidth_in",
    "max_bandwidth_out",
    "max_calls",
    "max_calls_fwd",
  ],
  permitted_sip_proxies: ["proxies"],
  group_pickup: ["group_pickup_note"],
  voice_dialing: [
    "translate_cli_out",
    "i_dial_rule",
    "translate_cli_in",
    "translate_cld_in",
  ],
  call_parking: ["park_prefix", "release_prefix"],
  voice_location: [
    "allow_roaming",
    "primary_location",
    "primary_location_data",
  ],
};
const scalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export const providerProfileSchema = z.object({
  importedAt: z.string(),
  settings: z.record(z.string(), scalar),
  serviceFeatures: z.array(
    z.object({
      name: z.string(),
      flag: z.string().nullable(),
      attributes: z.array(
        z.object({ name: z.string(), values: z.array(scalar) }),
      ),
    }),
  ),
});
export type ProviderProfile = z.infer<typeof providerProfileSchema>;
export const contactProfileSchema = z.object(
  Object.fromEntries(
    Object.keys(contactFields).map((k) => [k, z.string().nullable()]),
  ) as Record<keyof ContactProfile, z.ZodNullable<z.ZodString>>,
);

export function extractCustomerProfile(data: Record<string, unknown>): {
  contact: ContactProfile;
  portaoneProfile: ProviderProfile;
} {
  const contact = Object.fromEntries(
    Object.entries(contactFields).map(([key, { api }]) => [
      key,
      typeof data[api] === "string" ? data[api] : null,
    ]),
  ) as ContactProfile;
  const settings: ProviderProfile["settings"] = {};
  for (const key of Object.keys(standardFields)) {
    const parsed = scalar.safeParse(data[key]);
    if (parsed.success) settings[key] = parsed.data;
  }
  const serviceFeatures: ProviderProfile["serviceFeatures"] = [];
  if (Array.isArray(data.service_features))
    for (const feature of data.service_features) {
      if (
        !feature ||
        typeof feature !== "object" ||
        !Object.hasOwn(featureAttributes, feature.name)
      )
        continue;
      const allowed = featureAttributes[feature.name];
      const attributes: ProviderProfile["serviceFeatures"][number]["attributes"] =
        [];
      if (Array.isArray(feature.attributes))
        for (const attr of feature.attributes) {
          if (
            !attr ||
            !allowed!.includes(attr.name) ||
            !Array.isArray(attr.values)
          )
            continue;
          attributes.push({
            name: attr.name,
            values: attr.values.filter(
              (v: unknown) => scalar.safeParse(v).success,
            ),
          });
        }
      serviceFeatures.push({
        name: feature.name,
        flag:
          typeof feature.flag_value === "string" ? feature.flag_value : null,
        attributes,
      });
    }
  return {
    contact,
    portaoneProfile: {
      importedAt: new Date().toISOString(),
      settings,
      serviceFeatures,
    },
  };
}
