import Fastify from "fastify";
import { SessionError, type browserSessions } from "./auth/browser.js";
import { z } from "zod";
import { tokenVerifier } from "../../../packages/auth/src/index.js";
import { permissionsFor } from "../../../packages/permissions/src/index.js";
import { iamGateway, IamFailure } from "./iam.js";
export function buildApp(
  config: { issuer: string; clientId: string; iamApi: string },
  deps: {
    verify?: ReturnType<typeof tokenVerifier>;
    context?: ReturnType<typeof iamGateway>;
    browser?: ReturnType<typeof browserSessions>;
  } = {},
) {
  const app = Fastify({
    bodyLimit: 16384,
    requestTimeout: 10000,
    logger: false,
  });
  const verify = deps.verify ?? tokenVerifier(config.issuer, config.clientId);
  const context = deps.context ?? iamGateway(config.iamApi);
  deps.browser?.register(app);
  app.get("/health/live", async () => ({ status: "ok" }));
  // Protocol-verification slice: bearer only; browser login/BFF sessions are a later increment.
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
        try { token = await deps.browser.accessToken(req); } catch (error) {
          return reply.code(error instanceof SessionError ? error.statusCode : 503).send({ message: "Session unavailable" });
        }
      } else token = /^Bearer ([^\s]+)$/i.exec(
        req.headers.authorization ?? "",
      )?.[1];
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
  return app;
}
