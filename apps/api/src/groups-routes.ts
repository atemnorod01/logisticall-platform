import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  groupCreate,
  groupUpdate,
} from "../../../packages/types/src/groups.js";
import {
  type GroupStore,
  type GroupActor,
  GroupFailure,
} from "./groups-store.js";
import type { iamGroupEligibility } from "./iam.js";
export function groupRoutes(
  app: FastifyInstance,
  options: {
    store: GroupStore | undefined;
    authorize: (
      req: FastifyRequest,
      organization: string,
    ) => Promise<{ actor: GroupActor; token: string; manage: boolean }>;
    eligibility: ReturnType<typeof iamGroupEligibility>;
  },
) {
  const prefix = "/v1/organizations/:organizationId";
  async function auth(req: FastifyRequest, manage = false) {
    const { organizationId } = z
      .object({ organizationId: z.uuid() })
      .parse(req.params);
    const value = await options.authorize(req, organizationId);
    if (manage && !value.manage) throw new GroupFailure(403);
    if (!options.store) throw new GroupFailure(503);
    return { ...value, store: options.store };
  }
  const id = (req: FastifyRequest) =>
    z.object({ groupId: z.uuid() }).parse(req.params).groupId;
  const page = (query: unknown) =>
    z
      .object({ offset: z.coerce.number().int().min(0).max(100000).default(0) })
      .strict()
      .parse(query);
  const next = (offset: number, count: number) =>
    count === 50 && offset + count <= 100000 ? offset + count : null;
  app.get(prefix + "/groups", async (req) => {
    const a = await auth(req, true),
      p = page(req.query);
    const groups = await a.store.list(a.actor, p.offset);
    return { groups, nextOffset: next(p.offset, groups.length) };
  });
  app.post(prefix + "/groups", async (req, reply) => {
    const a = await auth(req, true);
    const group = await a.store.create(a.actor, groupCreate.parse(req.body));
    return reply.code(201).send({ group });
  });
  app.get(prefix + "/groups/:groupId", async (req) => {
    const a = await auth(req, true);
    return a.store.detail(a.actor, id(req));
  });
  app.patch(prefix + "/groups/:groupId", async (req) => {
    const a = await auth(req, true);
    return {
      group: await a.store.update(
        a.actor,
        id(req),
        groupUpdate.parse(req.body),
      ),
    };
  });
  app.post(prefix + "/groups/:groupId/members", async (req) => {
    const a = await auth(req, true),
      input = z
        .object({ user_id: z.uuid(), version: z.number().int().positive() })
        .strict()
        .parse(req.body);
    const target = await options.eligibility.member(
      a.token,
      a.actor.organizationId,
      input.user_id,
    );
    return {
      group: await a.store.member(
        a.actor,
        id(req),
        input.version,
        target,
        false,
      ),
    };
  });
  app.delete(prefix + "/groups/:groupId/members/:userId", async (req) => {
    const a = await auth(req, true),
      input = z
        .object({ version: z.number().int().positive() })
        .strict()
        .parse(req.body);
    const user = z.object({ userId: z.uuid() }).parse(req.params).userId;
    // Removal remains possible after the target leaves IAM; actor must still be admin.
    return {
      group: await a.store.member(
        a.actor,
        id(req),
        input.version,
        { user_id: user },
        true,
      ),
    };
  });
  app.get(prefix + "/group-inboxes", async (req) => {
    const a = await auth(req),
      p = page(req.query);
    const membership = await options.eligibility.member(
      a.token,
      a.actor.organizationId,
      a.actor.userId,
    );
    const groups = await a.store.list(
      a.actor,
      p.offset,
      membership.membership_key,
    );
    return { groups, nextOffset: next(p.offset, groups.length) };
  });
  app.get(prefix + "/group-inboxes/:groupId", async (req) => {
    const a = await auth(req);
    const membership = await options.eligibility.member(
      a.token,
      a.actor.organizationId,
      a.actor.userId,
    );
    return {
      group: await a.store.inbox(a.actor, id(req), membership.membership_key),
      channels: { messaging: false, calling: false },
    };
  });
  app.get(prefix + "/network-groups", async (req) => {
    const a = await auth(req),
      p = z
        .object({
          offset: z.coerce.number().int().min(0).max(100000).default(0),
          search: z.string().max(100).default(""),
        })
        .strict()
        .parse(req.query);
    const rows = await a.store.network(a.actor, p.offset, p.search);
    const active = await options.eligibility.active(
      a.token,
      a.actor.organizationId,
      [...new Set(rows.map((g) => g.organization_id))],
    );
    return {
      groups: rows.filter((g) => active.includes(g.organization_id)),
      nextOffset: next(p.offset, rows.length),
    };
  });
}
