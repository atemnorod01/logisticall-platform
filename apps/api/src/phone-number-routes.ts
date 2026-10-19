import {numberConsolePath} from './number-console-contract.js';
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  numberContext,
  numberCoverage,
  numberOrder,
  numberOrders,
  numberPage,
  numberPurchase,
  numberSearch,
  numberSearchResult,
} from "../../../packages/types/src/phone-numbers.js";
import type { NumberProvisioning } from "./number-provisioning.js";

export function phoneNumberRoutes(
  app: FastifyInstance,
  options: {
    numbers?: NumberProvisioning | undefined;
    authorize: (req: FastifyRequest) => Promise<string>;
  },
) {
  const call = async (
    token: string,
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ) => {
    if (!options.numbers)
      throw Object.assign(Error("Number provisioning is not connected"), {
        statusCode: 503,
      });
    const actor = z.uuid().parse(token);
    return options.numbers.request(actor, method, path, body);
  };
  const base = "/v1/platform/phone-numbers";
  app.route({method:['GET','POST'],url:base+'/console/*',bodyLimit:65536,handler:async req=>{
    const actor=await options.authorize(req);
    req.raw.setTimeout?.(75000);
    const path=req.raw.url!.slice((base+'/console').length);
    if(!numberConsolePath(req.method,path))throw Object.assign(Error('Unsupported number action'),{statusCode:404});
    return call(actor,req.method as 'GET'|'POST','/console'+path,req.method==='GET'?undefined:req.body??{});
  }});
  app.get(base + "/context", async (req) => {
    const token = await options.authorize(req);
    z.object({}).strict().parse(req.query);
    return options.numbers
      ? numberContext.parse(await call(token, "GET", "/context"))
      : { configured: false, purchasingEnabled: false, demo: false };
  });
  app.get(base + "/coverage/:kind", async (req) => {
    const token = await options.authorize(req);
    const kind = z
      .enum(["countries", "regions", "localities", "areacodes"])
      .parse((req.params as { kind: string }).kind);
    const query = z
      .object({
        country: z.enum(["USA", "CAN"]).default("USA"),
        region: z.string().max(100).default(""),
      })
      .strict()
      .parse(req.query);
    return numberCoverage.parse(
      await call(
        token,
        "GET",
        `/coverage/${kind}?${new URLSearchParams(query)}`,
      ),
    );
  });
  app.post(base + "/search", async (req) => {
    const token = await options.authorize(req);
    return numberSearchResult.parse(
      await call(token, "POST", "/search", numberSearch.parse(req.body)),
    );
  });
  app.get(base + "/orders", async (req) => {
    const token = await options.authorize(req);
    const q = numberPage.parse(req.query);
    return numberOrders.parse(
      await call(token, "GET", `/orders?limit=${q.limit}&offset=${q.offset}`),
    );
  });
  app.get(base + "/orders/by-request/:id", async (req) => {
    const token = await options.authorize(req);
    const id = z.uuid().parse((req.params as { id: string }).id);
    return numberOrder.parse(
      await call(token, "GET", `/orders/by-request/${id}`),
    );
  });
  app.get(base + "/orders/:id", async (req) => {
    const token = await options.authorize(req);
    const id = z.uuid().parse((req.params as { id: string }).id);
    return numberOrder.parse(await call(token, "GET", `/orders/${id}`));
  });
  app.post(base + "/orders", { bodyLimit: 65536 }, async (req, reply) => {
    const token = await options.authorize(req);
    const result = numberOrder.parse(
      await call(token, "POST", "/orders", numberPurchase.parse(req.body)),
    );
    return reply.code(202).send(result);
  });
}
