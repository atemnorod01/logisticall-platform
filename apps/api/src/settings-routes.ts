import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
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
    return z
      .object({ user_id: z.uuid(), display_name: z.string().max(100) })
      .parse(
        await options.request(
          token,
          "/me",
          "PATCH",
          profileEdit.parse(req.body),
        ),
      );
  });
  const prefix = "/v1/organizations/:organizationId";
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
    return z
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
