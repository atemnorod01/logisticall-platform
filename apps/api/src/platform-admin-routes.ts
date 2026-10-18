import {resourceSections,telephonyResourceView} from '../../../packages/types/src/telephony-resources.js';
import {disabledTelephony,type TelephonyService} from './telephony/service.js';
import {telephonyEnable,telephonyDisableInput,telephonyDisablePreview} from '../../../packages/types/src/telephony.js';
import type { PresenceStore } from './presence.js';
import {
  platformInvite,
  platformInviteResult,
} from "../../../packages/types/src/platform-admin.js";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  platformRecordKind,
  platformEdit,
  platformRecord,
  platformSection,
  platformQuery,
  platformCreate,
  platformResult,
  platformPage,
  platformRow,
} from "../../../packages/types/src/platform-admin.js";
import {
  invitationLink,
  invitationRows,
} from "../../../packages/types/src/settings.js";
export function platformAdminRoutes(
  app: FastifyInstance,
  options: {
    telephony?: TelephonyService | undefined;
    actorId?: ((token:string)=>Promise<string>) | undefined;
    profileChanged?: ((id: string, name: string) => Promise<void>) | undefined;
    organizationChanged?: ((id: string, name: string) => Promise<void>) | undefined;
    presence?: PresenceStore | undefined;
    authorize: (req: FastifyRequest) => Promise<string>;
    request: (
      token: string,
      path: string,
      method?: string,
      body?: unknown,
    ) => Promise<unknown>;
  },
) {
  const telephony = () => {if(!options.telephony)throw Object.assign(Error('Telephony is not configured'),{statusCode:503});return options.telephony;};
  const actorId = async (token:string) => z.uuid().parse(await options.actorId?.(token));
  app.get('/v1/platform/organizations/:id/telephony',async req=>{
    const token=await options.authorize(req), id=z.uuid().parse((req.params as {id:string}).id);
    await options.request(token,`/platform/records/organizations/${id}`);
    return options.telephony?options.telephony.status(id):disabledTelephony;
  });
  app.get('/v1/platform/organizations/:id/telephony/:provider/:section',async req=>{
    const token=await options.authorize(req);
    const params=z.object({id:z.uuid(),provider:z.enum(['portaone','netsapiens']),section:z.string()}).parse(req.params);
    z.object({}).strict().parse(req.query);
    if(!(resourceSections[params.provider] as readonly string[]).includes(params.section))throw Object.assign(Error('Invalid section'),{statusCode:400});
    const record=platformRecord.parse(await options.request(token,`/platform/records/organizations/${params.id}`));
    if((record.organization_id??record.id)!==params.id)throw Object.assign(Error('Organization mismatch'),{statusCode:409});
    return telephonyResourceView.parse(await telephony().resources(params.id,params.provider,params.section));
  });
  app.get('/v1/platform/organizations/:id/telephony/disable-preview',async req=>{
    const token=await options.authorize(req),id=z.uuid().parse((req.params as {id:string}).id);
    const record=platformRecord.parse(await options.request(token,`/platform/records/organizations/${id}`));
    if((record.organization_id??record.id)!==id)throw Object.assign(Error('Organization mismatch'),{statusCode:409});
    return telephonyDisablePreview.parse(await telephony().previewDisable(record));
  });
  app.post('/v1/platform/organizations/:id/telephony',async(req,reply)=>{
    const token=await options.authorize(req),id=z.uuid().parse((req.params as {id:string}).id);
    const input=z.union([telephonyEnable,telephonyDisableInput]).parse(req.body);
    const record=platformRecord.parse(await options.request(token,`/platform/records/organizations/${id}`));
    if((record.organization_id??record.id)!==id)throw Object.assign(Error('Organization mismatch'),{statusCode:409});
    const status=input.enabled
      ? await telephony().enable(record,await actorId(token))
      : await telephony().disable(record,await actorId(token),input.previewHash);
    return reply.code(['complete','disabled'].includes(status.state)?200:202).send(status);
  });
  app.get('/v1/platform/telephony/integrations',async req=>{await options.authorize(req);return options.telephony?options.telephony.integrations():{available:false,portaone:false,netsapiens:false,template:false};});
  app.put('/v1/platform/telephony/integrations/:provider',async req=>{
    const token=await options.authorize(req),provider=z.enum(['portaone','netsapiens']).parse((req.params as {provider:string}).provider);
    await telephony().configure(provider,req.body,await actorId(token));return {ok:true};
  });
  app.post('/v1/platform/telephony/integrations/:provider/test',async req=>{await options.authorize(req);z.object({}).strict().parse(req.body);await telephony().test(z.enum(['portaone','netsapiens']).parse((req.params as {provider:string}).provider));return {ok:true};});
  app.post('/v1/platform/telephony/template',async req=>{
    const token=await options.authorize(req);z.object({}).strict().parse(req.body);
    await telephony().captureTemplate(await actorId(token));return {ok:true};
  });
  app.get('/v1/platform/user-presence', async (req, reply) => {
    await options.authorize(req);
    const {ids} = z.object({ids: z.string().transform(s => s.split(',')).pipe(z.array(z.uuid()).min(1).max(50))}).strict().parse(req.query);
    reply.header('Cache-Control', 'no-store');
    return {presence: await options.presence?.users?.(ids) ?? Object.fromEntries(ids.map(id => [id, 'unknown']))};
  });
  app.get('/v1/platform/directory-presence',async req=>{
    await options.authorize(req);
    const {ids}=z.object({ids:z.string().transform(s=>s.split(',')).pipe(z.array(z.uuid()).max(50))}).strict().parse(req.query);
    const statuses=await options.presence?.publicTeams?.(ids);
    return {presence:statuses??Object.fromEntries(ids.map(id=>[id,'unknown']))};
  });
  app.get("/v1/platform/:section", async (req) => {
    const token = await options.authorize(req),
      section = platformSection.parse(
        (req.params as { section: string }).section,
      ),
      q = platformQuery.extend({telephony_only:z.enum(['true','false']).optional()}).parse(req.query);
    if(q.telephony_only === 'true' && section !== 'organizations')throw Object.assign(Error('Telephony filter applies only to organizations'),{statusCode:400});
    const enabled=new Set(section === 'organizations' ? await options.telephony?.enabledOrganizationIds() ?? [] : []);
    const fetchPage=async(offset:number,limit:number)=>platformPage.parse(await options.request(token,`/platform/${section}?${new URLSearchParams({search:q.search,offset:String(offset),limit:String(limit)})}`));
    const annotate=(row:typeof platformRow._output)=>section === 'organizations' ? {...row,telephony_enabled:enabled.has(row.organization_id??row.id)} : row;
    if(q.telephony_only !== 'true') {
      const page=await fetchPage(q.offset,q.limit);
      return {...page,rows:page.rows.map(annotate)};
    }
    if(!enabled.size)return {rows:[],nextOffset:null};
    // IAM owns search and ordering. Filter its pages before applying the requested
    // offset, so a sparse enabled list never loses organizations between pages.
    const matches:typeof platformRow._output[]=[];let offset=0;
    for(let pages=0;pages<20000;pages++) {
      const page=await fetchPage(offset,50);
      matches.push(...page.rows.filter(row=>enabled.has(row.organization_id??row.id)).map(annotate));
      if(matches.length>q.offset+q.limit||page.nextOffset===null)return {rows:matches.slice(q.offset,q.offset+q.limit),nextOffset:matches.length>q.offset+q.limit?q.offset+q.limit:null};
      if(page.nextOffset<=offset)throw Error('Organization pagination did not advance');
      offset=page.nextOffset;
    }
    throw Object.assign(Error('Organization filter exceeded its scan limit'),{statusCode:503});
  });
  const params = (value: unknown) =>
    z.object({ kind: platformRecordKind, id: z.uuid() }).parse(value);
  app.get("/v1/platform/records/:kind/:id", async (req) => {
    const token = await options.authorize(req),
      p = params(req.params);
    return platformRecord.parse(
      await options.request(token, `/platform/records/${p.kind}/${p.id}`),
    );
  });
  app.patch("/v1/platform/records/:kind/:id", async (req) => {
    const token = await options.authorize(req),
      p = params(req.params),
      body = platformEdit.parse(req.body);
    if (p.kind === "directory")
      throw Object.assign(new Error("Industry directory is read-only"), {
        statusCode: 403,
      });
    if ((p.kind === "users") !== (body.kind === "user"))
      throw Object.assign(new Error("Invalid edit"), { statusCode: 400 });
    const record = platformRecord.parse(
      await options.request(
        token,
        `/platform/records/${p.kind}/${p.id}`,
        "PATCH",
        body,
      ),
    );
    if (p.kind === "users") await options.profileChanged?.(p.id, record.name ?? (body.kind === "user" ? body.name : ""));
    if (p.kind === "organizations") await options.organizationChanged?.(record.organization_id ?? p.id, record.name);
    return record;
  });
  app.post("/v1/platform/companies", async (req) => {
    const token = await options.authorize(req),
      body = platformCreate.parse(req.body);
    if (body.company_id && body.company)
      throw Object.assign(
        new Error(
          "Imported company details cannot be changed during organization creation",
        ),
        { statusCode: 400 },
      );
    if (body.mode === "directory")
      throw Object.assign(
        new Error("Directory companies are managed through imports"),
        { statusCode: 403 },
      );
    return platformResult.parse(
      await options.request(token, "/platform/companies", "POST", body),
    );
  });
  app.get("/v1/platform/organizations/:id/invitations", async (req) => {
    const token = await options.authorize(req),
      id = z.uuid().parse((req.params as { id: string }).id);
    return z
      .object({
        invitations: invitationRows,
        local_only: z.boolean().optional(),
      })
      .parse(
        await options.request(
          token,
          `/platform/organizations/${id}/invitations`,
        ),
      );
  });
  app.post("/v1/platform/organizations/:id/invitations", async (req) => {
    const token = await options.authorize(req);
    const id = z.uuid().parse((req.params as { id: string }).id);
    const body = platformInvite.parse(req.body);
    return platformInviteResult.parse(
      await options.request(
        token,
        `/platform/organizations/${id}/invitations`,
        "POST",
        body,
      ),
    );
  });
  app.post("/v1/platform/invitations/:id/link", async (req) => {
    const token = await options.authorize(req),
      id = z.uuid().parse((req.params as { id: string }).id);
    z.object({}).strict().parse(req.body);
    return invitationLink.parse(
      await options.request(
        token,
        `/platform/invitations/${id}/link`,
        "POST",
        {},
      ),
    );
  });
}
