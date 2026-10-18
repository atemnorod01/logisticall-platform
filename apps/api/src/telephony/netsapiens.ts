import { RemovalRejected } from "./organization-termination";
import {netsapiensResources} from './resource-views';
import type { IntegrationVault, SecretRecords } from "./integration-vault";
import {
  provisionCompanyAnnouncement,
  type AnnouncementProgress,
} from "./netsapiens-announcement";
import {
  createNetsapiensSpeechGreeting,
  activateNetsapiensAnnouncement,
} from "./netsapiens-announcement-api";
import { z } from "zod";
import {
  NetsapiensCreateRejected,
  type NetsapiensDomainPayload,
} from "./netsapiens-provisioning-options";
import { domainDetailsSchema } from "./netsapiens-domain";
class NetsapiensReadError extends Error {
  constructor(readonly status: number) {
    super(`NetSapiens read failed (HTTP ${status}).`);
  }
}

const baseUrl = "https://pbx.ringlogix.com/ns-api/v2";
const authSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresAt: z.number().finite().nonnegative(),
  reseller: z.literal("289507"),
  username: z.string().optional(),
});
export const netsapiensConfigurationSchema = z
  .object({
    clientId: z.string().trim().min(1).max(250),
    clientSecret: z.string().min(1).max(4096).optional(),
    username: z.string().trim().min(1).max(250),
    password: z.string().min(1).max(4096),
  })
  .strict();
type Auth = z.infer<typeof authSchema>;
const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.coerce.number().positive().finite(),
  scope: z.string().optional(),
  territory: z.string().optional(),
});
export const netsapiensDomainSchema = z.object({
  domain: z.string().regex(/^\d+$/),
  description: z.string().optional(),
  reseller: z
    .union([z.string().regex(/^\d+$/), z.number().int().positive()])
    .transform(String)
    .optional(),
});
export type NetsapiensDomain = z.infer<typeof netsapiensDomainSchema>;

