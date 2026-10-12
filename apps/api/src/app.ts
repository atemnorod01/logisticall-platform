import { platformAdminRoutes } from "./platform-admin-routes.js";
import { iamIdentity } from "./iam.js";
import { callsRoutes } from "./calls-routes.js";
import type { CallsStore } from "./calls-store.js";
import { messagingRoutes } from "./messaging-routes.js";
import { iamMessaging } from "./iam.js";
import type { MessagingStore } from "./messaging-store.js";
import { settingsRoutes } from "./settings-routes.js";
import { iamSettings } from "./iam.js";
import Fastify from "fastify";
import { groupRoutes } from "./groups-routes.js";
import { GroupFailure, type GroupStore } from "./groups-store.js";
import { iamGroupEligibility } from "./iam.js";
import type { PresenceStore } from "./presence.js";
import { readCookie } from "./auth/browser.js";
import { digest } from "./auth/crypto.js";
import { SessionError, type browserSessions } from "./auth/browser.js";
import { z } from "zod";
import { tokenVerifier } from "../../../packages/auth/src/index.js";
import { permissionsFor } from "../../../packages/permissions/src/index.js";
import {
  iamIndustry,
  iamGateway,
  iamOrganizations,
  iamDirectory,
  IamFailure,
} from "./iam.js";
export function buildApp(
  config: { issuer: string; clientId: string; iamApi: string },
  deps: {
    profileChanged?: (id: string, name: string) => Promise<void>;
    calls?: CallsStore;
    iceServers?: RTCIceServer[];
    iceServersFor?: (userId: string) => Promise<RTCIceServer[]>;
    settings?: ReturnType<typeof iamSettings>;
    identity?: ReturnType<typeof iamIdentity>;
    verify?: ReturnType<typeof tokenVerifier>;
    context?: ReturnType<typeof iamGateway>;
    organizations?: ReturnType<typeof iamOrganizations>;
    directory?: ReturnType<typeof iamDirectory>;
    industry?: ReturnType<typeof iamIndustry>;
    presence?: PresenceStore;
    groups?: GroupStore;
    messaging?: MessagingStore;
    messagingDirectory?: ReturnType<typeof iamMessaging>;
    groupEligibility?: ReturnType<typeof iamGroupEligibility>;
    browser?: ReturnType<typeof browserSessions>;
  } = {},
) {
  const app = Fastify({
    bodyLimit: 16384,
    requestTimeout: 10000,
    connectionTimeout: 10000,
    logger: false,
  });
  app.addHook("onRequest", async (_request, reply) => {
    reply
      .header("Cache-Control", "no-store")
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "no-referrer")
      .header("X-Frame-Options", "DENY");
  });
  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("Server-Timing", `app;dur=${reply.elapsedTime.toFixed(1)}`);
    if(reply.elapsedTime>1000) console.warn(JSON.stringify({event:"slow_request",route:request.routeOptions.url,method:request.method,status:reply.statusCode,durationMs:Math.round(reply.elapsedTime)}));
    return payload;
  });
  app.setErrorHandler((error, request, reply) => {
    // Database/provider error text may contain connection or account details.
    if (error instanceof z.ZodError)
      return reply.code(400).send({ message: "Invalid request" });
    const status =
      error instanceof IamFailure
        ? error.status
        : typeof (error as { statusCode?: unknown }).statusCode === "number"
          ? (error as { statusCode: number }).statusCode
          : 500;
    const safeStatus = status >= 400 && status < 500 ? status : 503;
    if (safeStatus >= 500) console.warn(JSON.stringify({
      event: "request_failed", route: request.routeOptions.url, method: request.method,
      status: safeStatus, durationMs: Math.round(reply.elapsedTime),
      category: error instanceof IamFailure ? "iam" : "internal",
      // Only PostgreSQL SQLSTATE codes are logged, never messages, SQL or parameters.
      code: typeof (error as {code?:unknown}).code === "string" && /^[0-9A-Z]{5}$/.test((error as {code:string}).code)
        ? (error as {code:string}).code : undefined,
    }));
    return reply.code(safeStatus).send({
      message:
        status >= 400 && status < 500
          ? "Request rejected"
          : "Service temporarily unavailable",
    });
  });
  const verify = deps.verify ?? tokenVerifier(config.issuer, config.clientId);
  const context = deps.context ?? iamGateway(config.iamApi);
  const organizations = deps.organizations ?? iamOrganizations(config.iamApi);
  deps.browser?.register(app);
  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/v1/me/organizations", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    if (req.headers["x-iam-impersonation"] !== undefined)
      return reply.code(403).send({ message: "Access denied" });
    const page = z
      .object({
        offset: z.coerce.number().int().min(0).max(100000).default(0),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .strict()
      .safeParse(req.query);
    if (!page.success)
      return reply.code(400).send({ message: "Invalid pagination" });
    try {
      const token = deps.browser
        ? await deps.browser.accessToken(req)
        : /^Bearer ([^\s]+)$/i.exec(req.headers.authorization ?? "")?.[1];
      if (!token)
        return reply.code(401).send({ message: "Authentication required" });
      try {
        await verify(token);
      } catch {
        return reply.code(401).send({ message: "Invalid access token" });
      }
      const rows = await organizations(
        token,
        page.data.offset,
        page.data.limit,
      );
      return {
        organizations: rows,
        nextOffset:
          rows.length === page.data.limit &&
          page.data.offset + rows.length <= 100000
            ? page.data.offset + rows.length
            : null,
      };
    } catch (error) {
      return reply
        .code(
          error instanceof SessionError
            ? error.statusCode
            : error instanceof IamFailure
              ? error.status
              : 503,
        )
        .send({ message: "Organizations unavailable" });
    }
  });
  app.get<{ Params: { organizationId: string } }>(
    "/v1/organizations/:organizationId/context",
    async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      if (req.headers["x-iam-impersonation"] !== undefined)
        return reply.code(403).send({ message: "Access denied" });
      const org = z.uuid().safeParse(req.params.organizationId);
      if (!org.success)
        return reply.code(400).send({ message: "Invalid organization" });
      let token: string | undefined;
      if (deps.browser) {
        try {
          token = await deps.browser.accessToken(req);
        } catch (error) {
          return reply
            .code(error instanceof SessionError ? error.statusCode : 503)
            .send({ message: "Session unavailable" });
        }
      } else
        token = /^Bearer ([^\s]+)$/i.exec(req.headers.authorization ?? "")?.[1];
      if (!token)
        return reply.code(401).send({ message: "Authentication required" });
      let actor: { userId: string };
      try {
        actor = await verify(token);
      } catch {
        return reply.code(401).send({ message: "Invalid access token" });
      }
      try {
        const result = await context(token, org.data);
        if (
          result.user_id !== actor.userId ||
          result.organization_id !== org.data
        )
          return reply.code(403).send({ message: "Access denied" });
        return { organization: result, permissions: permissionsFor(result) };
      } catch (error) {
        return reply
          .code(error instanceof IamFailure ? error.status : 503)
          .send({ message: "Authorization unavailable" });
      }
    },
  );

  const directory = deps.directory ?? iamDirectory(config.iamApi);
  app.get<{ Params: { organizationId: string } }>(
    "/v1/organizations/:organizationId/contacts",
    async (req, reply) => {
      if (req.headers["x-iam-impersonation"] !== undefined)
        return reply.code(403).send({ message: "Access denied" });
      const org = z.uuid().safeParse(req.params.organizationId);
      const page = z
        .object({
          offset: z.coerce.number().int().min(0).max(100000).default(0),
          limit: z.coerce.number().int().min(1).max(100).default(50),
          search: z.string().max(100).default(""),
        })
        .strict()
        .safeParse(req.query);
      if (!org.success || !page.success)
        return reply.code(400).send({ message: "Invalid directory request" });
      try {
        const token = deps.browser
          ? await deps.browser.accessToken(req)
          : /^Bearer ([^\s]+)$/i.exec(req.headers.authorization ?? "")?.[1];
        if (!token)
          return reply.code(401).send({ message: "Authentication required" });
        let actor;
        try {
          actor = await verify(token);
        } catch {
          return reply.code(401).send({ message: "Invalid access token" });
        }
        const membership = await context(token, org.data);
        if (
          membership.user_id !== actor.userId ||
          membership.organization_id !== org.data ||
          !permissionsFor(membership).includes("directory.members.read")
        )
          return reply.code(403).send({ message: "Access denied" });
        const result = await directory(
          token,
          org.data,
          page.data.offset,
          page.data.limit,
          page.data.search,
        );
        let statuses: Awaited<ReturnType<PresenceStore["read"]>> = {};
        try {
          statuses =
            (await deps.presence?.read(
              org.data,
              result.contacts.map((c) => c.id),
            )) ?? {};
        } catch {
          /* Presence failure must never imply availability. */
        }
        return {
          ...result,
          contacts: result.contacts.map((c) => ({
            ...c,
            presence: statuses[c.id] ?? "unknown",
          })),
          nextOffset:
            result.contacts.length === page.data.limit &&
            page.data.offset + result.contacts.length <= 100000
              ? page.data.offset + result.contacts.length
              : null,
        };
      } catch (error) {
        return reply
          .code(
            error instanceof SessionError
              ? error.statusCode
              : error instanceof IamFailure
                ? error.status
                : 503,
          )
          .send({ message: "Contacts unavailable" });
      }
    },
  );

  app.post<{ Params: { organizationId: string } }>(
    "/v1/organizations/:organizationId/presence",
    async (req, reply) => {
      if (!deps.browser || !deps.presence)
        return reply.code(503).send({ message: "Presence unavailable" });
      if (req.headers["x-iam-impersonation"] !== undefined)
        return reply.code(403).send({ message: "Access denied" });
      const org = z.uuid().safeParse(req.params.organizationId);
      const input = z
        .object({
          mode: z.enum(["auto", "available", "away", "busy"]),
          active: z.boolean(),
        })
        .strict()
        .safeParse(req.body);
      const sid = readCookie(req.headers.cookie, "__Host-lc-session");
      if (!org.success || !input.success)
        return reply.code(400).send({ message: "Invalid presence request" });
      if (!sid)
        return reply.code(401).send({ message: "Authentication required" });
      try {
        const token = await deps.browser.accessToken(req);
        const actor = await verify(token);
        const membership = await context(token, org.data);
        if (
          membership.user_id !== actor.userId ||
          membership.organization_id !== org.data
        )
          return reply.code(403).send({ message: "Access denied" });
        const status =
          input.data.mode === "auto"
            ? input.data.active
              ? "available"
              : "away"
            : input.data.mode;
        await deps.presence.beat(digest(sid), actor.userId, org.data, status);
        return { status };
      } catch (error) {
        return reply
          .code(
            error instanceof SessionError
              ? error.statusCode
              : error instanceof IamFailure
                ? error.status
                : 503,
          )
          .send({ message: "Presence unavailable" });
      }
    },
  );
  platformAdminRoutes(app, {
    profileChanged: deps.profileChanged,
    presence: deps.presence,
    request: deps.settings ?? iamSettings(config.iamApi),
    async authorize(req) {
      if (req.headers['x-iam-impersonation'] !== undefined) throw new IamFailure(403);
      const token = deps.browser ? await deps.browser.accessToken(req) : /^Bearer ([^\s]+)$/i.exec(req.headers.authorization ?? '')?.[1];
      if (!token) throw new IamFailure(401);
      let actor;
      try { actor = await verify(token); } catch { throw new IamFailure(401); }
      const identity = await (deps.identity ?? iamIdentity(config.iamApi))(token);
      if (identity.user_id !== actor.userId || !identity.platform_admin) throw new IamFailure(403);
      return token;
    },
  });
  settingsRoutes(app, {
    profileChanged: deps.profileChanged,
    presence: deps.presence
      ? (org, ids) => deps.presence!.read(org, ids)
      : undefined,
    request: deps.settings ?? iamSettings(config.iamApi),
    async authorize(req, org) {
      if (req.headers["x-iam-impersonation"] !== undefined)
        throw new IamFailure(403);
      const token = deps.browser
        ? await deps.browser.accessToken(req)
        : /^Bearer ([^\s]+)$/i.exec(req.headers.authorization ?? "")?.[1];
      if (!token) throw new IamFailure(401);
      let actor;
      try {
        actor = await verify(token);
      } catch {
        throw new IamFailure(401);
      }
      if (org) {
        const c = await context(token, org);
        if (
          c.user_id !== actor.userId ||
          c.organization_id !== org ||
          c.membership_status !== "active" ||
          c.organization_status !== "active" ||
          !["admin", "owner"].includes(c.role_id)
        )
          throw new IamFailure(403);
      }
      return token;
    },
  });
  groupRoutes(app, {
    presence: deps.presence,
    industry: deps.industry ?? iamIndustry(config.iamApi),
    store: deps.groups,
    messaging: Boolean(deps.messaging),
    eligibility: deps.groupEligibility ?? iamGroupEligibility(config.iamApi),
    async authorize(req, organizationId) {
      if (req.headers["x-iam-impersonation"] !== undefined)
        throw new GroupFailure(403);
      const token = deps.browser
        ? await deps.browser.accessToken(req)
        : /^Bearer ([^\s]+)$/i.exec(req.headers.authorization ?? "")?.[1];
      if (!token) throw new GroupFailure(401);
      let actor;
      try {
        actor = await verify(token);
      } catch {
        throw new GroupFailure(401);
      }
      let membership;
      try {
        membership = await context(token, organizationId);
      } catch (error) {
        throw new GroupFailure(
          error instanceof IamFailure ? error.status : 503,
        );
      }
      if (
        membership.user_id !== actor.userId ||
        membership.organization_id !== organizationId
      )
        throw new GroupFailure(403);
      return {
        actor: {
          userId: actor.userId,
          organizationId,
          organizationName: membership.name,
        },
        token,
        manage: permissionsFor(membership).includes("groups.manage"),
      };
    },
  });
  callsRoutes(app, {
    async prepareConversation(token, actor, caller, callee) {
      if (!deps.messaging) throw new IamFailure(503);
      const member = await (deps.groupEligibility ?? iamGroupEligibility(config.iamApi)).member(token,actor.organizationId,actor.userId);
      const sender = {...caller,membershipKey:member.membership_key};
      const conversation = await deps.messaging.create({...actor,name:member.name,membershipKey:member.membership_key},sender,callee);
      return conversation.id;
    },
    async resolveTarget(token, actor, target, source) {
      if (!deps.messaging || !deps.groups) throw new IamFailure(503);
      const member = await (deps.groupEligibility ?? iamGroupEligibility(config.iamApi)).member(token, actor.organizationId, actor.userId);
      const messageActor = {...actor, name:member.name, membershipKey:member.membership_key};
      const group = source.groupId ? await deps.groups.inbox({...actor,organizationName:""},source.groupId,member.membership_key) : null;
      const inbox = group ? {kind:"group" as const,id:group.id,organizationId:group.organization_id,name:group.name,organizationName:""} : {kind:"user" as const,id:actor.userId,organizationId:actor.organizationId,name:member.name,organizationName:"",membershipKey:member.membership_key};
      return deps.messaging.directTarget(messageActor,inbox,source.conversationId,target.organizationId,target.id);
    },
    async resolveTeam(token, actor, target, source) {
      if (!deps.messaging || !deps.groups) throw new IamFailure(503);
      const member = await (deps.groupEligibility ?? iamGroupEligibility(config.iamApi)).member(token,actor.organizationId,actor.userId);
      const group = source.groupId ? await deps.groups.inbox({...actor,organizationName:""},source.groupId,member.membership_key) : null;
      const inbox = group ? {kind:"group" as const,id:group.id,organizationId:group.organization_id,name:group.name,organizationName:""} : {kind:"user" as const,id:actor.userId,organizationId:actor.organizationId,name:member.name,organizationName:"",membershipKey:member.membership_key};
      const detail = await deps.messaging.participants({...actor,name:member.name,membershipKey:member.membership_key},inbox,source.conversationId);
      const team = detail.participants.find(p=>p.kind==="group" && p.id===target.id && p.organizationId===target.organizationId);
      if (!team || detail.readOnly) throw new IamFailure(403);
      return {team, members:team.members.map((m:{id:string;name:string})=>({kind:"user" as const,id:m.id,name:m.name,organizationId:team.organizationId,organizationName:team.organizationName}))};
    },
    async canReceiveTeam(token, actor, team) {
      if (!deps.groups || team.organizationId !== actor.organizationId) return false;
      try {
        const member = await (deps.groupEligibility ?? iamGroupEligibility(config.iamApi)).member(token,actor.organizationId,actor.userId);
        await deps.groups.inbox({...actor,organizationName:""},team.id,member.membership_key);
        return true;
      } catch { return false; }
    },
    store: deps.calls,
    presence: deps.presence,
    iceServers: deps.iceServers,
    ...(deps.iceServersFor ? {iceServersFor: deps.iceServersFor} : {}),
    directory: deps.messagingDirectory ?? iamMessaging(config.iamApi),
    async authorize(req, organizationId) {
      if (req.headers["x-iam-impersonation"] !== undefined)
        throw new IamFailure(403);
      const token = deps.browser
        ? await deps.browser.accessToken(req)
        : /^Bearer ([^\s]+)$/i.exec(req.headers.authorization ?? "")?.[1];
      if (!token) throw new IamFailure(401);
      let actor;
      try {
        actor = await verify(token);
      } catch {
        throw new IamFailure(401);
      }
      const c = await context(token, organizationId);
      if (
        c.user_id !== actor.userId ||
        c.organization_id !== organizationId ||
        c.membership_status !== "active" ||
        c.organization_status !== "active"
      )
        throw new IamFailure(403);
      return {
        actor: {
          userId: actor.userId,
          organizationId,
          organizationName: c.name,
        },
        token,
      };
    },
  });
  const messagingEligibility = deps.groupEligibility ?? iamGroupEligibility(config.iamApi);
  messagingRoutes(app, {
    store: deps.messaging,
    groups: deps.groups,
    eligibility: messagingEligibility,
    directory: deps.messagingDirectory ?? iamMessaging(config.iamApi),
    async authorize(req, organizationId) {
      if (req.headers["x-iam-impersonation"] !== undefined)
        throw new IamFailure(403);
      const token = deps.browser
        ? await deps.browser.accessToken(req)
        : /^Bearer ([^\s]+)$/i.exec(req.headers.authorization ?? "")?.[1];
      if (!token) throw new IamFailure(401);
      let actor;
      try {
        actor = await verify(token);
      } catch {
        throw new IamFailure(401);
      }
      const [c, member] = await Promise.all([
        context(token, organizationId),
        messagingEligibility.member(token, organizationId, actor.userId),
      ]);
      if (
        member.user_id !== actor.userId ||
        member.organization_id !== organizationId ||
        c.user_id !== actor.userId ||
        c.organization_id !== organizationId ||
        c.membership_status !== "active" ||
        c.organization_status !== "active"
      )
        throw new IamFailure(403);
      return {
        actor: {
          userId: actor.userId,
          organizationId,
          organizationName: c.name,
        },
        token,
        member,
      };
    },
  });
  return app;
}
