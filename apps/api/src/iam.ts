import { z } from "zod";
import {
  directoryResult,
  organizationContext,
  organizationMemberships,
} from "../../../packages/types/src/index.js";
export class IamFailure extends Error {
  constructor(public status: number) {
    super("IAM authorization unavailable");
  }
}
export function iamOrganizations(
  baseUrl: string,
  fetcher: typeof fetch = fetch,
) {
  const base = new URL(baseUrl);
  if (base.protocol !== "https:") throw Error("HTTPS IAM API required");
  return async (token: string, offset: number, limit: number) => {
    try {
      const url = new URL("/v1/integration/me/organizations", base);
      url.search = new URLSearchParams({
        offset: String(offset),
        limit: String(limit),
      }).toString();
      const response = await fetcher(url, {
        headers: { Authorization: `Bearer ${token}` },
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok)
        throw new IamFailure(
          [401, 403].includes(response.status) ? response.status : 503,
        );
      const rows = organizationMemberships.parse(await response.json());
      if (
        rows.length > limit ||
        new Set(rows.map((row) => row.organization_id)).size !== rows.length
      )
        throw Error("Invalid organization page");
      return rows;
    } catch (error) {
      throw error instanceof IamFailure ? error : new IamFailure(503);
    }
  };
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
  if (base.protocol !== "https:") throw new Error("HTTPS IAM API required");
  return async (token: string) => {
    const response = await fetcher(new URL("/v1/integration/me", base), {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new IamFailure(response.status === 403 ? 403 : 503);
    const value = (await response.json()) as {
      user_id?: unknown;
      display_name?: unknown;
    };
    if (
      typeof value.user_id !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(value.user_id)
    )
      throw new IamFailure(503);
    return {
      user_id: value.user_id,
      display_name:
        typeof value.display_name === "string"
          ? value.display_name.slice(0, 254)
          : null,
    };
  };
}

export function iamDirectory(baseUrl: string, fetcher: typeof fetch = fetch) {
  const base = new URL(baseUrl);
  if (base.protocol !== "https:") throw Error("HTTPS IAM API required");
  return async (
    token: string,
    organizationId: string,
    offset: number,
    limit: number,
    search: string,
  ) => {
    try {
      const url = new URL(
        `/v1/integration/organizations/${encodeURIComponent(organizationId)}/directory`,
        base,
      );
      url.search = new URLSearchParams({
        offset: String(offset),
        limit: String(limit),
        search,
      }).toString();
      const response = await fetcher(url, {
        headers: { Authorization: `Bearer ${token}` },
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok)
        throw new IamFailure(
          [401, 403].includes(response.status) ? response.status : 503,
        );
      const result = directoryResult.parse(await response.json());
      if (
        result.organization_id !== organizationId ||
        result.contacts.length > limit ||
        new Set(result.contacts.map((c) => c.id)).size !==
          result.contacts.length
      )
        throw Error("Invalid directory page");
      return result;
    } catch (error) {
      throw error instanceof IamFailure ? error : new IamFailure(503);
    }
  };
}

export function iamGroupEligibility(
  baseUrl: string,
  fetcher: typeof fetch = fetch,
) {
  const base = new URL(baseUrl);
  if (base.protocol !== "https:") throw Error("HTTPS IAM API required");
  async function request(token: string, path: string, body?: unknown) {
    try {
      const response = await fetcher(new URL(path, base), {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok)
        throw new IamFailure(
          [401, 403].includes(response.status) ? response.status : 503,
        );
      return await response.json();
    } catch (error) {
      throw error instanceof IamFailure ? error : new IamFailure(503);
    }
  }
  return {
    async member(token: string, organization: string, user: string) {
      try {
        const result = z
          .object({
            organization_id: z.uuid(),
            user_id: z.uuid(),
            name: z.string().min(1).max(254),
            membership_key: z.string().min(1).max(100),
          })
          .parse(
            await request(
              token,
              `/v1/integration/organizations/${organization}/group-member/${user}`,
            ),
          );
        if (result.organization_id !== organization || result.user_id !== user)
          throw Error();
        return result;
      } catch (error) {
        throw error instanceof IamFailure ? error : new IamFailure(503);
      }
    },
    async active(token: string, organization: string, ids: string[]) {
      try {
        const result = z
          .array(z.uuid())
          .max(50)
          .parse(
            await request(
              token,
              `/v1/integration/organizations/${organization}/active-organizations`,
              { ids },
            ),
          );
        if (result.some((id) => !ids.includes(id))) throw Error();
        return result;
      } catch (error) {
        throw error instanceof IamFailure ? error : new IamFailure(503);
      }
    },
  };
}