export class NetsapiensClient {
  private auth: Auth | undefined;
  private refreshing: Promise<void> | undefined;
  private lastError: string | undefined;
  private retryAfter = 0;
  private connecting = false;
  constructor(
    private vault: IntegrationVault,
    private request: typeof fetch = fetch,
    private now: () => number = Date.now,
  ) {}
  private async load() {
    const value = await this.vault.get("netsapiens");
    this.auth = value === undefined ? undefined : authSchema.parse(value);
    return this.auth;
  }
  async status() {
    const auth = await this.load();
    return {
      configured: !!auth,
      baseUrl,
      clientId: auth?.clientId ?? "",
      username: auth?.username ?? "",
      hasClientSecret: !!auth?.clientSecret,
      reseller: auth?.reseller,
      expiresAt: auth ? new Date(auth.expiresAt).toISOString() : null,
      refreshing: !!this.refreshing,
      error: this.lastError ?? null,
      automaticRefresh: true,
    };
  }
  async configure(input: unknown) {
    const data = netsapiensConfigurationSchema.parse(input);
    if (this.connecting)
      throw new Error("NetSapiens configuration is already being saved.");
    this.connecting = true;
    try {
      if (this.refreshing) await this.refreshing.catch(() => {});
      const run = async (records?: SecretRecords) => {
        const stored = records
          ? await records.get("netsapiens")
          : await this.load();
        const previous =
          stored === undefined ? undefined : authSchema.parse(stored);
        const secret =
          data.clientSecret ??
          (previous?.clientId === data.clientId
            ? previous.clientSecret
            : undefined);
        if (!secret) throw new Error("Enter the NetSapiens client secret.");
        let response: Response;
        try {
          response = await this.request(baseUrl + "/tokens", {
            method: "POST",
            redirect: "error",
            signal: AbortSignal.timeout(30000),
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              grant_type: "password",
              client_id: data.clientId,
              client_secret: secret,
              username: data.username,
              password: data.password,
            }),
          });
        } catch {
          throw new Error(
            "Could not reach NetSapiens. Check connectivity and try again.",
          );
        }
        if (!response.ok)
          throw new Error(
            `NetSapiens sign-in failed (HTTP ${response.status}). Check your credentials.`,
          );
        let token: z.infer<typeof tokenSchema>;
        try {
          token = tokenSchema.parse(await response.json());
        } catch {
          throw new Error(
            "NetSapiens returned an invalid authentication response.",
          );
        }
        if (
          token.scope !== "Reseller" ||
          token.territory !== "289507" ||
          !token.refresh_token
        )
          throw new Error(
            "NetSapiens must return reseller 289507 access and a refresh token.",
          );
        const auth: Auth = {
          clientId: data.clientId,
          clientSecret: secret,
          username: data.username,
          accessToken: token.access_token,
          refreshToken: token.refresh_token,
          expiresAt: this.now() + token.expires_in * 1000,
          reseller: "289507",
        };
        if (records) await records.put("netsapiens", auth);
        else await this.vault.put("netsapiens", auth);
        this.auth = auth;
        this.lastError = undefined;
        this.retryAfter = 0;
      };
      this.refreshing = this.vault
        ? this.vault.locked("netsapiens", run)
        : run();
      await this.refreshing;
      this.refreshing = undefined;
      return this.status();
    } finally {
      if (this.connecting) {
        this.connecting = false;
        this.refreshing = undefined;
      }
    }
  }
  async refresh(force = false) {
    if (this.refreshing) return this.refreshing;
    const priorToken = this.auth?.accessToken;
    const run = async (records?: SecretRecords) => {
      const auth = records
        ? authSchema.parse(await records.get("netsapiens"))
        : await this.load();
      if (!auth) throw new Error("Configure NetSapiens API credentials first.");
      this.auth = auth;
      if (
        auth.expiresAt - this.now() > 5 * 60 * 1000 &&
        (!force || priorToken !== auth.accessToken)
      )
        return;
      if (this.now() < this.retryAfter)
        throw new Error(
          this.lastError || "NetSapiens token refresh will retry shortly.",
        );
      try {
        const response = await this.request(baseUrl + "/tokens", {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(30000),
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            grant_type: "refresh_token",
            client_id: auth.clientId,
            client_secret: auth.clientSecret,
            refresh_token: auth.refreshToken,
          }),
        });
        if (!response.ok)
          throw new Error(
            `NetSapiens token refresh failed (HTTP ${response.status}).`,
          );
        const data = tokenSchema.parse(await response.json());
        if (
          (data.scope && data.scope !== "Reseller") ||
          (data.territory && data.territory !== auth.reseller)
        )
          throw new Error("NetSapiens returned an unexpected API scope.");
        const updated = {
          ...auth,
          accessToken: data.access_token,
          refreshToken: data.refresh_token ?? auth.refreshToken,
          expiresAt: this.now() + data.expires_in * 1000,
        };
        if (records) await records.put("netsapiens", updated);
        else await this.vault.put("netsapiens", updated);
        this.auth = updated;
        this.lastError = undefined;
        this.retryAfter = 0;
      } catch (error) {
        this.lastError =
          error instanceof Error && error.message.startsWith("NetSapiens ")
            ? error.message
            : "NetSapiens token refresh failed. Check connectivity and saved credentials.";
        this.retryAfter = this.now() + 60000;
        throw new Error(this.lastError);
      }
    };
    this.refreshing = this.vault ? this.vault.locked("netsapiens", run) : run();
    try {
      await this.refreshing;
    } finally {
      this.refreshing = undefined;
    }
  }
  startAutomaticRefresh() {
    const tick = async () => {
      try {
        if (await this.load()) await this.refresh();
      } catch {
        this.lastError ??= "NetSapiens credentials could not be refreshed.";
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), 60000);
    timer.unref();
    return () => clearInterval(timer);
  }
  private async get(path: string) {
    await this.refresh();
    const send = () =>
      this.request(baseUrl + path, {
        headers: { Authorization: "Bearer " + this.auth!.accessToken },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      });
    let response = await send();
    if (response.status === 401) {
      await this.refresh(true);
      response = await send();
    }
    if (!response.ok) throw new NetsapiensReadError(response.status);
    return response.json();
  }
  async readProvisionDomain(domain: string) {
    if (!/^[1-9]\d*$/.test(domain))
      throw new Error("Invalid NetSapiens domain.");
    try {
      return domainDetailsSchema.parse(await this.get(`/domains/${domain}`));
    } catch (error) {
      if (error instanceof NetsapiensReadError && error.status === 404)
        return undefined;
      throw new Error("Could not check the existing NetSapiens domain.");
    }
  }
  async deleteDomain(domain:string){
    const existing=await this.readProvisionDomain(domain);
    if(!existing)return;
    if(existing.reseller!==(await this.load())?.reseller)throw new RemovalRejected('The NetSapiens domain does not belong to the configured reseller.');
    await this.refresh();
    let response:Response;
    try{response=await this.request(baseUrl+`/domains/${encodeURIComponent(domain)}`,{method:'DELETE',redirect:'error',signal:AbortSignal.timeout(30000),headers:{Authorization:'Bearer '+this.auth!.accessToken}});}
    catch{throw new Error('NetSapiens deletion outcome is unknown. Check again to verify whether the domain disappeared.');}
    if([400,401,403,409,422,429].includes(response.status))throw new RemovalRejected(`NetSapiens rejected domain deletion (HTTP ${response.status}). It may require dependent resources to be removed by the provider. No automatic resource cleanup was attempted.`);
    if(!response.ok&&response.status!==404)throw new Error(`NetSapiens deletion outcome is unconfirmed (HTTP ${response.status}).`);
    for(let attempt=0;attempt<10;attempt++){
      if(!await this.readProvisionDomain(domain))return;
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
    throw new Error('NetSapiens accepted deletion but the domain is still visible. Check again shortly; it has not been marked deleted.');
  }
  async createProvisionDomain(payload: NetsapiensDomainPayload) {
    await this.refresh();
    let response: Response;
    try {
      response = await this.request(baseUrl + "/domains", {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(30000),
        headers: {
          Authorization: "Bearer " + this.auth!.accessToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
    } catch {
      throw new Error(
        "The NetSapiens creation response was interrupted. Resume to check whether the domain was created.",
      );
    }
    // Do not replay writes on an ambiguous response, including 409 or 5xx.
    if ([400, 401, 403, 422, 429].includes(response.status))
      throw new NetsapiensCreateRejected(
        `NetSapiens rejected domain creation (HTTP ${response.status}). Check the connection and settings before retrying.`,
      );
    if (!response.ok)
      throw new Error(
        `NetSapiens creation could not be confirmed (HTTP ${response.status}). Resume to check its outcome.`,
      );
  }
  async provisionAnnouncement(
    domain: string,
    state: AnnouncementProgress,
    save: (step: string) => Promise<void>,
  ) {
    const existing = await this.readProvisionDomain(domain);
    if (
      !existing ||
      existing.domain !== domain ||
      existing.reseller !== (await this.load())?.reseller
    )
      throw new Error(
        "The announcement domain does not belong to the configured reseller.",
      );
    await provisionCompanyAnnouncement(
      domain,
      state,
      {
        read: async (path) => {
          try {
            return await this.get(path);
          } catch (error) {
            if (error instanceof NetsapiensReadError && error.status === 404)
              return undefined;
            throw error;
          }
        },
        write: async (method, path, body) => {
          await this.refresh();
          if (
            method === "POST" &&
            path === `/domains/${domain}/users/9999/greetings`
          ) {
            const speech = z
              .object({
                index: z.number().int().positive(),
                script: z.string(),
                voice_id: z.literal("en-US_AllisonVoice"),
                voice_language: z.literal("en-US"),
              })
              .parse(body);
            await createNetsapiensSpeechGreeting(
              {
                domain,
                user: "9999",
                index: speech.index,
                script: speech.script,
                voice: speech.voice_id,
                language: speech.voice_language,
              },
              this.auth!.accessToken,
              this.request,
            );
            return;
          }
          if (
            method === "PUT" &&
            path === `/domains/${domain}/users/9999/answerrules/*`
          ) {
            z.object({
              "forward-always": z.object({
                enabled: z.literal("yes"),
                parameters: z.tuple([z.literal("Announce_999903")]),
              }),
            }).parse(body);
            await activateNetsapiensAnnouncement(
              domain,
              this.auth!.accessToken,
              this.request,
            );
            return;
          }
          const response = await this.request(baseUrl + path, {
            method,
            redirect: "error",
            signal: AbortSignal.timeout(30000),
            headers: {
              Authorization: "Bearer " + this.auth!.accessToken,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
          });
          if ([400, 401, 403, 422, 429].includes(response.status))
            throw new NetsapiensCreateRejected(
              `NetSapiens rejected the announcement setup (HTTP ${response.status}).`,
            );
          if (!response.ok)
            throw new Error(
              `NetSapiens announcement setup could not be confirmed (HTTP ${response.status}). Resume to verify saved progress.`,
            );
        },
      },
      save,
    );
  }
  async resources(domain:string,section:string){return netsapiensResources(domain,section,this.get.bind(this));}
  async verifyProvisionResources(
    domain: string,
    onStep?: (step: "owner" | "dial-plan") => Promise<void>,
  ) {
    if (!/^[1-9]\d*$/.test(domain))
      throw new Error("Invalid NetSapiens domain.");
    try {
      await onStep?.("owner");
      const owner = z
        .object({
          domain: z.string(),
          user: z.literal("domain"),
          "dial-plan": z.string(),
          "dial-policy": z.string(),
        })
        .parse(await this.get(`/domains/${domain}/users/domain`));
      if (
        owner.domain !== domain ||
        owner["dial-plan"] !== domain ||
        owner["dial-policy"] !== "US and Canada"
      )
        throw new Error("owner");
      await onStep?.("dial-plan");
      const rules = z
        .array(
          z.object({
            domain: z.string(),
            "dial-rule-dial-plan": z
              .union([z.string(), z.number()])
              .transform(String),
            "dial-rule-application": z.string(),
          }),
        )
        .parse(
          await this.get(`/domains/${domain}/dialplans/${domain}/dialrules`),
        );
      if (
        !rules.length ||
        rules.some(
          (r) => r.domain !== domain || r["dial-rule-dial-plan"] !== domain,
        ) ||
        !rules.some(
          (r) => r["dial-rule-application"] === "<Cloud PBX Features>",
        )
      )
        throw new Error("dialplan");
    } catch {
      throw new Error(
        "The domain owner or standard dial plan is not yet verified. Resume to check the generated resources.",
      );
    }
  }
}
