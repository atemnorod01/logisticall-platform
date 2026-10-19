import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  membershipRemoval,
  managedMember,
  passwordResetLink,
  memberEdit,
  profileEdit,
  organizationEdit,
  organizationProfile,
  inviteEdit,
  invitationRows,
  invitationLink,
} from "../../../packages/types/src/settings.js";
export function settingsRoutes(
  app: FastifyInstance,
  options: {
    memberExtensions?: ((id:string,emails:string[])=>Promise<Record<string,string[]>>) | undefined;
    profileChanged?: ((id: string, name: string) => Promise<void>) | undefined;
    organizationChanged?: ((id: string, name: string) => Promise<void>) | undefined;
    presence?:
      | ((org: string, ids: string[]) => Promise<Record<string, string>>)
      | undefined;
    authorize: (req: FastifyRequest, org?: string) => Promise<string>;
    request: (
      token: string,
      path: string,
      method?: string,
      body?: unknown,
    ) => Promise<unknown>;
  },
) {
  const params = (req: FastifyRequest) =>
    z
      .object({ organizationId: z.uuid(), invitationId: z.uuid().optional() })
      .parse(req.params);
  app.patch("/v1/me/profile", async (req) => {
    const token = await options.authorize(req);
    const profile = z
      .object({ user_id: z.uuid(), display_name: z.string().max(100) })
      .parse(
        await options.request(
          token,
          "/me",
          "PATCH",
          profileEdit.parse(req.body),
        ),
      );
    await options.profileChanged?.(profile.user_id, profile.display_name);
    return profile;
  });
  const prefix = "/v1/organizations/:organizationId";
  app.get(prefix + "/members", async (req) => {
    const p = params(req),
      token = await options.authorize(req, p.organizationId);
    const q = z
      .object({
        offset: z.coerce.number().int().min(0).max(100000).default(0),
        search: z.string().max(100).default(""),
      })
      .strict()
      .parse(req.query);
    const members = z
      .array(managedMember)
      .max(50)
      .parse(
        await options.request(
          token,
          `/organizations/${p.organizationId}/members?offset=${q.offset}&search=${encodeURIComponent(q.search)}`,
        ),
      );
    let statuses: Record<string, string> = {};
    let extensions: Record<string,string[]> = {};
    try { extensions=await options.memberExtensions?.(p.organizationId,members.slice(0,10).map(m=>m.email))??{}; }
    catch { /* Keep member and invitation management available during a PBX outage. */ }
    try {
      statuses =
        (await options.presence?.(
          p.organizationId,
          members.filter((m) => m.status === "active").map((m) => m.user_id),
        )) ?? {};
    } catch {
      /* Keep identity management available when presence fails. */
    }
    return {
      members: members.slice(0, 10).map((m) => ({
        ...m,
        ...(extensions[m.email]?.length?{extensions:extensions[m.email]}:{}),
        presence:
          m.status === "active"
            ? (statuses[m.user_id] ?? "unknown")
            : "offline",
      })),
      nextOffset:
        members.length > 10 && q.offset + 10 <= 100000 ? q.offset + 10 : null,
    };
  });
  for (const method of ["GET", "PATCH"] as const)
    app.route({
      method,
      url: prefix + "/members/:userId",
      handler: async (req) => {
        const p = z
            .object({ organizationId: z.uuid(), userId: z.uuid() })
            .parse(req.params),
          token = await options.authorize(req, p.organizationId);
        return managedMember.parse(
          await options.request(
            token,
            `/organizations/${p.organizationId}/members/${p.userId}`,
            method,
            method === "PATCH" ? memberEdit.parse(req.body) : undefined,
          ),
        );
      },
    });
  app.get(prefix + '/members/:userId/removal', async req=>{
    const p=z.object({organizationId:z.uuid(),userId:z.uuid()}).parse(req.params);
    const token=await options.authorize(req,p.organizationId);
    return membershipRemoval.parse(await options.request(token,`/organizations/${p.organizationId}/members/${p.userId}/removal`));
  });
  app.delete(prefix + '/members/:userId', async req=>{
    const p=z.object({organizationId:z.uuid(),userId:z.uuid()}).parse(req.params);
    const body=z.object({membership_key:z.string().min(1).max(100)}).strict().parse(req.body);
    const token=await options.authorize(req,p.organizationId);
    return z.object({removed:z.literal(true)}).parse(await options.request(token,`/organizations/${p.organizationId}/members/${p.userId}`,'DELETE',body));
  });
  app.post(prefix + "/members/:userId/password-reset-link", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const p = z.object({ organizationId: z.uuid(), userId: z.uuid() }).parse(req.params);
    z.object({}).strict().parse(req.body);
    const token = await options.authorize(req, p.organizationId);
    return passwordResetLink.parse(await options.request(token,
      `/organizations/${p.organizationId}/members/${p.userId}/password-reset-link`, "POST", {}));
  });
  app.get(prefix + "/profile", async (req) => {
    const p = params(req),
      token = await options.authorize(req, p.organizationId);
    return organizationProfile.parse(
      await options.request(
        token,
        `/organizations/${p.organizationId}/profile`,
      ),
    );
  });
  app.patch(prefix + "/profile", async (req) => {
    const p = params(req),
      token = await options.authorize(req, p.organizationId);
    const profile = z
      .object({
        organization_id: z.uuid(),
        name: z.string().max(120),
        organization_type:
          organizationProfile.shape.organization_type.optional(),
        description: organizationProfile.shape.description.optional(),
      })
      .parse(
        await options.request(
          token,
          `/organizations/${p.organizationId}`,
          "PATCH",
          organizationEdit.parse(req.body),
        ),
      );
    await options.organizationChanged?.(p.organizationId, profile.name);
    return profile;
  });
  app.get(prefix + "/invitations", async (req) => {
    const p = params(req),
      page = z
        .object({
          offset: z.coerce.number().int().min(0).max(100000).default(0),
        })
        .strict()
        .parse(req.query),
      token = await options.authorize(req, p.organizationId);
    const invitations = invitationRows.parse(
      await options.request(
        token,
        `/organizations/${p.organizationId}/invitations?offset=${page.offset}`,
      ),
    );
    return {
      invitations,
      nextOffset:
        invitations.length === 50 && page.offset + 50 <= 100000
          ? page.offset + 50
          : null,
    };
  });
  app.post(prefix + "/invitations", async (req) => {
    const p = params(req),
      token = await options.authorize(req, p.organizationId);
    return z
      .object({ id: z.uuid() })
      .parse(
        await options.request(
          token,
          `/organizations/${p.organizationId}/invitations`,
          "POST",
          inviteEdit.parse(req.body),
        ),
      );
  });
  for (const action of ["link", "revoke"] as const)
    app.post(prefix + "/invitations/:invitationId/" + action, async (req) => {
      const p = params(req),
        token = await options.authorize(req, p.organizationId);
      z.object({}).strict().parse(req.body);
      const value = await options.request(
        token,
        `/organizations/${p.organizationId}/invitations/${p.invitationId}/${action}`,
        "POST",
        {},
      );
      return action === "link"
        ? invitationLink.parse(value)
        : z.object({ revoked: z.literal(true) }).parse(value);
    });
}
