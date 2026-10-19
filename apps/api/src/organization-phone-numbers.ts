import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { NumberProvisioning } from "./number-provisioning.js";
import { numberConsolePath } from "./number-console-contract.js";
import {
  availableNumber,
  numberSearchResult,
} from "../../../packages/types/src/phone-numbers.js";
import type { AssignmentView } from "../../web/src/number-provisioning/models/number-assignment-model.js";
import {
  numberOrderLabel,
  type NumberOrder,
} from "../../web/src/number-provisioning/models/number-purchase-model.js";
import type { TelephoneInventory } from "../../web/src/number-provisioning/models/telephone-numbers.js";
import type { NumberRouting } from "../../web/src/number-provisioning/models/number-routing.js";
type Destination = {
  id: string;
  label: string;
  customerId: string;
  domain: string;
};
type Assignments = {
  assignments: AssignmentView[];
  destinations: Destination[];
};
const deny = () => {
  throw Object.assign(
    Error("Number action is unavailable for this organization"),
    { statusCode: 403 },
  );
};
const ownAssignment = (a: AssignmentView) => {
  const { returnHistory, ...visible } = a;
  return visible;
};
const notFound = () => {
  throw Object.assign(Error("Number record not found"), { statusCode: 404 });
};
const purchase = z
  .object({
    requestId: z.uuid(),
    organizationId: z.uuid().optional(),
    confirmed: z.literal(true),
    numbers: z.array(availableNumber).min(1).max(50),
  })
  .strict()
  .refine(
    (v) =>
      new Set(v.numbers.map((n) => n.phone_number)).size === v.numbers.length,
  );

/** An org-admin facade, never a pass-through proxy. Each response is scoped here;
 * mutation bodies carry the authorized organization and are revalidated by the
 * provisioning service under its writer lock. No name-based destination matching. */
