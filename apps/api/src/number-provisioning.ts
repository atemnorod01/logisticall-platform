import {numberConsolePath} from './number-console-contract.js';
import { createHash, randomUUID } from "node:crypto";
import { importPKCS8, SignJWT } from "jose";

export interface NumberProvisioning {
  request(
    actor: string,
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<unknown>;
}
/** The browser never receives this signing key or a provider credential. Native fetch
 * reuses its connection pool. Only identical in-flight reads/searches are shared:
 * available numbers are deliberately not cached after a response completes. */
export function numberProvisioning(options: {
  origin: string;
  privateKey: string;
  issuer: string;
  audience: string;
  allowLoopback?: boolean;
  fetcher?: typeof fetch;
}): NumberProvisioning {
  const origin = new URL(options.origin);
  if (
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== "/" ||
    (origin.protocol !== "https:" &&
      !(
        options.allowLoopback &&
        origin.protocol === "http:" &&
        origin.hostname === "127.0.0.1"
      ))
  )
    throw Error("Number provisioning requires a fixed HTTPS origin.");
  const key = importPKCS8(options.privateKey, "ES256");
  const pending = new Map<string, Promise<unknown>>();
  const fetcher = options.fetcher ?? fetch;
  return {
    async request(actor, method, path, body) {
      const consolePath=path.startsWith('/console/')?path.slice('/console'.length):null;
      if (consolePath ? !numberConsolePath(method,consolePath) :
        !/^\/(context|coverage\/(countries|regions|localities|areacodes)(\?[^#]*)?|search|orders(?:\?[^#]*|\/[0-9a-f-]{36}|\/by-request\/[0-9a-f-]{36})?)$/.test(
          path,
        )
      )
        throw Error("Unsupported number provisioning endpoint");
      const url = consolePath ? "/api/platform/v1/number-console"+consolePath : "/api/platform/v1/numbers" + path,
        encoded = body === undefined ? "" : JSON.stringify(body);
      const share = method === "GET" || path === "/search" || consolePath === "/number-purchase/search",
        cacheKey = JSON.stringify([actor, method, path, encoded]);
      const previous = share ? pending.get(cacheKey) : undefined;
      if (previous) return previous;
      const run = async () => {
        const token = await new SignJWT({
          scope:
            consolePath && method === "POST" && !consolePath.startsWith("/number-purchase/search") ? "numbers:write" : method === "POST" && path === "/orders"
              ? "numbers:purchase"
              : "numbers:read",
          method,
          path: url,
          bodyHash: createHash("sha256").update(encoded).digest("hex"),
        })
          .setProtectedHeader({ alg: "ES256", typ: "JWT" })
          .setIssuer(options.issuer)
          .setAudience(options.audience)
          .setSubject(actor)
          .setIssuedAt()
          .setExpirationTime("60s")
          .setJti(randomUUID())
          .sign(await key);
        let response: Response;
        try {
          response = await fetcher(new URL(url, origin), {
            method,
            headers: {
              Authorization: "Bearer " + token,
              ...(encoded ? { "Content-Type": "application/json" } : {}),
            },
            ...(encoded ? { body: encoded } : {}),
            redirect: "error",
            signal: AbortSignal.timeout(
              method === "POST" && (path === "/orders" || !!consolePath) ? 65000 : 45000,
            ),
          });
        } catch {
          throw Object.assign(Error("Provisioning connection unavailable"), {
            statusCode: 503,
          });
        }
        if (!response.ok) {
          const status = [400, 404, 409, 429].includes(response.status)
            ? response.status
            : 503;
          throw Object.assign(Error("Provisioning request failed"), {
            statusCode: status,
          });
        }
        return response.json();
      };
      const work = run().finally(() => {
        if (pending.get(cacheKey) === work) pending.delete(cacheKey);
      });
      if (share) pending.set(cacheKey, work);
      return work;
    },
  };
}
