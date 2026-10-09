import { organizationContext } from "../../../packages/types/src/index.js";
export class IamFailure extends Error {
  constructor(public status: number) {
    super("IAM authorization unavailable");
  }
}
export function iamGateway(baseUrl: string, fetcher: typeof fetch = fetch) {
  const base = new URL(baseUrl);
  if (base.protocol !== "https:") throw new Error("HTTPS IAM API required");
  return async (token: string, organizationId: string) => {
    let response: Response;
    try {
      response = await fetcher(
        new URL(
          `/v1/integration/organizations/${encodeURIComponent(organizationId)}/context`,
          base,
        ),
        {
          headers: { Authorization: `Bearer ${token}` },
          redirect: "error",
          signal: AbortSignal.timeout(5000),
        },
      );
    } catch {
      throw new IamFailure(503);
    }
    if (!response.ok)
      throw new IamFailure(
        response.status === 401 ? 401 : response.status === 403 ? 403 : 503,
      );
    try {
      return organizationContext.parse(await response.json());
    } catch {
      throw new IamFailure(503);
    }
  };
}

export function iamIdentity(baseUrl: string, fetcher: typeof fetch = fetch) {
  const base = new URL(baseUrl);
  if (base.protocol !== 'https:') throw new Error('HTTPS IAM API required');
  return async (token: string) => {
    const response = await fetcher(new URL('/v1/integration/me', base), {
      headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new IamFailure(response.status === 403 ? 403 : 503);
    const value = await response.json() as { user_id?: unknown };
    if (typeof value.user_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(value.user_id)) throw new IamFailure(503);
    return { user_id: value.user_id };
  };
}
