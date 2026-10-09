import {
  directoryPage,
  type DirectoryContact,
} from "../../../packages/types/src/index.js";
export type ContactsState = {
  rows: DirectoryContact[];
  loading: boolean;
  error: string;
  nextOffset: number | null;
  search: string;
};
export function contactsController(
  organizationId: string,
  fetcher: typeof fetch = fetch,
) {
  let state: ContactsState = {
    rows: [],
    loading: false,
    error: "",
    nextOffset: null,
    search: "",
  };
  let epoch = 0,
    abort: AbortController | undefined;
  const listeners = new Set<() => void>();
  const update = (next: ContactsState) => {
    state = next;
    listeners.forEach((fn) => fn());
  };
  async function load(search = state.search, more = false) {
    if (more && (state.loading || state.nextOffset === null)) return;
    const offset = more ? state.nextOffset! : 0,
      ticket = ++epoch;
    abort?.abort();
    abort = new AbortController();
    const abortForRequest = abort;
    const timer = setTimeout(() => abortForRequest.abort(), 10000);
    update({
      rows: more ? state.rows : [],
      loading: true,
      error: "",
      nextOffset: null,
      search,
    });
    try {
      const query = new URLSearchParams({
        search,
        offset: String(offset),
        limit: "50",
      });
      const response = await fetcher(
        `/v1/organizations/${encodeURIComponent(organizationId)}/contacts?${query}`,
        {
          credentials: "same-origin",
          redirect: "error",
          cache: "no-store",
          signal: abort.signal,
        },
      );
      if (!response.ok) throw Error("Directory unavailable");
      const result = directoryPage.parse(await response.json());
      if (
        result.organization_id !== organizationId ||
        (result.nextOffset !== null &&
          result.nextOffset !== offset + result.contacts.length) ||
        new Set(result.contacts.map((c) => c.id)).size !==
          result.contacts.length
      )
        throw Error("Directory mismatch");
      if (ticket !== epoch) return;
      const rows = [
        ...new Map(
          [...(more ? state.rows : []), ...result.contacts].map((c) => [
            c.id,
            c,
          ]),
        ).values(),
      ];
      update({
        rows,
        loading: false,
        error: "",
        nextOffset: result.nextOffset,
        search,
      });
    } catch {
      if (ticket === epoch)
        update({
          rows: [],
          loading: false,
          error:
            "Contacts are unavailable or your access has changed. Try again or choose another organization.",
          nextOffset: null,
          search,
        });
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    snapshot: () => state,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    load,
    dispose() {
      ++epoch;
      abort?.abort();
      listeners.clear();
    },
  };
}
export function contactIds(
  storage: Pick<Storage, "getItem"> | undefined,
  key: string,
): string[] {
  try {
    const value: unknown = JSON.parse(storage?.getItem(key) ?? "[]");
    return Array.isArray(value)
      ? value
          .filter(
            (id): id is string =>
              typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id),
          )
          .slice(0, 200)
      : [];
  } catch {
    return [];
  }
}
