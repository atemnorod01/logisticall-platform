import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { Organization, PortaoneProvisioning } from "./model";
import type { Store } from "./store";
import type { PortaoneCustomerTemplate } from "./organization-template";
import { contactFields, standardFields } from "./organization-profile";
import { editableContactSchema } from "./contact-update";
import {
  newCustomerDialingRuleParams,
  newCustomerServiceFeatures,
} from "./dialing-rule-template";
import { PortaoneFault } from "./portaone";
import { concurrentWork } from "./concurrent-work";

type Request = (path: string, params: any) => Promise<any>;
type Feature = {
  name: string;
  flag_value: string;
  attributes: { name: string; values: (string | number | null)[] }[];
};
export interface PbxTemplate {
  sourceAccountId: number;
  settings: Record<string, string | number>;
  serviceFeatures: Feature[];
  aliasIps: string[];
}
export const standardAliasIps = [
  "192.92.8.151",
  "192.92.8.6",
  "192.92.8.71",
  "64.52.82.20",
  "64.52.82.25",
  "64.52.83.20",
  "64.52.83.24",
];
const pbxFields = [
  "i_product",
  "billing_model",
  "i_account_role",
  "iso_4217",
  "i_account_balance_control_type",
  "i_time_zone",
  "i_lang",
  "out_date_format",
  "out_date_time_format",
  "out_time_format",
  "in_date_format",
  "in_time_format",
];
const pbxFeatures: Record<string, string[]> = {
  default_action: ["timeout"],
  sip_static_contact: ["use_tcp", "user", "port", "host"],
  call_barring: ["call_barring_rules"],
  cps_account_limit: ["burst_method", "cps_max"],
};
const positiveId = (value: unknown) => z.number().int().positive().parse(value);
// Ephemeral, single-use proof from this execution; never persisted or accepted
// from an HTTP request. Resumes and standalone NetSapiens setup recheck live data.
const freshSetups = new WeakMap<
  Organization,
  { store: Store; at: number; fingerprint: string }
>();
const setupFingerprint = (org: Organization) =>
  JSON.stringify([org.id, org.portaoneId, org.portaoneProvisioning]);
export function consumeFreshPortaoneSetup(
  proof: Organization | undefined,
  current: Organization,
  store: Store,
) {
  if (!proof) return false;
  const receipt = freshSetups.get(proof);
  freshSetups.delete(proof);
  return (
    !!receipt &&
    receipt.store === store &&
    Date.now() - receipt.at < 60000 &&
    receipt.fingerprint === setupFingerprint(current)
  );
}

export function portaoneCustomerReference(organizationId: string) {
  // PortaOne refnum allows 32 characters. Removing UUID separators preserves every ID bit.
  return z.string().uuid().parse(organizationId).replace(/-/g, "");
}
function matchesCustomerReference(reference: unknown, organizationId: string) {
  // Retain compatibility with records accepted by an earlier integration version.
  return (
    reference === portaoneCustomerReference(organizationId) ||
    reference === organizationId
  );
}

// Capture only reusable configuration, never source credentials, balances or account snapshots.
export function extractPbxTemplate(account: any): PbxTemplate {
  if (
    account.i_account !== 20941265 ||
    account.i_customer !== 291127 ||
    account.i_product !== 30739 ||
    account.billing_model !== 1
  )
    throw new Error(
      "The reference Hosted PBX account did not match the expected source.",
    );
  const settings = Object.fromEntries(
    pbxFields
      .filter(
        (k) => typeof account[k] === "number" || typeof account[k] === "string",
      )
      .map((k) => [k, account[k]]),
  );
  const serviceFeatures = Object.entries(pbxFeatures).map(
    ([name, attributes]) => {
      const f = account.service_features?.find((f: any) => f.name === name);
      if (!f || typeof f.flag_value !== "string")
        throw new Error(`Missing PBX template feature: ${name}.`);
      return {
        name,
        flag_value: f.flag_value,
        attributes: attributes.map((name) => {
          const a = f.attributes?.find((a: any) => a.name === name);
          return {
            name,
            values: z
              .array(z.union([z.string(), z.number(), z.null()]))
              .parse(a?.values),
          };
        }),
      };
    },
  );
  serviceFeatures.push({
    name: "voice_dialing",
    flag_value: "/",
    attributes: [],
  });
  return {
    sourceAccountId: account.i_account,
    settings,
    serviceFeatures,
    aliasIps: [...standardAliasIps],
  };
}

