import { z } from "zod";
import type { TelephonyResourceView } from "../../../../packages/types/src/telephony-resources";
import {
  readPortaoneAccounts,
  type PortaoneRead,
  accountTypeNames,
} from "./portaone-accounts";
import {
  extractCustomerProfile,
  contactFields,
  standardFields,
} from "./organization-profile";
import { extractDialingRuleTemplate } from "./dialing-rule-template";
import { domainDetailsSchema } from "./netsapiens-domain";
const display = (value: unknown): string =>
  value == null ? "" : String(value);
const row = z.record(z.string(), z.unknown());
const view = (title: string): TelephonyResourceView => ({
  title,
  fetchedAt: new Date().toISOString(),
  pending: false,
  fields: [],
  columns: [],
  rows: [],
});
export function pendingResources(title: string) {
  return { ...view(title), pending: true };
}
const columns = (pairs: readonly (readonly [string, string])[]) =>
  pairs.map(([key, label]) => ({ key, label }));
function project(
  input: unknown,
  pairs: readonly (readonly [string, string])[],
) {
  const data = row.parse(input);
  return Object.fromEntries(pairs.map(([key]) => [key, display(data[key])]));
}
export async function portaoneResources(
  organizationId: string,
  customerId: string,
  section: string,
  read: PortaoneRead,
): Promise<TelephonyResourceView> {
  const result = await read("/Customer/get_customer_info", {
    i_customer: Number(customerId),
    detailed_info: 1,
    get_auth_info: 0,
    get_rt_auth_info: 0,
  });
  const customer = row.parse(result.customer_info);
  if (
    String(customer.i_customer) !== customerId ||
    ![organizationId, organizationId.replace(/-/g, "")].includes(
      String(customer.refnum),
    )
  )
    throw Error("PortaOne customer ownership could not be verified.");
  if (section === "customer") {
    const data = view("PortaOne customer"),
      profile = extractCustomerProfile(customer);
    data.fields = [
      { label: "Customer ID", value: customerId },
      { label: "Name", value: display(customer.name) },
      { label: "Status", value: display(customer.bill_status) },
      { label: "Blocked", value: display(customer.blocked) },
      ...Object.entries(contactFields).map(([key, field]) => ({
        label: field.label,
        value: profile.contact[key as keyof typeof contactFields] ?? "",
      })),
      ...Object.entries(standardFields).map(([key, label]) => ({
        label,
        value: display(profile.portaoneProfile.settings[key]),
      })),
    ];
    data.columns = columns([
      ["feature", "Service feature"],
      ["flag", "Enabled"],
      ["attributes", "Settings"],
    ]);
    data.rows = profile.portaoneProfile.serviceFeatures.map((f) => ({
      feature: f.name,
      flag: f.flag ?? "",
      attributes: f.attributes
        .map((a) => `${a.name}: ${a.values.map(display).join(", ")}`)
        .join("; "),
    }));
    return data;
  }
  if (section === "accounts") {
    const accounts = await readPortaoneAccounts(customerId, read),
      data = view("Accounts and aliases");
    data.columns = columns([
      ["id", "Account / alias"],
      ["kind", "Type"],
      ["parent", "Parent account"],
      ["product", "Product"],
      ["status", "Status"],
    ]);
    data.rows = accounts.accounts.flatMap((a) => [
      {
        id: a.id,
        kind: accountTypeNames[a.type] ?? "Unknown",
        parent: "",
        product: a.productName ?? display(a.productId),
        status: a.status,
      },
      ...a.aliases.map((alias) => ({
        id: alias.id,
        kind: /@\d+\.\d+\.\d+\.\d+$/.test(alias.id)
          ? "IP alias"
          : /^\+?\d+$/.test(alias.id)
            ? "Number alias"
            : "Alias",
        parent: a.id,
        product: a.productName ?? display(a.productId),
        status:
          alias.blocked === true
            ? "Blocked"
            : alias.blocked === false
              ? "Active"
              : "Unknown",
      })),
    ]);
    return data;
  }
  if (section === "dialing-rule") {
    const profile = extractCustomerProfile(customer).portaoneProfile;
    const ruleId = z.coerce
      .number()
      .int()
      .positive()
      .parse(
        profile.serviceFeatures
          .find((f) => f.name === "voice_dialing")
          ?.attributes.find((a) => a.name === "i_dial_rule")?.values[0],
      );
    const remote = await read("/DialingRule/get_dialing_rule_info", {
      i_dialing_rule: ruleId,
      i_owner: Number(customerId),
      owner_type: "Customer",
    });
    const rule = extractDialingRuleTemplate(
        remote.dialing_rule_info,
        Number(customerId),
        ruleId,
      ),
      data = view("Customer dialing rule");
    data.fields = [
      { label: "Rule ID", value: String(ruleId) },
      { label: "Name", value: rule.sourceName },
      { label: "Description", value: rule.definition.description },
      { label: "Type", value: rule.definition.rule_type },
      { label: "Restricted", value: rule.definition.restricted },
      { label: "Usage type", value: rule.definition.usage_type },
      { label: "Translate to local", value: rule.definition.tr_rule_to_local },
      {
        label: "Translate from local",
        value: rule.definition.tr_rule_from_local,
      },
    ];
    data.columns = columns([
      ["setting", "Setting"],
      ["value", "Value"],
    ]);
    data.rows = [
      ...Object.entries(rule.definition.rule).map(([setting, value]) => ({
        setting,
        value: display(value),
      })),
      ...Object.entries(rule.definition.dial_codes).map(([setting, value]) => ({
        setting,
        value: display(value),
      })),
    ];
    return data;
  }
  throw Error("Unsupported PortaOne section");
}
const nsColumns = {
  users: [
    ["user", "Extension"],
    ["name-first-name", "First name"],
    ["name-last-name", "Last name"],
    ["email", "Email"],
    ["user-scope", "Role"],
    ["account-status", "Status"],
  ],
  devices: [
    ["device", "Device"],
    ["user", "User"],
    ["name-full-name", "Name"],
    ["device-models-model", "Model"],
    ["device-provisioning-mac-address", "MAC address"],
    ["device-sip-registration-state", "Registration"],
    ["device-sip-registration-ip-address", "IP address"],
  ],
  "phone-numbers": [
    ["phonenumber", "Phone number"],
    ["dial-rule-description", "Description"],
    ["dial-rule-application", "Application"],
    ["dial-rule-translation-destination-user", "Destination"],
    ["dial-rule-translation-destination-host", "Domain"],
    ["enabled", "Enabled"],
  ],
  "auto-attendants": [
    ["user", "Extension"],
    ["attendant-name", "Name"],
    ["starting-prompt", "Starting prompt"],
    ["time-frame", "Time frame"],
  ],
  "dial-plan": [
    ["dial-rule-matching-to-uri", "Match"],
    ["dial-rule-application", "Application"],
    ["dial-rule-translation-destination-user", "Destination"],
    ["dial-rule-translation-destination-host", "Domain"],
    ["dial-rule-description", "Description"],
    ["enabled", "Enabled"],
  ],
} as const;
const domainLabels: Record<string, string> = {
  domain: "Domain",
  reseller: "Reseller",
  description: "Description",
  "domain-type": "Domain type",
  "dial-plan": "Dial plan",
  "dial-policy": "Dialing policy",
  "time-zone": "Time zone",
  "area-code": "Area code",
  "caller-id-name": "Caller ID name",
  "email-send-from-address": "Email sender",
  "caller-id-number": "Caller ID number",
  "caller-id-number-emergency": "Emergency caller ID",
  "is-domain-locked": "Domain locked",
  "music-on-hold-enabled": "Music on hold",
  "music-on-ring-enabled": "Music on ring",
  "recording-configuration": "Recording",
  "voicemail-transcription-enabled": "Voicemail transcription",
  "limits-max-users": "User limit",
  "limits-max-active-calls-total": "Total call limit",
  "limits-max-active-calls-offnet": "External call limit",
};
export async function netsapiensResources(
  domain: string,
  section: string,
  get: (path: string) => Promise<unknown>,
): Promise<TelephonyResourceView> {
  z.string()
    .regex(/^[1-9]\d*$/)
    .parse(domain);
  const base = `/domains/${domain}`,
    details = domainDetailsSchema.parse(await get(base));
  if (details.domain !== domain || details.reseller !== "289507")
    throw Error("NetSapiens domain ownership could not be verified.");
  const data = view(
    section === "domain" ? "NetSapiens domain" : section.replaceAll("-", " "),
  );
  if (section === "domain") {
    data.fields = Object.entries(domainLabels).map(([key, label]) => ({
      label,
      value: display(details[key as keyof typeof details]),
    }));
    return data;
  }
  if (section !== "attendant-routing" && !Object.hasOwn(nsColumns, section))
    throw Error("Unsupported NetSapiens section");
  const kind = (
      section === "attendant-routing" ? "dial-plan" : section
    ) as keyof typeof nsColumns,
    pairs = nsColumns[kind];
  data.columns = columns(pairs);
  const readRows = async (path: string) => {
    const all: Record<string, unknown>[] = [],
      seen = new Set<string>();
    for (let start = 0; start < 10000; start += 100) {
      const page = z
        .array(row)
        .max(100)
        .parse(await get(`${path}?start=${start}&limit=100`));
      for (const item of page) {
        if (item.domain !== undefined && String(item.domain) !== domain)
          throw Error("NetSapiens returned another domain.");
        const signature = JSON.stringify(item);
        if (seen.has(signature))
          throw Error("NetSapiens repeated records during pagination.");
        seen.add(signature);
        all.push(item);
      }
      if (page.length < 100) return all;
    }
    throw Error("NetSapiens list exceeds the supported limit.");
  };
  const paths = {
    users: "/users",
    devices: "/devices",
    "phone-numbers": "/phonenumbers",
    "auto-attendants": "/autoattendants",
    "dial-plan": `/dialplans/${domain}/dialrules`,
  };
  let records: Record<string, unknown>[];
  try {
    records = await readRows(
      base +
        (section === "attendant-routing"
          ? `/dialplans/${domain}_9999/dialrules`
          : paths[kind]),
    );
  } catch (error) {
    if (
      kind !== "devices" ||
      !(error instanceof Error) ||
      !("status" in error) ||
      error.status !== 404
    )
      throw error;
    // Older NetSapiens exposes devices only beneath each user.
    const users = await readRows(base + "/users");
    records = [];
    for (const user of users) {
      const owner = z.string().min(1).parse(user.user);
      const devices = await readRows(
        base + `/users/${encodeURIComponent(owner)}/devices`,
      );
      if (devices.some((d) => d.user !== undefined && String(d.user) !== owner))
        throw Error("NetSapiens returned another user");
      records.push(...devices);
      if (records.length > 10000)
        throw Error("Device list exceeds the supported limit");
    }
  }
  data.rows = records.map((item) => project(item, pairs));
  if (
    kind === "auto-attendants" &&
    records.some((item) => String(item.user) === "9999")
  ) {
    const userPath = base + "/users/9999";
    const answer = row.parse(await get(userPath + "/answerrules/*"));
    if (answer.domain !== domain || String(answer.user) !== "9999")
      throw Error("Attendant ownership could not be verified");
    const forward = z
      .object({ enabled: z.string(), parameters: z.array(z.string()) })
      .parse(answer["forward-always"]);
    const greeting = row.parse(await get(userPath + "/greetings/999903"));
    const entry = forward.parameters[0];
    if (!entry || !/^(?:Announce|Prompt)_\d+$/.test(entry))
      throw Error("Unexpected attendant entry point");
    const menuDetail = row.parse(
      await get(userPath + "/autoattendants/" + entry),
    );
    if (String(menuDetail.user) !== "9999")
      throw Error("Attendant menu ownership could not be verified");
    const menu = row.parse(menuDetail["auto-attendant"]);
    data.fields = [
      { label: "No key press", value: display(menu["no-key-press"]) },
      {
        label: "Unassigned key press",
        value: display(menu["unassigned-key-press"]),
      },
      { label: "9999 default forwarding", value: forward.enabled },
      { label: "9999 destination", value: forward.parameters.join(", ") },
      {
        label: "Greeting script",
        value: display(greeting["file-script-text"]),
      },
      { label: "Voice", value: display(greeting["text-to-speech-voice-id"]) },
      {
        label: "Language",
        value: display(greeting["text-to-speech-language"]),
      },
      {
        label: "Duration (seconds)",
        value: display(greeting["file-duration-seconds"]),
      },
    ];
  }
  return data;
}
