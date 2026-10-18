import { z } from "zod";
import type { Organization } from "./model";
import type { Store } from "./store";
import { readPortaoneAccounts, type PortaoneRead } from "./portaone-accounts";
import {
  standardAliasIps,
  consumeFreshPortaoneSetup,
} from "./portaone-provisioning";

import {
  canProvisionNetsapiens,
  defaultNetsapiensOptions,
  netsapiensDomainPayload,
  netsapiensProvisionInput,
  NetsapiensCreateRejected,
  type NetsapiensDomainPayload,
  type NetsapiensProvisionApi,
  type NetsapiensProvisioning,
} from "./netsapiens-provisioning-options";
export * from "./netsapiens-provisioning-options";

export async function assertPortaoneReady(
  organization: Organization,
  read: PortaoneRead,
) {
  if (
    !organization.portaoneId ||
    (organization.portaoneProvisioning &&
      organization.portaoneProvisioning.status !== "complete")
  )
    throw new Error(
      "Finish PortaOne provisioning before creating a NetSapiens domain.",
    );
  const customerId = z
    .string()
    .regex(/^[1-9]\d*$/)
    .parse(organization.portaoneId);
  const result = await read("/Customer/get_customer_info", {
    i_customer: Number(customerId),
    detailed_info: 1,
    get_auth_info: 0,
    get_rt_auth_info: 0,
  });
  const customer = result.customer_info as any;
  if (
    String(customer?.i_customer) !== customerId ||
    customer.bill_status !== "O" ||
    customer.blocked === "Y"
  )
    throw new Error("PortaOne customer is missing, inactive or blocked.");
  const dialing = customer.service_features?.find(
    (f: any) => f.name === "voice_dialing",
  );
  const rule = dialing?.attributes?.find((a: any) => a.name === "i_dial_rule");
  if (
    (dialing?.effective_flag_value ?? dialing?.flag_value) !== "Y" ||
    !(Number((rule?.effective_values ?? rule?.values)?.[0]) > 0)
  )
    throw new Error(
      "PortaOne customer dialing rules are not fully configured.",
    );
  const accounts = await readPortaoneAccounts(customerId, read);
  const pbx = accounts.accounts.find(
    (a) =>
      a.id === `0208${customerId}` &&
      a.type === 1 &&
      a.productId === 30739 &&
      a.status === "Open",
  );
  if (
    !pbx ||
    !standardAliasIps.every((ip) =>
      pbx.aliases.some(
        (alias) =>
          alias.id === `${customerId}@${ip}` && alias.blocked === false,
      ),
    )
  )
    throw new Error(
      "PortaOne needs the active standard Hosted PBX account and all seven IP aliases before NetSapiens provisioning.",
    );
  const detail = await read("/Account/get_account_info", {
    i_account: pbx.internalId,
    detailed_info: 1,
  });
  const account = detail.account_info as any;
  const accountDialing = account?.service_features?.find(
    (f: any) => f.name === "voice_dialing",
  );
  const accountRule = accountDialing?.attributes?.find(
    (a: any) => a.name === "i_dial_rule",
  );
  if (
    String(account?.i_customer) !== customerId ||
    account?.i_account !== pbx.internalId ||
    (accountDialing?.effective_flag_value ?? accountDialing?.flag_value) !==
      "Y" ||
    String((accountRule?.effective_values ?? accountRule?.values)?.[0]) !==
      String((rule?.effective_values ?? rule?.values)?.[0])
  )
    throw new Error(
      "The Hosted PBX account is not using the customer dialing rule. Finish PortaOne configuration first.",
    );
}
function verifyDomain(
  actual: Record<string, string | number>,
  expected: NetsapiensDomainPayload,
) {
  for (const [key, value] of Object.entries(expected)) {
    if (key === "synchronous") continue;
    if (String(actual[key]) !== String(value))
      throw new Error(
        `NetSapiens domain verification failed for ${key}. Review the existing domain before continuing.`,
      );
  }
}
async function targetOrganization(store: Store, id: string) {
  const rows = await store.organizations();
  const organization = rows.find((o) => o.id === id);
  if (!organization) throw new Error("Organization not found.");
  if (
    rows.some(
      (o) =>
        o.id !== id &&
        (o.portaoneId === organization.portaoneId ||
          o.netsapiensDomain === organization.portaoneId),
    )
  )
    throw new Error(
      "This PortaOne customer ID is already associated with another organization.",
    );
  return organization;
}
export async function previewNetsapiensProvisioning(
  store: Store,
  id: string,
  api: NetsapiensProvisionApi,
  read: PortaoneRead,
) {
  const organization = await targetOrganization(store, id);
  if (!canProvisionNetsapiens(organization))
    throw new Error(
      "This organization is already linked or PortaOne provisioning is incomplete.",
    );
  await assertPortaoneReady(organization, read);
  const options =
    organization.netsapiensProvisioning?.options ?? defaultNetsapiensOptions;
  const payload =
    organization.netsapiensProvisioning?.payload ??
    netsapiensDomainPayload(organization, options);
  const existing = await api.readProvisionDomain(payload.domain as string);
  if (existing && !organization.netsapiensProvisioning?.pendingCreate)
    throw new Error(
      "This domain already exists in NetSapiens. Use Integrations → NetSapiens → Link Domains to connect it.",
    );
  return {
    domain: payload.domain,
    description: payload.description,
    options,
    resume: !!organization.netsapiensProvisioning?.pendingCreate,
    existing: !!existing,
  };
}
export async function provisionNetsapiensOrganization(
  store: Store,
  id: string,
  input: unknown,
  api: NetsapiensProvisionApi,
  read: PortaoneRead,
  freshPortaone?: Organization,
) {
  const data = netsapiensProvisionInput.parse(input);
  let organization = await targetOrganization(store, id);
  if (
    organization.netsapiensDomain &&
    organization.netsapiensProvisioning?.status === "complete"
  )
    return organization;
  if (!canProvisionNetsapiens(organization))
    throw new Error(
      "Finish PortaOne provisioning first, or use the existing NetSapiens link.",
    );
  if (!consumeFreshPortaoneSetup(freshPortaone, organization, store))
    await assertPortaoneReady(organization, read);
  const previous = organization.netsapiensProvisioning;
  const payload = previous?.pendingCreate
    ? previous.payload
    : netsapiensDomainPayload(organization, data.options);
  if (!payload || payload.domain !== organization.portaoneId)
    throw new Error(
      "The pending domain does not match this PortaOne customer.",
    );
  const progress: NetsapiensProvisioning = {
    status: "running",
    step: "checking",
    domain: String(payload.domain),
    payload,
    options: previous?.pendingCreate ? previous.options : data.options,
    pendingCreate: previous?.pendingCreate,
    announcement: previous?.announcement ?? {
      companyName: String(payload.description),
    },
  };
  let saving: Promise<unknown> = Promise.resolve();
  const save = () => {
    const snapshot = structuredClone(progress);
    const task = saving.then(async () => {
      const updated = { ...organization, netsapiensProvisioning: snapshot };
      await store.addOrganization(updated);
      organization = updated;
    });
    saving = task.catch(() => {});
    return task;
  };
  await save();
  try {
    let existing = await api.readProvisionDomain(progress.domain);
    if (existing && !progress.pendingCreate)
      throw new Error(
        "This domain already exists. Link it from Integrations; it has not been changed.",
      );
    if (!existing) {
      if (progress.pendingCreate)
        throw new Error(
          "The previous domain creation is not yet confirmed. No second creation was sent. Check NetSapiens, then resume verification.",
        );
      progress.step = "creating";
      progress.pendingCreate = true;
      await save();
      try {
        await api.createProvisionDomain(payload);
      } catch (error) {
        if (error instanceof NetsapiensCreateRejected) {
          delete progress.pendingCreate;
          await save();
        }
        throw error;
      }
      existing = await api.readProvisionDomain(progress.domain);
    }
    progress.step = "verifying";
    await save();
    if (!existing)
      throw new Error(
        "NetSapiens accepted the request but the domain is not visible yet. Resume to verify it.",
      );
    verifyDomain(existing, payload);
    await api.verifyProvisionResources(progress.domain, async (step) => {
      progress.step = step;
      await save();
    });
    await api.provisionAnnouncement(
      progress.domain,
      progress.announcement!,
      async (step) => {
        progress.step = step;
        await save();
      },
    );
    progress.step = "linking";
    await save();
    const completed: Organization = {
      ...organization,
      netsapiensDomain: progress.domain,
      netsapiensProvisioning: {
        status: "complete",
        step: "complete",
        domain: progress.domain,
        announcement: progress.announcement,
      },
    };
    // Keep the durable pending intent until the link and completion are saved together.
    await store.addOrganization(completed);
    return completed;
  } catch (error) {
    progress.status = "failed";
    progress.error =
      error instanceof Error
        ? error.message
        : "NetSapiens provisioning could not be confirmed.";
    await save();
    throw new Error(progress.error);
  }
}