export function newPortaoneCustomerInfo(
  organization: Organization,
  template: PortaoneCustomerTemplate,
) {
  const contact = editableContactSchema.parse(
    Object.fromEntries(
      Object.keys(contactFields).map((k) => [
        k,
        organization.contact?.[k as keyof typeof contactFields] ??
          (k === "companyName" ? organization.name : ""),
      ]),
    ),
  );
  const settings = Object.fromEntries(
    Object.keys(standardFields)
      .filter(
        (k) =>
          !["time_zone_name", "ui_time_zone_name"].includes(k) &&
          template.settings[k] != null,
      )
      .map((k) => [k, template.settings[k]]),
  );
  return {
    ...settings,
    ...Object.fromEntries(
      Object.entries(contactFields)
        .filter(([k]) => contact[k as keyof typeof contactFields] !== "")
        .map(([k, { api }]) => [api, contact[k as keyof typeof contactFields]]),
    ),
    name: organization.name,
    // A stable reference lets a retry identify this operation after a lost response.
    refnum: portaoneCustomerReference(organization.id),
    opening_balance: 0,
    ...(template.settings.invoice_generation_enabled === 0
      ? { i_template: 0 }
      : {}),
    ...(template.settings.onetime_invoice_generation_enabled === 0
      ? { ot_i_template: 0 }
      : {}),
  };
}

async function listAll(
  request: Request,
  path: string,
  key: string,
  params: Record<string, unknown>,
) {
  const all: any[] = [];
  for (let offset = 0; offset < 100000;) {
    const result = await request(path, {
      ...params,
      limit: 100,
      offset,
      get_total: 1,
    });
    const rows = result[key];
    if (!Array.isArray(rows))
      throw new Error("PortaOne returned an invalid list.");
    const total = result.total == null ? undefined : Number(result.total);
    if (total !== undefined && (!Number.isInteger(total) || total < 0))
      throw new Error("PortaOne returned an invalid record count.");
    all.push(...rows);
    offset += rows.length;
    if (total !== undefined && offset >= total) return all;
    if (!rows.length) {
      if (total !== undefined && offset < total)
        throw new Error("PortaOne returned an incomplete list.");
      return all;
    }
  }
  throw new Error("PortaOne list exceeded the safety limit.");
}
function one(rows: any[], description: string) {
  if (rows.length > 1)
    throw new Error(
      `Multiple matching ${description} records were found. Review them in PortaOne before continuing.`,
    );
  return rows[0];
}
function featureValue(record: any, name: string, attribute: string) {
  const f = record.service_features?.find((f: any) => f.name === name);
  const a = f?.attributes?.find((a: any) => a.name === attribute);
  return {
    flag: f?.effective_flag_value ?? f?.flag_value,
    values: a?.effective_values ?? a?.values,
  };
}
function assertDialing(record: any, ruleId: number, label: string) {
  const rule = featureValue(record, "voice_dialing", "i_dial_rule");
  if (rule.flag !== "Y" || String(rule.values?.[0]) !== String(ruleId))
    throw new Error(
      `${label} dialing-rule verification failed. Resume provisioning to check the assignment again.`,
    );
}
function assertPbxFeatures(account: any, features: Feature[]) {
  for (const feature of features.filter((f) => f.name !== "voice_dialing")) {
    const actual = account.service_features?.find(
      (f: any) => f.name === feature.name,
    );
    if (actual?.flag_value !== feature.flag_value)
      throw new Error(`Hosted PBX ${feature.name} verification failed.`);
    for (const attribute of feature.attributes) {
      const values = actual.attributes?.find(
        (a: any) => a.name === attribute.name,
      )?.values;
      if (
        !Array.isArray(values) ||
        values.map(String).sort().join("\0") !==
          attribute.values.map(String).sort().join("\0")
      )
        throw new Error(`Hosted PBX ${feature.name} verification failed.`);
    }
  }
}

