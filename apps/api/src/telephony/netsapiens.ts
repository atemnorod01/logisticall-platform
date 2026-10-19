import {archiveConflict,memberResources,type ArchiveMember,type ArchiveResources} from './member-archive';
import {MemberCreateRejected} from './member-invitation';
import {pbxExtension} from '../../../../packages/types/src/settings';
import {NumberAssignmentRejected,DeletionRejected} from './number-errors';
import {inventoryAttendantName} from './announcement-text';
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
import { domainDetailsSchema, domainNumberSchema, domainUserSchema, type DomainUser } from "./netsapiens-domain";
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
  private reads=new Map<string,Promise<any>>();
  private get(path:string){
    const previous=this.reads.get(path);if(previous)return previous;
    const work=this.read(path).finally(()=>{if(this.reads.get(path)===work)this.reads.delete(path);});
    this.reads.set(path,work);return work;
  }
  private async read(path: string) {
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
  private scopedRows<T extends {domain?:string|undefined}>(rows:T[],domain:string){
    if(rows.some(row=>row.domain!==undefined&&row.domain!==domain))throw new Error('NetSapiens returned data for a different domain.');
    return rows;
  }
  private async domainUsers(domain:string){
    const rows:DomainUser[]=[];const seen=new Set<string>();
    for(let start=0;start<100000;start+=100){
      const page=this.scopedRows(z.array(domainUserSchema).parse(await this.get(`/domains/${encodeURIComponent(domain)}/users?start=${start}&limit=100`)),domain);
      for(const user of page){
        if(seen.has(user.user))throw new Error('NetSapiens repeated users during pagination.');
        seen.add(user.user);rows.push(user);
      }
      if(page.length<100)return rows;
    }
    throw new Error('NetSapiens user list exceeded the safety limit.');
  }
  async domainDestinationUsers(domain:string){
    const details=await this.readProvisionDomain(domain);
    if(!details||details.domain!==domain||details.reseller!==(await this.load())?.reseller)throw new Error('NetSapiens domain ownership could not be verified.');
    return this.domainUsers(domain);
  }
  async createMemberUser(domain:string,input:{name:string;email:string;extension:string}){
    pbxExtension.parse(input.extension);
    z.string().trim().min(1).max(100).parse(input.name);z.email().parse(input.email);
    const users=await this.domainDestinationUsers(domain);
    if(users.some(u=>u.user===input.extension||u.email.trim().toLowerCase()===input.email.trim().toLowerCase()))throw new MemberCreateRejected('PBX user already exists.');
    const [first,...last]=input.name.trim().split(/\s+/);
    await this.refresh();
    const response=await this.request(baseUrl+`/domains/${encodeURIComponent(domain)}/users`,{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),
      headers:{Authorization:'Bearer '+this.auth!.accessToken,'Content-Type':'application/json'},
      body:JSON.stringify({user:input.extension,'name-first-name':first,'name-last-name':last.join(' '),
        email:input.email,'user-scope':'Basic User','dial-plan':domain,'dial-policy':'US and Canada',
        'voicemail-enabled':'yes',synchronous:'yes'}),
    });
    this.reads.clear();
    if([400,401,403,404,409,422,429].includes(response.status))throw new MemberCreateRejected('PBX user creation rejected.');
    if(!response.ok)throw new Error('PBX user creation response is unconfirmed.');
  }
  async domainPhoneNumbers(domain:string){
    const details=await this.readProvisionDomain(domain);
    if(!details||details.domain!==domain||details.reseller!==(await this.load())?.reseller)throw new Error('NetSapiens domain ownership could not be verified.');
    return this.scopedRows(z.array(domainNumberSchema).parse(await this.get(`/domains/${encodeURIComponent(domain)}/phonenumbers`)),domain);
  }
  async inventoryAttendantDestination(domain:string):Promise<'9999'|null>{
    const details=await this.readProvisionDomain(domain);
    if(!details||details.domain!==domain||details.reseller!==(await this.load())?.reseller)throw new Error('NetSapiens domain ownership could not be verified.');
    const all=this.scopedRows(z.array(z.object({domain:z.string().optional(),user:z.string(),'attendant-name':z.string()})).parse(await this.get(`/domains/${domain}/autoattendants`)),domain);
    const matches=all.filter(a=>a.user==='9999');
    if(!matches.length||matches.length===1&&matches[0]!['attendant-name']!==inventoryAttendantName)return null;
    if(matches.length!==1)throw new Error('Multiple attendants use extension 9999. Review the domain before assigning numbers.');
    const user=z.object({domain:z.literal(domain),user:z.literal('9999'),'dial-plan':z.literal(`${domain}_9999`)}).parse(await this.get(`/domains/${domain}/users/9999`));
    const answer=z.object({domain:z.literal(domain),user:z.literal(user.user),enabled:z.literal('yes'),'forward-always':z.object({enabled:z.literal('yes'),parameters:z.array(z.string()).length(1)})}).parse(await this.get(`/domains/${domain}/users/9999/answerrules/*`));
    if(answer['forward-always'].parameters[0]!=='Announce_999903')throw new Error('Unassigned Inventory greeting is not active. Review attendant 9999 before assigning numbers.');
    return '9999';
  }
  async globalInventoryNumber(number:string){
    if(!/^\+1[2-9]\d{9}$/.test(number))throw new Error('Invalid telephone number.');
    const matches:ReturnType<typeof domainNumberSchema.parse>[]=[];const seen=new Set<string>();
    for(let start=0;start<100000;start+=100){
      const page=z.array(domainNumberSchema.extend({domain:z.string().min(1)})).parse(await this.get(`/phonenumbers?start=${start}&limit=100`));
      for(const n of page){
        const key=n.domain+':'+n.phonenumber;if(seen.has(key))throw new Error('NetSapiens repeated phone numbers during pagination.');seen.add(key);
        if(n.phonenumber.replace(/^\+/,'')===number.slice(1))matches.push(n);
      }
      if(page.length<100){
        if(matches.length>1)throw new Error('NetSapiens contains duplicate inventory entries for this number.');
        const n=matches[0];if(!n)return undefined;
        return n;
      }
    }
    throw new Error('NetSapiens phone number inventory exceeded the safety limit.');
  }
  async inventoryNumberForRemoval(number:string,domain:string){
    if(!/^\d+$/.test(domain))throw new Error('Invalid domain.');
    const n=await this.globalInventoryNumber(number);
    if(n&&n.domain!==domain)throw new Error('This number already belongs to another NetSapiens domain. It has not been moved.');
    return n;
  }
  async findInventoryNumber(number:string,domain:string,destination:'9999'|null=null,allowUnassigned=false){
    const n=await this.inventoryNumberForRemoval(number,domain);if(!n)return false;
        if(destination&&n.enabled==='yes'&&n['dial-rule-application']==='available-number'&&n['dial-rule-translation-destination-user']==='[*]'&&n['dial-rule-translation-destination-host']==='[*]')return allowUnassigned;
        if(n.enabled!=='yes'||n['dial-rule-application']!==(destination?'to-user':'available-number')||n['dial-rule-translation-destination-user']!==(destination??'[*]')||n['dial-rule-translation-destination-host']!==(destination?domain:'[*]'))throw new Error('This NetSapiens number already has a PBX destination or different configuration. It has not been changed.');
        return true;
  }
  async removeInventoryNumber(number:string,domain:string,expected:Record<string,unknown>){
    const details=await this.readProvisionDomain(domain);
    if(!details||details.domain!==domain||details.reseller!==(await this.load())?.reseller)throw new DeletionRejected('NetSapiens domain ownership could not be verified.');
    const current=await this.inventoryNumberForRemoval(number,domain);if(!current)return;
    if(JSON.stringify(current)!==JSON.stringify(expected))throw new DeletionRejected('The NetSapiens number changed before removal. Review its current destination.');
    await this.refresh();
    const response=await this.request(baseUrl+`/domains/${encodeURIComponent(domain)}/phonenumbers/${encodeURIComponent(current.phonenumber)}`,{method:'DELETE',redirect:'error',signal:AbortSignal.timeout(30000),headers:{Authorization:'Bearer '+this.auth!.accessToken}});
    this.reads.clear();
    if([400,401,403,409,422,429].includes(response.status))throw new DeletionRejected(`NetSapiens rejected number removal (HTTP ${response.status}).`);
    if(!response.ok&&response.status!==404)throw new Error(`NetSapiens number removal is unconfirmed (HTTP ${response.status}). Resume to verify its outcome.`);
  }
  async routeInventoryNumber(number:string,domain:string,description:string,destination:'9999'){
    if(await this.inventoryAttendantDestination(domain)!==destination)throw new NumberAssignmentRejected('Unassigned Inventory attendant is no longer available.');
    // Only an unassigned number in this domain may be routed. Never replace a user's route.
    if(!await this.findInventoryNumber(number,domain))throw new NumberAssignmentRejected('The NetSapiens inventory number is no longer available.');
    await this.refresh();
    const response=await this.request(baseUrl+`/domains/${domain}/phonenumbers`,{method:'PUT',redirect:'error',signal:AbortSignal.timeout(30000),headers:{Authorization:'Bearer '+this.auth!.accessToken,'Content-Type':'application/json'},body:JSON.stringify({phonenumber:number.slice(1),enabled:'yes','dial-rule-application':'to-user','dial-rule-translation-destination-user':destination,'dial-rule-translation-destination-host':domain,'dial-rule-description':description})});
    this.reads.clear();
    if([400,401,403,404,422,429].includes(response.status))throw new NumberAssignmentRejected(`NetSapiens rejected number routing (HTTP ${response.status}).`);
    if(!response.ok)throw new Error(`NetSapiens number routing is unconfirmed (HTTP ${response.status}). Resume to check its outcome.`);
  }
  async createInventoryNumber(number:string,domain:string,description:string,destination:'9999'|null=null){
    if(!/^\+1[2-9]\d{9}$/.test(number)||!/^\d+$/.test(domain))throw new Error('Invalid telephone number or domain.');
    if(destination&&await this.inventoryAttendantDestination(domain)!==destination)throw new NumberAssignmentRejected('Unassigned Inventory attendant is no longer available.');
    await this.refresh();
    const response=await this.request(baseUrl+`/domains/${domain}/phonenumbers`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),headers:{Authorization:'Bearer '+this.auth!.accessToken,'Content-Type':'application/json'},body:JSON.stringify({phonenumber:number.slice(1),enabled:'yes','dial-rule-application':destination?'to-user':'available-number','dial-rule-translation-destination-user':destination??'[*]','dial-rule-translation-destination-host':destination?domain:'[*]','dial-rule-description':description})});
    this.reads.clear();
    if([400,401,403,404,422,429].includes(response.status))throw new NumberAssignmentRejected(`NetSapiens rejected number creation (HTTP ${response.status}).`);
    if(!response.ok)throw new Error(`NetSapiens number creation is unconfirmed (HTTP ${response.status}). Resume to check its outcome.`);
  }
  async memberArchiveResources(domain:string,member:ArchiveMember){
    const details=await this.readProvisionDomain(domain);
    if(!details||details.reseller!==(await this.load())?.reseller)throw archiveConflict('PBX organization ownership could not be verified.');
    const [users,numbers]=await Promise.all([this.resources(domain,'users'),this.resources(domain,'phone-numbers')]);
    return memberResources(member,domain,users.rows,numbers.rows);
  }
  private async archiveWrite(path:string,method:string,body?:unknown){
    await this.refresh();
    const response=await this.request(baseUrl+path,{method,redirect:'error',signal:AbortSignal.timeout(30000),headers:{Authorization:'Bearer '+this.auth!.accessToken,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    this.reads.clear();
    if(!response.ok)throw archiveConflict('PBX cleanup could not be confirmed. Retry to check the saved progress.');
  }
  async returnMemberNumber(resources:ArchiveResources,expected:Record<string,string>,verifyOnly=false){
    const domain=resources.domain;if(!domain)throw archiveConflict('PBX domain missing.');
    if(await this.inventoryAttendantDestination(domain)!=='9999')throw archiveConflict('Unassigned extension 9999 is unavailable.');
    const current=(await this.resources(domain,'phone-numbers')).rows.find(n=>n.phonenumber===expected.phonenumber);
    if(!current)throw archiveConflict('An assigned number is no longer in this organization.');
    const isReturned=current['dial-rule-translation-destination-user']==='9999'&&current['dial-rule-translation-destination-host']===domain&&current['dial-rule-application']==='to-user'&&current.enabled==='yes';
    if(isReturned)return;
    if(verifyOnly)throw archiveConflict('Previous routing is unconfirmed. Review the number before retrying any write.');
    if(JSON.stringify(current)!==JSON.stringify(expected))throw archiveConflict('Number routing changed. Review its assignment before retrying.');
    await this.archiveWrite(`/domains/${domain}/phonenumbers`,'PUT',{
      phonenumber:expected.phonenumber,enabled:'yes','dial-rule-application':'to-user',
      'dial-rule-translation-destination-user':'9999','dial-rule-translation-destination-host':domain,
      'dial-rule-description':expected['dial-rule-description']??'',
    });
    const after=(await this.resources(domain,'phone-numbers')).rows.find(n=>n.phonenumber===expected.phonenumber);
    if(after?.['dial-rule-translation-destination-user']!=='9999'||after?.['dial-rule-translation-destination-host']!==domain||after?.['dial-rule-application']!=='to-user'||after?.enabled!=='yes')throw archiveConflict('Number routing is still updating. Retry to verify it.');
  }
  async deleteMemberExtension(resources:ArchiveResources,expected:Record<string,string>,verifyOnly=false){
    const domain=resources.domain;if(!domain||expected.user==='9999'||!/^\d{1,16}$/.test(expected.user??''))throw archiveConflict('Invalid extension.');
    const details=await this.readProvisionDomain(domain);
    if(!details||details.reseller!==(await this.load())?.reseller)throw archiveConflict('PBX organization ownership could not be verified.');
    const current=(await this.resources(domain,'users')).rows.find(u=>u.user===expected.user);
    if(!current)return;
    if(verifyOnly)throw archiveConflict('Previous extension deletion is unconfirmed. Review the extension before retrying any write.');
    if(JSON.stringify(current)!==JSON.stringify(expected))throw archiveConflict('Extension ownership changed. It has not been deleted.');
    if((await this.resources(domain,'phone-numbers')).rows.some(n=>n['dial-rule-translation-destination-user']===expected.user))throw archiveConflict('The extension still has an assigned number. Return it to inventory first.');
    await this.archiveWrite(`/domains/${domain}/users/${encodeURIComponent(expected.user!)}`,'DELETE');
    if((await this.resources(domain,'users')).rows.some(u=>u.user===expected.user))throw archiveConflict('Extension deletion is still updating. Retry to verify it.');
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
