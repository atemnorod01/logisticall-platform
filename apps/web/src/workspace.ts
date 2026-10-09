import {
  organizationContext,
  organizationMemberships,
  type OrganizationContext,
  type OrganizationMembership,
} from "../../../packages/types/src/index.js";
import { z } from "zod";
const sessionSchema = z.object({ userId: z.uuid(), csrfToken: z.string() });
const pageSchema = z.object({
  organizations: organizationMemberships,
  nextOffset: z.number().int().nonnegative().nullable(),
});
const contextSchema = z.object({
  organization: organizationContext,
  permissions: z.array(z.string()),
});
export type WorkspaceState = {
  phase: "loading" | "anonymous" | "ready" | "error";
  session?: z.infer<typeof sessionSchema>;
  organizations: OrganizationMembership[];
  nextOffset: number | null;
  context?: OrganizationContext;
  permissions: string[];
  switching: boolean;
  error?: string;
};
export function workspaceController(fetcher: typeof fetch = fetch) {
  let state: WorkspaceState = {
    phase: "loading",
    organizations: [],
    nextOffset: null,
    permissions: [],
    switching: false,
  };
  const subscribers = new Set<() => void>();
  let epoch = 0;
  const update = (next: WorkspaceState) => {
    state = next;
    subscribers.forEach((fn) => fn());
  };
  async function request(path: string, init?: RequestInit) {
    const response = await fetcher(path, {
      ...init,
      credentials: "same-origin",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok)
      throw Object.assign(Error("Request failed"), { status: response.status });
    return response;
  }
  const anonymous = () =>
    update({
      phase: "anonymous",
      organizations: [],
      nextOffset: null,
      permissions: [],
      switching: false,
    });
  return {
    subscribe(fn: () => void) {
      subscribers.add(fn);
      return () => {
        subscribers.delete(fn);
      };
    },
    snapshot() {
      return state;
    },
    async load() {
      const ticket = ++epoch;
      update({
        phase: "loading",
        organizations: [],
        nextOffset: null,
        permissions: [],
        switching: false,
      });
      try {
        const session = sessionSchema.parse(
          await (await request("/auth/session")).json(),
        );
        const page = pageSchema.parse(
          await (await request("/v1/me/organizations?limit=50")).json(),
        );
        if (ticket !== epoch) return;
        update({
          phase: "ready",
          session,
          organizations: page.organizations,
          nextOffset: page.nextOffset,
          permissions: [],
          switching: false,
        });
      } catch (error) {
        if (ticket !== epoch) return;
        if ((error as { status?: number }).status === 401) anonymous();
        else
          update({
            phase: "error",
            organizations: [],
            nextOffset: null,
            permissions: [],
            switching: false,
            error:
              "Your workspace is temporarily unavailable. Please try again.",
          });
      }
    },
    async more() {
      if (state.nextOffset === null || state.phase !== "ready") return;
      const ticket = epoch,
        offset = state.nextOffset;
      try {
        const page = pageSchema.parse(
          await (
            await request(`/v1/me/organizations?limit=50&offset=${offset}`)
          ).json(),
        );
        if (ticket !== epoch || state.nextOffset !== offset) return;
        const rows = new Map(
          [...state.organizations, ...page.organizations].map((row) => [
            row.organization_id,
            row,
          ]),
        );
        update({
          ...state,
          organizations: [...rows.values()],
          nextOffset: page.nextOffset,
        });
      } catch (error) {
        if (ticket !== epoch) return;
        if ((error as { status?: number }).status === 401) {
          ++epoch;
          anonymous();
        } else
          update({
            ...state,
            error: "More organizations could not be loaded.",
          });
      }
    },
    async select(id: string) {
      if (state.phase !== "ready") return;
      const ticket = ++epoch;
      // Clear every tenant-scoped value BEFORE awaiting the new membership check.
      const { context: _context, error: _error, ...remaining } = state;
      update({ ...remaining, permissions: [], switching: true });
      try {
        const result = contextSchema.parse(
          await (
            await request(`/v1/organizations/${encodeURIComponent(id)}/context`)
          ).json(),
        );
        if (ticket !== epoch) return;
        if (
          result.organization.organization_id !== id ||
          result.organization.user_id !== state.session?.userId
        )
          throw Error("Context mismatch");
        update({
          ...state,
          context: result.organization,
          permissions: result.permissions,
          switching: false,
        });
      } catch (error) {
        if (ticket !== epoch) return;
        if ((error as { status?: number }).status === 401) anonymous();
        else
          update({
            ...state,
            switching: false,
            error:
              "This organization is unavailable or your access has changed. Choose another organization.",
          });
      }
    },
    async logout() {
      const csrf = state.session?.csrfToken;
      if (!csrf) return;
      const ticket = ++epoch;
      const { context: _context, ...remaining } = state;
      update({ ...remaining, permissions: [], switching: false });
      try {
        await request("/auth/logout", {
          method: "POST",
          headers: { "X-CSRF-Token": csrf },
        });
        if (ticket === epoch) anonymous();
      } catch {
        if (ticket === epoch)
          update({
            ...state,
            error: "Sign-out did not complete. Please try again.",
          });
      }
    },
  };
}