export async function provisionPortaoneOrganization(
  store: Store,
  id: string,
  input: unknown,
  request: Request,
): Promise<Organization> {
  z.object({ confirmed: z.literal(true) })
    .strict()
    .parse(input);
  let organization = (await store.organizations()).find((o) => o.id === id);
  if (!organization) throw new Error("Organization not found.");
  if (organization.portaoneProvisioning?.status === "complete")
    return organization;
  if (organization.portaoneId && !organization.portaoneProvisioning)
    throw new Error("This organization already has a PortaOne customer.");
  const template = await store.portaoneCustomerTemplate();
  if (!template?.dialingRule || !template.pbx)
    throw new Error(
      "The shared PortaOne customer, dialing-rule and PBX templates must be configured first.",
    );
  if (
    template.pbx.aliasIps.length !== 7 ||
    new Set(template.pbx.aliasIps).size !== 7
  )
    throw new Error("The PBX template must contain seven distinct IP aliases.");
  template.pbx.aliasIps.forEach((ip) => z.ipv4().parse(ip));
  for (const key of [
    "i_parent",
    "i_customer_class",
    "i_billing_period",
    "i_time_zone",
  ])
    positiveId(template.settings[key]);
  positiveId(template.pbx.settings.i_product);
  const customerInfo = newPortaoneCustomerInfo(organization, template);
  // Validate both shared definitions before any remote writes.
  newCustomerDialingRuleParams(template, 1);
  newCustomerServiceFeatures(template, template.dialingRule.sourceRuleId + 1);
  const progress: PortaoneProvisioning = {
    ...organization.portaoneProvisioning,
    status: "running",
    step: "customer",
    customerName:
      organization.portaoneProvisioning?.pendingCreate ||
      organization.portaoneId
        ? organization.portaoneProvisioning!.customerName
        : organization.name,
    aliases: [...(organization.portaoneProvisioning?.aliases ?? [])],
  };
  delete progress.error;
  let saving: Promise<unknown> = Promise.resolve();
  const save = () => {
    const snapshot = structuredClone(progress);
    const task = saving.then(async () => {
      const updated = { ...organization!, portaoneProvisioning: snapshot };
      await store.addOrganization(updated);
      organization = updated;
    });
    saving = task.catch(() => {});
    return task;
  };
  // Save intent before each create. An uncertain write is reconciled by lookup, never blindly repeated.
  const create = async (
    key: string,
    lookup: () => Promise<number | undefined>,
    path: string,
    params: unknown,
    resultKey: string,
  ) => {
    const existing = await lookup();
    if (existing) {
      if (progress.pendingCreate === key) {
        delete progress.pendingCreate;
        await save();
      }
      return existing;
    }
    if (progress.pendingCreate === key)
      throw new Error(
        `The previous ${key} request has an unconfirmed outcome. No matching record is visible yet. Verify in PortaOne before attempting another creation.`,
      );
    if (progress.pendingCreate)
      throw new Error(
        "Another creation has an unconfirmed outcome. Verify the pending record in PortaOne before continuing.",
      );
    // Catch provider-specific customer constraints without creating a remote record.
    if (key === "customer")
      await request("/Customer/validate_customer_info", params);
    progress.pendingCreate = key;
    await save();
    let result: any;
    try {
      result = await request(path, params);
    } catch (error) {
      if (error instanceof PortaoneFault) {
        delete progress.pendingCreate;
        await save();
        throw error;
      }
      const recovered = await lookup();
      if (recovered) {
        delete progress.pendingCreate;
        await save();
        return recovered;
      }
      throw error;
    }
    const createdId = positiveId(result[resultKey]);
    // Keep the pending marker until the ID itself has been durably saved by the caller.
    return createdId;
  };
  await save();
  try {
    if (!organization!.portaoneId) {
      const customerId = await create(
        "customer",
        async () => {
          const candidates = await listAll(
            request,
            "/Customer/get_customer_list",
            "customer_list",
            {
              i_parent: template.settings.i_parent,
              name: progress.customerName,
              with_terminated: 1,
              get_auth_info: 0,
            },
          );
          const exact = one(
            candidates.filter((c) => c.name === progress.customerName),
            "customer",
          );
          if (!exact) return;
          const { customer_info: c } = await request(
            "/Customer/get_customer_info",
            { i_customer: positiveId(exact.i_customer), get_auth_info: 0 },
          );
          if (
            !matchesCustomerReference(c?.refnum, id) ||
            Number(c.i_parent) !== template.settings.i_parent
          )
            throw new Error(
              "A different PortaOne customer already uses this name. Rename the local organization or link the correct customer before provisioning.",
            );
          if (c.bill_status && c.bill_status !== "O")
            throw new Error(
              "The matching PortaOne customer is not open. Review its status before continuing.",
            );
          return positiveId(c.i_customer);
        },
        "/Customer/add_customer",
        { customer_info: { ...customerInfo, name: progress.customerName } },
        "i_customer",
      );
      organization = { ...organization!, portaoneId: String(customerId) };
      delete progress.pendingCreate;
      await save();
    }
    const customerId = positiveId(Number(organization!.portaoneId));
    const { customer_info: customer } = await request(
      "/Customer/get_customer_info",
      { i_customer: customerId, get_auth_info: 0 },
    );
    if (
      customer?.i_customer !== customerId ||
      !matchesCustomerReference(customer.refnum, id) ||
      Number(customer.i_parent) !== template.settings.i_parent
    )
      throw new Error(
        "Customer ownership verification failed. No further provisioning was attempted.",
      );
    progress.step = "dialing-rule";
    await save();
    if (!progress.dialingRuleId) {
      progress.dialingRuleId = await create(
        "dialing rule",
        async () => {
          // The reseller's general list excludes customer-owned rules. Owner lookup returns {} if none exists.
          const { dialing_rule_info: r } = await request(
            "/DialingRule/get_dialing_rule_info",
            { owner_type: "Customer", i_owner: customerId },
          );
          if (r == null) return;
          if (r.owner_type !== "Customer" || r.i_owner !== customerId)
            throw new Error(
              "The existing dialing rule belongs to another owner.",
            );
          return positiveId(r.i_dialing_rule);
        },
        "/DialingRule/add_dialing_rule",
        newCustomerDialingRuleParams(template, customerId),
        "i_dialing_rule",
      );
      delete progress.pendingCreate;
      await save();
    }
    const { dialing_rule_info: rule } = await request(
      "/DialingRule/get_dialing_rule_info",
      { i_dialing_rule: progress.dialingRuleId },
    );
    if (rule?.owner_type !== "Customer" || rule.i_owner !== customerId)
      throw new Error("Dialing-rule ownership verification failed.");
    for (const [key, value] of Object.entries(
      template.dialingRule.definition.rule,
    ))
      if (String(rule.rule?.[key]) !== String(value))
        throw new Error(
          "The customer dialing rule differs from the shared template.",
        );
    for (const [key, value] of Object.entries(
      template.dialingRule.definition.dial_codes,
    ))
      if (rule.dial_codes?.[key] !== value)
        throw new Error(
          "The customer service codes differ from the shared template.",
        );
    progress.step = "customer-settings";
    await save();
    const featuresResult = await request("/Customer/update_service_features", {
      i_customer: customerId,
      service_features: newCustomerServiceFeatures(
        template,
        progress.dialingRuleId,
      ),
    });
    if (featuresResult.i_customer !== customerId)
      throw new Error("PortaOne did not confirm the customer settings update.");
    const { customer_info: configured } = await request(
      "/Customer/get_customer_info",
      { i_customer: customerId, detailed_info: 1, get_auth_info: 0 },
    );
    assertDialing(configured, progress.dialingRuleId, "Customer");

    progress.step = "pbx-account";
    await save();
    const accountName = `0208${customerId}`;
    const validateAccount = (account: any) => {
      if (
        account?.id !== accountName ||
        account.i_customer !== customerId ||
        account.i_product !== template.pbx!.settings.i_product ||
        account.billing_model !== 1 ||
        (account.bill_status && account.bill_status !== "O") ||
        account.blocked === "Y"
      )
        throw new Error(
          "The Hosted PBX account does not match the expected customer, product or active status.",
        );
      return positiveId(account.i_account);
    };
    if (!progress.accountId) {
      progress.accountId = await create(
        "PBX account",
        async () => {
          const rows = await listAll(
            request,
            "/Account/get_account_list",
            "account_list",
            {
              i_customer: customerId,
              id: accountName,
              get_only_real_accounts: 1,
            },
          );
          const row = one(
            rows.filter((a) => a.id === accountName),
            "PBX account",
          );
          if (!row) return;
          const { account_info: account } = await request(
            "/Account/get_account_info",
            { i_account: positiveId(row.i_account), detailed_info: 1 },
          );
          return validateAccount(account);
        },
        "/Account/add_account",
        {
          account_info: {
            ...template.pbx.settings,
            id: accountName,
            login: accountName,
            i_customer: customerId,
            password: `Aa1!${randomBytes(18).toString("base64url")}`,
            h323_password: `Aa1${randomBytes(12).toString("hex")}`,
            opening_balance: 0,
            activation_date: new Date().toISOString().slice(0, 10),
            blocked: "N",
            service_features: template.pbx.serviceFeatures,
          },
        },
        "i_account",
      );
      delete progress.pendingCreate;
      await save();
    }
    const { account_info: account } = await request(
      "/Account/get_account_info",
      { i_account: progress.accountId, detailed_info: 1 },
    );
    validateAccount(account);
    assertPbxFeatures(account, template.pbx.serviceFeatures);
    assertDialing(account, progress.dialingRuleId, "Hosted PBX account");
    const aliases = () =>
      listAll(request, "/Account/get_alias_list", "alias_list", {
        i_master_account: progress.accountId,
      });
    const expectedAliases = template.pbx.aliasIps.map(
      (ip) => `${customerId}@${ip}`,
    );
    const existingAliases = await aliases();
    const findAlias = (rows: any[], alias: string) => {
      const existing = one(
        rows.filter((a) => a.id === alias),
        "alias",
      );
      if (!existing) return;
      if (
        (existing.i_master_account != null &&
          existing.i_master_account !== progress.accountId) ||
        existing.blocked !== "N"
      )
        throw new Error(
          `Alias ${alias} has a different parent account or is blocked.`,
        );
      return positiveId(existing.i_account);
    };
    const found = expectedAliases.filter((alias) =>
      findAlias(existingAliases, alias),
    );
    const pending = new Set(progress.pendingAliases ?? []);
    if (progress.pendingCreate?.startsWith("alias "))
      pending.add(progress.pendingCreate.slice(6));
    else if (progress.pendingCreate)
      throw new Error(
        "Another creation has an unconfirmed outcome. Verify the pending record in PortaOne before continuing.",
      );
    for (const alias of pending)
      if (!expectedAliases.includes(alias) || !found.includes(alias))
        throw new Error(
          `The previous alias ${alias} request has an unconfirmed outcome. No matching record is visible yet. Verify in PortaOne before attempting another creation.`,
        );
    progress.aliases = found;
    delete progress.pendingCreate;
    progress.pendingAliases = [];
    progress.step = `aliases (${found.length}/7)`;
    await save();
    await concurrentWork(
      expectedAliases.filter((alias) => !found.includes(alias)),
      7,
      async (alias) => {
        progress.pendingAliases!.push(alias);
        await save();
        try {
          const result = await request("/Account/add_alias", {
            alias_info: {
              i_master_account: progress.accountId,
              id: alias,
              i_account_role: 1,
              blocked: "N",
              realm: "",
            },
          });
          positiveId(result.i_account);
        } catch (error) {
          if (error instanceof PortaoneFault) {
            progress.pendingAliases = progress.pendingAliases!.filter(
              (item) => item !== alias,
            );
            await save();
            throw error;
          }
          // Only reads may reconcile an uncertain response; never resend a create.
          if (!findAlias(await aliases(), alias)) throw error;
        }
        progress.aliases.push(alias);
        progress.pendingAliases = progress.pendingAliases!.filter(
          (item) => item !== alias,
        );
        progress.step = `aliases (${progress.aliases.length}/7)`;
        await save();
      },
    );
    progress.step = "verification";
    await save();
    const liveAliases = await aliases();
    if (!expectedAliases.every((alias) => findAlias(liveAliases, alias)))
      throw new Error(
        "PortaOne did not return all seven active aliases. Resume to verify or finish setup.",
      );
    progress.aliases = expectedAliases;
    delete progress.pendingAliases;
    progress.status = "complete";
    progress.step = "complete";
    delete progress.error;
    await save();
    if (
      configured?.i_customer === customerId &&
      configured.bill_status === "O" &&
      configured.blocked !== "Y" &&
      account.i_product === 30739 &&
      standardAliasIps.every((ip) =>
        expectedAliases.includes(`${customerId}@${ip}`),
      )
    ) {
      freshSetups.set(organization!, {
        store,
        at: Date.now(),
        fingerprint: setupFingerprint(organization!),
      });
    }
    return organization!;
  } catch (error) {
    progress.status = "failed";
    progress.error =
      error instanceof ZodError
        ? "PortaOne returned invalid provisioning data."
        : error instanceof Error
          ? error.message
          : "PortaOne provisioning failed.";
    await save();
    throw new Error(progress.error);
  }
}

const ZodError = z.ZodError;
