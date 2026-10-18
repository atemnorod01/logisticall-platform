import { z } from "zod";
import type { IntegrationVault } from "./integration-vault";
import { extractCustomerProfile } from "./organization-profile";
import { customerTemplate } from "./organization-template";
import { extractDialingRuleTemplate } from "./dialing-rule-template";
import { extractPbxTemplate } from "./portaone-provisioning";
const baseUrl = "https://mybilling.sipresource.com:8442/rest";
const settingsSchema = z
  .object({
    login: z.string().trim().min(1).max(200),
    token: z.string().min(1).max(4096).optional(),
  })
  .strict();
export class PortaoneFault extends Error {
  constructor(readonly code: string) {
    super(`PortaOne rejected the request (${code}).`);
  }
}
export class PortaoneClient {
  private session: { id: string; expires: number } | undefined;
  private loginPending: Promise<string> | undefined;
  constructor(
    private vault: IntegrationVault,
    private request: typeof fetch = fetch,
  ) {}
  async status() {
    const value = await this.vault.get("portaone");
    const saved = value ? settingsSchema.parse(value) : undefined;
    return { configured: !!saved?.token, login: saved?.login ?? "" };
  }
  async configure(input: unknown) {
    const data = settingsSchema.parse(input);
    await this.vault.locked("portaone", async (records) => {
      const previous = await records.get("portaone");
      const saved = previous ? settingsSchema.parse(previous) : undefined;
      const token =
        data.token ?? (saved?.login === data.login ? saved.token : undefined);
      if (!token) throw Error("A PortaOne API token is required");
      await records.put("portaone", { ...data, token });
    });
    this.session = undefined;
  }
  async test() {
    const result = await this.call("/Customer/get_customer_list", {
      limit: 1,
      offset: 0,
      get_auth_info: 0,
    });
    if (!Array.isArray(result.customer_list))
      throw Error("PortaOne connection could not be verified");
  }
  private async post(path: string, params: unknown, id?: string) {
    const response = await this.request(baseUrl + path, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(30000),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        params,
        ...(id ? { auth_info: { session_id: id } } : {}),
      }),
    });
    const result = (await response.json()) as Record<string, any>;
    if (result.faultcode)
      throw new PortaoneFault(
        String(result.faultcode)
          .replace(/[^A-Za-z0-9_.-]/g, "")
          .slice(0, 150),
      );
    if (!response.ok) throw Error(`PortaOne returned HTTP ${response.status}.`);
    return result;
  }
  private async login() {
    if (this.session && this.session.expires > Date.now())
      return this.session.id;
    if (this.loginPending) return this.loginPending;
    this.loginPending = (async () => {
      const settings = settingsSchema.parse(await this.vault.get("portaone"));
      const result = await this.post("/Session/login", settings);
      const id = z.string().min(1).parse(result.session_id);
      this.session = { id, expires: Date.now() + 1800000 };
      return id;
    })();
    try {
      return await this.loginPending;
    } finally {
      this.loginPending = undefined;
    }
  }
  async call(path: string, params: unknown): Promise<Record<string, any>> {
    try {
      return await this.post(path, params, await this.login());
    } catch (error) {
      if (error instanceof PortaoneFault && /Session\./.test(error.code)) {
        this.session = undefined;
        return this.post(path, params, await this.login());
      }
      throw error;
    }
  }
  // Same reference customer and PBX account as Telephony Provisioning. Read only.
  async captureTemplate() {
    const customer = await this.call("/Customer/get_customer_info", {
      i_customer: 291127,
      detailed_info: 1,
      get_auth_info: 0,
      get_rt_auth_info: 0,
    });
    if (customer.customer_info?.i_customer !== 291127)
      throw Error("Unexpected template customer.");
    const profile = extractCustomerProfile(
      customer.customer_info,
    ).portaoneProfile;
    const ruleId = z.coerce
      .number()
      .int()
      .positive()
      .parse(
        profile.serviceFeatures
          .find((f) => f.name === "voice_dialing")
          ?.attributes.find((a) => a.name === "i_dial_rule")?.values[0],
      );
    const rule = await this.call("/DialingRule/get_dialing_rule_info", {
      i_dialing_rule: ruleId,
      i_owner: 291127,
      owner_type: "Customer",
    });
    const pbx = await this.call("/Account/get_account_info", {
      i_account: 20941265,
      detailed_info: 1,
    });
    return {
      ...customerTemplate(
        {
          id: "template",
          name: String(customer.customer_info.name),
          createdAt: new Date().toISOString(),
          portaoneId: "291127",
          netsapiensDomain: null,
        },
        profile,
      ),
      dialingRule: extractDialingRuleTemplate(
        rule.dialing_rule_info,
        291127,
        ruleId,
      ),
      pbx: extractPbxTemplate(pbx.account_info),
    };
  }
}
