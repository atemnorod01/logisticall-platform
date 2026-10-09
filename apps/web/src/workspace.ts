import {
  organizationEdit,
  organizationProfile,
} from "../../../packages/types/src/settings.js";
import {
  organizationContext,
  organizationMemberships,
  type OrganizationContext,
  type OrganizationMembership,
} from "../../../packages/types/src/index.js";
import { z } from "zod";
const sessionSchema = z.object({
  userId: z.uuid(),
  csrfToken: z.string(),
  email: z.string().max(254).nullable().optional(),
  displayName: z.string().max(254).nullable().optional(),
  platformAdmin: z.boolean().default(false),
});
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
const organizationPreference = {
  getItem(key: string) { try { return localStorage.getItem(key); } catch { return null; } },
  setItem(key: string, value: string) { try { localStorage.setItem(key, value); } catch {} },
};
export function workspaceController(fetcher: typeof fetch = fetch, preferences = organizationPreference) {
  let state: WorkspaceState = {
    phase: "loading",
    organizations: [],
    nextOffset: null,
    permissions: [],
    switching: false,
  };
  const subscribers = new Set<() => void>();
  let epoch = 0;
  let signingOut = false;
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
      if (signingOut) return;
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
        const previous = preferences.getItem(`logisticall.last-organization.${session.userId}`);
        if (previous && z.uuid().safeParse(previous).success) await this.select(previous);
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
    async refreshSession() {
      if (signingOut || state.phase !== "ready") return;
      const ticket = epoch;
      try {
        const session = sessionSchema.parse(await (await request("/auth/session")).json());
        if (ticket !== epoch) return;
        if (session.userId !== state.session?.userId) {
          await this.load();
          return;
        }
        update({ ...state, session });
      } catch (error) {
        if (ticket === epoch && (error as { status?: number }).status === 401) {
          ++epoch;
          anonymous();
        }
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
        preferences.setItem(`logisticall.last-organization.${state.session!.userId}`, id);
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
    async saveProfile(name: string) {
      const ticket = epoch,
        user = state.session?.userId;
      const value = z
        .object({ user_id: z.uuid(), display_name: z.string().max(100) })
        .parse(
          await (
            await request("/v1/me/profile", {
              method: "PATCH",
              headers: {
                "Content-Type": "application/json",
                "X-CSRF-Token": state.session!.csrfToken,
              },
              body: JSON.stringify({ name }),
            })
          ).json(),
        );
      if (ticket !== epoch || value.user_id !== user)
        throw Error("Account changed");
      update({
        ...state,
        session: { ...state.session!, displayName: value.display_name },
      });
    },
    async saveOrganization(input: z.infer<typeof organizationEdit>) {
      const ticket = epoch,
        org = state.context!.organization_id;
      const value = organizationProfile.parse(
        await (
          await request(`/v1/organizations/${org}/profile`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              "X-CSRF-Token": state.session!.csrfToken,
            },
            body: JSON.stringify(input),
          })
        ).json(),
      );
      if (ticket !== epoch || value.organization_id !== org)
        throw Error("Organization changed");
      update({
        ...state,
        context: { ...state.context!, name: value.name },
        organizations: state.organizations.map((o) =>
          o.organization_id === org ? { ...o, name: value.name } : o,
        ),
      });
      return value;
    },
    async logout() {
      const csrf = state.session?.csrfToken;
      if (!csrf || signingOut) return false;
      signingOut = true;
      const ticket = ++epoch;
      const { context: _context, ...remaining } = state;
      update({ ...remaining, permissions: [], switching: false });
      try {
        await request("/auth/logout", {
          method: "POST",
          headers: { "X-CSRF-Token": csrf },
        });
        if (ticket === epoch) { anonymous(); return true; }
      } catch {
        if (ticket === epoch)
          update({
            ...state,
            error: "Sign-out did not complete. Please try again.",
          });
      } finally {
        signingOut = false;
      }
      return false;
    },
  };
}
