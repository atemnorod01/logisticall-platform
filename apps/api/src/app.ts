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
  iamGateway,
  iamOrganizations,
  iamDirectory,
  IamFailure,
} from "./iam.js";
export function buildApp(
  config: { issuer: string; clientId: string; iamApi: string },
  deps: {
    settings?: ReturnType<typeof iamSettings>;
    verify?: ReturnType<typeof tokenVerifier>;
    context?: ReturnType<typeof iamGateway>;
    organizations?: ReturnType<typeof iamOrganizations>;
    directory?: ReturnType<typeof iamDirectory>;
    presence?: PresenceStore;
    groups?: GroupStore;
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
  app.setErrorHandler((error, _request, reply) => {
    // Database/provider error text may contain connection or account details.
    if (error instanceof z.ZodError)
      return reply.code(400).send({ message: "Invalid request" });
    const status =
      error instanceof IamFailure
        ? error.status
        : typeof (error as { statusCode?: unknown }).statusCode === "number"
          ? (error as { statusCode: number }).statusCode
          : 500;
    return reply.code(status >= 400 && status < 500 ? status : 503).send({
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
  settingsRoutes(app, {
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
    store: deps.groups,
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
  return app;
}