export function organizationPhoneNumberRoutes(
  app: FastifyInstance,
  options: {
    numbers?: NumberProvisioning | undefined;
    authorize: (req: FastifyRequest, org: string) => Promise<string>;
  },
) {
  const base = "/v1/organizations/:organizationId/phone-numbers/console/*";
  app.route({
    method: ["GET", "POST"],
    url: base,
    bodyLimit: 65536,
    handler: async (req) => {
      const org = z
          .uuid()
          .parse((req.params as { organizationId: string }).organizationId),
        actor = await options.authorize(req, org);
      req.raw.setTimeout?.(75000);
      if (!options.numbers)
        throw Object.assign(Error("Number provisioning is not connected"), {
          statusCode: 503,
        });
      const path = req.raw.url!.split("/phone-numbers/console")[1]!;
      if (!numberConsolePath(req.method, path)) return notFound();
      const url = new URL(path, "http://local.invalid"),
        route = url.pathname,
        query = url.searchParams;
      const call = <T>(
        method: "GET" | "POST",
        target: string,
        body?: unknown,
      ) =>
        options.numbers!.request(
          actor,
          method,
          "/console" + target,
          body,
        ) as Promise<T>;
      const allAssignments = () =>
        call<Assignments>("GET", "/number-purchase/assignments");
      const allOrders = () =>
        call<{ orders: NumberOrder[] }>(
          "GET",
          "/number-purchase/orders?inventory=true",
        );
      const ownOrders = async () =>
        (await allOrders()).orders.filter((o) => o.organizationId === org);
      const ownBody = (value: unknown) => {
        const body = z.record(z.string(), z.unknown()).parse(value ?? {});
        if ("organizationId" in body && body.organizationId !== org) deny();
        return { ...body, organizationId: org };
      };
      const ownQuery = (key: string) => {
        if (query.has(key) && query.get(key) !== org) deny();
      };
      if (req.method === "GET") {
        if (route === "/number-purchase/assignments") {
          const data = await allAssignments();
          return {
            assignments: data.assignments
              .filter((a) => a.organizationId === org)
              .map(ownAssignment),
            destinations: data.destinations.filter((d) => d.id === org),
          };
        }
        if (route === "/number-purchase/context") {
          ownQuery("accountId");
          const [context, data] = await Promise.all([
            call<{
              canPurchase: boolean;
              livePurchasing: boolean;
              scopeKey: string;
              demo?: boolean;
            }>("GET", "/number-purchase/context?accountId=" + org),
            allAssignments(),
          ]);
          const destinations = data.destinations.filter((d) => d.id === org);
          return {
            canPurchase: context.canPurchase && destinations.length === 1,
            livePurchasing: context.livePurchasing,
            demo: context.demo,
            destinations: destinations.map((d) => ({
              id: d.id,
              label: d.label,
            })),
            site: "",
            location: "",
            scopeKey: org + ":" + context.scopeKey,
            provisioningDeferred: false,
          };
        }
        if (route.startsWith("/number-purchase/coverage/")) {
          ownQuery("accountId");
          query.set("accountId", org);
          return call("GET", route + "?" + query);
        }
        if (route === "/number-purchase/orders") {
          const [orders, data] = await Promise.all([
            ownOrders(),
            allAssignments(),
          ]);
          const current = new Map(data.assignments.map((a) => [a.number, a]));
          return {
            orders: orders.map((o) => ({
              ...o,
              numbers: o.numbers.map((n) => {
                const a = current.get(n.phone_number);
                return a &&
                  (a.organizationId !== org || a.status === "unassigned")
                  ? { ...n, organizationId: null, status: "UNASSIGNED" }
                  : n;
              }),
            })),
          };
        }
        if (route === "/number-purchase/releases") return { releases: [] };
        if (route === "/number-purchase/routing") {
          ownQuery("organizationId");
          const [data, result] = await Promise.all([
            allAssignments(),
            call<{ routing: Record<string, NumberRouting> }>(
              "GET",
              route + "?organizationId=" + org,
            ),
          ]);
          const ids = new Set(
            data.assignments
              .filter((a) => a.organizationId === org)
              .map((a) => a.id),
          );
          return {
            routing: Object.fromEntries(
              Object.entries(result.routing).filter(([id]) => ids.has(id)),
            ),
          };
        }
        if (route === "/number-purchase/order-directory") {
          const q = z
            .object({
              limit: z.coerce.number().int().min(1).max(50),
              offset: z.coerce.number().int().min(0).max(1000000),
              sort: z.enum([
                "order",
                "destination",
                "numbers",
                "status",
                "created",
              ]),
              direction: z.enum(["asc", "desc"]),
            })
            .strict()
            .parse(Object.fromEntries(query));
          const rows = (await ownOrders()).map((o) => ({
            id: o.id,
            kind: "purchase",
            reference: o.customerOrderId,
            destination: o.destinationLabel,
            count: o.numbers.length,
            status: numberOrderLabel(o),
            created: o.createdAt,
          }));
          const field = (
            {
              order: "reference",
              destination: "destination",
              numbers: "count",
              status: "status",
              created: "created",
            } as const
          )[q.sort];
          rows.sort(
            (a, b) =>
              (q.direction === "asc" ? 1 : -1) *
              String(a[field]).localeCompare(String(b[field]), undefined, {
                numeric: true,
              }),
          );
          return {
            items: rows.slice(q.offset, q.offset + q.limit),
            total: rows.length,
          };
        }
      }
      if (
        route === "/telephone-numbers" ||
        route === "/telephone-numbers/sync"
      ) {
        if (req.method === "POST") z.object({}).strict().parse(req.body);
        // Organization refresh reads the shared snapshot; it cannot trigger a global carrier write.
        const [data, orders, inventory] = await Promise.all([
          allAssignments(),
          ownOrders(),
          call<{ configured: boolean; snapshot: TelephoneInventory | null }>(
            "GET",
            "/telephone-numbers",
          ),
        ]);
        const current = new Map(data.assignments.map((a) => [a.number, a]));
        const owned = new Set([
          ...data.assignments
            .filter(
              (a) => a.organizationId === org && a.status !== "unassigned",
            )
            .map((a) => a.number),
          ...orders.flatMap((o) =>
            o.numbers
              .filter((n) => {
                const a = current.get(n.phone_number);
                return a
                  ? a.organizationId === org && a.status !== "unassigned"
                  : n.status !== "UNASSIGNED" &&
                      n.status !== "BANDWIDTH_FAILED";
              })
              .map((n) => n.phone_number),
          ),
        ]);
        return {
          configured: inventory.configured,
          snapshot: inventory.snapshot
            ? {
                ...inventory.snapshot,
                numbers: inventory.snapshot.numbers.filter((n) =>
                  owned.has(n.number),
                ),
              }
            : null,
        };
      }
      const orderMatch =
        /^\/number-purchase\/orders\/([a-zA-Z0-9_-]+)(\/resume)?$/.exec(route);
      if (orderMatch) {
        const order = await call<NumberOrder>(
          "GET",
          "/number-purchase/orders/" + orderMatch[1],
        );
        if (order.organizationId !== org) return notFound();
        if (req.method === "GET" && !orderMatch[2]) return order;
        if (req.method === "POST" && orderMatch[2]) {
          z.object({})
            .strict()
            .parse(req.body ?? {});
          await call("POST", route, {});
          return { queued: true };
        }
        return notFound();
      }
      if (req.method === "POST") {
        if (route === "/number-purchase/search") {
          const body = z.record(z.string(), z.unknown()).parse(req.body);
          if ("accountId" in body && body.accountId !== org) deny();
          return numberSearchResult.parse(
            await call("POST", route, { ...body, accountId: org }),
          );
        }
        if (route === "/number-purchase/orders") {
          const input = purchase.parse(ownBody(req.body));
          if (!(await allAssignments()).destinations.some((d) => d.id === org))
            deny();
          const order = await call<NumberOrder>("POST", route, input);
          if (order.organizationId !== org) return notFound();
          return order;
        }
        if (route === "/number-purchase/assignments") {
          const body = z
            .object({
              number: z.string().regex(/^\+1[2-9]\d{9}$/),
              organizationId: z.uuid(),
              confirmed: z.literal(true),
            })
            .strict()
            .parse(ownBody(req.body));
          const own = (await allAssignments()).assignments.find(
            (a) =>
              a.number === body.number &&
              a.organizationId === org &&
              a.status !== "unassigned",
          );
          if (!own) deny();
          return ownAssignment(
            await call<AssignmentView>("POST", route, {
              ...body,
              existingAssignmentId: own!.id,
            }),
          );
        }
        if (route === "/number-purchase/assignments/unassign") {
          const body = z
            .object({
              organizationId: z.uuid(),
              assignmentIds: z
                .array(z.string().min(1).max(100))
                .min(1)
                .max(500),
              confirmed: z.literal(true),
            })
            .strict()
            .parse(ownBody(req.body));
          const rows = (await allAssignments()).assignments;
          if (
            new Set(body.assignmentIds).size !== body.assignmentIds.length ||
            body.assignmentIds.some(
              (id) =>
                !rows.some((a) => a.id === id && a.organizationId === org),
            )
          )
            deny();
          const result = await call<{ assignments: AssignmentView[] }>(
            "POST",
            route,
            body,
          );
          return { assignments: result.assignments.map(ownAssignment) };
        }
      }
      return deny();
    },
  });
}
