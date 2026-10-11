import {
  conversationPage,
  conversationSchema,
  messagePage,
  type Conversation,
  type Message,
} from "../../../packages/types/src/messaging.js";
export function messagingController(
  org: string,
  csrf: string,
  fetcher: typeof fetch = fetch,
) {
  type State = {
    rows: Conversation[];
    selected: Conversation | null;
    messages: Message[];
    hasMore: boolean;
    typing: boolean;
    typingExpiresAt: string | null;
    timelineLoading: boolean;
    nextOffset: number | null;
    groupId: string;
    scope: string;
    filter: string;
    search: string;
    loading: boolean;
    busy: boolean;
    error: string;
  };
  let state: State = {
    rows: [],
    selected: null,
    messages: [],
    typing: false,
    typingExpiresAt: null,
    timelineLoading: false,
    hasMore: false,
    nextOffset: null,
    groupId: "",
    scope: "",
    filter: "all",
    search: "",
    loading: false,
    busy: false,
    error: "",
  };
  let epoch = 0,
    selection = 0,
    disposed = false,
    polling = false,
    identityVersion = "",
    lastListRefresh = 0;
  const abort = new AbortController();
  const cache = new Map<string, { messages: Message[]; hasMore: boolean }>();
  let prefetched: {
    path: string;
    page: ReturnType<typeof messagePage.parse>;
  } | null = null;
  function prefetch(id: string, messages: Message[], hasMore: boolean) {
    if (!hasMore || !messages[0]) return;
    const current = epoch,
      ticket = selection;
    const path = `/${id}/messages${query({ before: String(messages[0].sequence) })}`;
    void request(path)
      .then((value) => {
        const page = messagePage.parse(value);
        if (current === epoch && ticket === selection)
          prefetched = { path, page };
      })
      .catch(() => {});
  }
  const readThrough = new Map<string, number>();
  const listeners = new Set<() => void>();
  const emit = (patch: Partial<State>) => {
    if (disposed) return;
    state = { ...state, ...patch };
    listeners.forEach((f) => f());
  };
  const base = `/v1/organizations/${org}/messaging`;
  async function request(path: string, method = "GET", body?: unknown) {
    const response = await fetcher(base + path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10000)]),
      headers: {
        "X-CSRF-Token": csrf,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw Object.assign(Error(), { status: response.status });
    return response.json() as Promise<unknown>;
  }
  const query = (extra: Record<string, string> = {}) =>
    "?" +
    new URLSearchParams({
      ...(state.groupId ? { groupId: state.groupId } : {}),
      ...extra,
    });
  const listQuery = (extra: Record<string, string> = {}) =>
    state.scope === "all"
      ? "/feed?" + new URLSearchParams(extra)
      : "?" +
        new URLSearchParams({
          ...(state.scope ? { groupId: state.scope } : {}),
          ...extra,
        });
  function fail(error: unknown) {
    const status = (error as { status?: number }).status;
    emit({
      error:
        status === 409
          ? "This conversation changed. Refresh and try again."
          : status === 401 || status === 403 || status === 404
            ? "Your access to this conversation has changed."
            : "Unable to update messages. Please retry.",
      ...([401, 403, 404].includes(status ?? 0)
        ? { rows: [], selected: null, messages: [] }
        : {}),
    });
  }
  const api = {
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    snapshot: () => state,
    dispose() {
      disposed = true;
      ++epoch;
      ++selection;
      abort.abort();
    },
    request,
    async load(
      scope = state.scope,
      filter = state.filter,
      search = state.search,
    ) {
      const ticket = ++epoch;
      ++selection;
      emit({
        scope,
        groupId: scope === "all" ? "" : scope,
        filter,
        search,
        rows: [],
        nextOffset: null,
        selected: null,
        messages: [],
        loading: true,
        error: "",
      });
      try {
        const p = conversationPage.parse(
          await request(listQuery({ filter, search })),
        );
        if (ticket === epoch) {
          lastListRefresh = Date.now();
          emit({ rows: p.conversations, nextOffset: p.nextOffset });
        }
      } catch (e) {
        if (ticket === epoch) fail(e);
      } finally {
        if (ticket === epoch) emit({ loading: false });
      }
    },
    clearSelection() {
      ++selection;
      emit({selected:null,messages:[],typing:false,typingExpiresAt:null,timelineLoading:false,hasMore:false,groupId:state.scope==="all"?"":state.scope});
    },
    leaveEmpty() {
      if (state.selected?.hasMessages !== false) return;
      ++selection;
      emit({
        selected: null,
        messages: [],
        typing: false,
        typingExpiresAt: null,
        timelineLoading: false,
        hasMore: false,
        groupId: state.scope === "all" ? "" : state.scope,
      });
    },
    async select(row: Conversation) {
      const ticket = ++selection,
        current = epoch;
      const cacheKey = `${row.inbox.id}:${row.id}`;
      const cached =
        row.inbox.kind === "group" || row.peer.kind === "group"
          ? undefined
          : cache.get(cacheKey);
      emit({
        timelineLoading: true,
        selected: row,
        groupId: row.inbox.kind === "group" ? row.inbox.id : "",
        messages: cached?.messages ?? [],
        typing: false,
        typingExpiresAt: null,
        hasMore: cached?.hasMore ?? false,
        error: "",
      });
      try {
        const p = messagePage.parse(
          await request(`/${row.id}/messages${query()}`),
        );
        if (current === epoch && ticket === selection) {
          identityVersion = p.identityVersion;
          emit({
            messages: p.messages,
            hasMore: p.hasMore,
            typing: p.typing,
            typingExpiresAt: p.typingExpiresAt,
            timelineLoading: false,
          });
          cache.delete(cacheKey);
          cache.set(cacheKey, { messages: p.messages, hasMore: p.hasMore });
          if (cache.size > 8) cache.delete(cache.keys().next().value!);
          prefetch(row.id, p.messages, p.hasMore);
        }
      } catch (e) {
        if (current === epoch && ticket === selection) {
          emit({ timelineLoading: false });
          fail(e);
        }
      }
    },
    async refresh(options: { background?: boolean } = {}) {
      if (polling || disposed || state.loading || state.busy) return;
      polling = true;
      const current = epoch,
        ticket = selection,
        id = state.selected?.id;
      try {
        const selectedQuery = query();
        const refreshList = async () => {
          if (options.background && Date.now() - lastListRefresh < 10000) return;
          const wanted = Math.max(30, state.rows.length), filter = state.filter, search = state.search;
          const rows: Conversation[] = [];
          let offset: number | null = 0;
          while (offset !== null && rows.length < wanted) {
            const p = conversationPage.parse(await request(listQuery({ filter, search, offset: String(offset) })));
            if (current !== epoch) return;
            rows.push(...p.conversations);
            offset = p.nextOffset;
          }
          lastListRefresh = Date.now();
          emit({ rows, nextOffset: offset, error: "" });
        };
        const [, snapshot] = await Promise.all([
          refreshList(),
          id ? request(`/${id}/snapshot${selectedQuery}`) : Promise.resolve(null),
        ]);
        if (id && snapshot) {
          const detail = conversationSchema.parse((snapshot as { conversation: unknown }).conversation);
          const messages = messagePage.parse(snapshot);
          if (current !== epoch || ticket !== selection) return;
          const changedIdentity = identityVersion !== messages.identityVersion;
          const refreshed = [...messages.messages];
          let hasMore = messages.hasMore;
          const oldest = state.messages[0]?.sequence ?? Number.MAX_SAFE_INTEGER;
          if (changedIdentity) {
            // Clear stale attribution only when visibility changes, not on routine polls.
            emit({
              messages: state.messages.map((m) => ({
                ...m,
                senderName: "",
                actorName: null,
              })),
            });
          }
          if (changedIdentity || state.messages.length > 50) {
            while (hasMore && refreshed[0] && refreshed[0].sequence > oldest) {
              const page = messagePage.parse(
                await request(
                  `/${id}/messages${query({ before: String(refreshed[0].sequence) })}`,
                ),
              );
              if (current !== epoch || ticket !== selection) return;
              if (page.identityVersion !== messages.identityVersion) return; // Retry a coherent snapshot next refresh.
              refreshed.unshift(...page.messages);
              hasMore = page.hasMore;
            }
          }
          identityVersion = messages.identityVersion;
          const map = new Map(
            [...(changedIdentity ? [] : state.messages), ...refreshed].map(
              (m) => [m.id, m],
            ),
          );
          emit({
            selected: detail,
            typing: messages.typing,
            typingExpiresAt: messages.typingExpiresAt,
            messages: [...map.values()].sort((a, b) => a.sequence - b.sequence),
            hasMore: changedIdentity
              ? hasMore
              : state.messages.length > 50
                ? state.hasMore
                : messages.hasMore,
          });
        }
      } catch (e) {
        if (current === epoch && ticket === selection) fail(e);
      } finally {
        polling = false;
      }
    },
    async read() {
      const id = state.selected?.id,
        last = Math.max(0, ...state.messages.flatMap(m => [m.sequence, ...m.internalComments.map(c => c.sequence)]));
      if (
        !id ||
        !last ||
        (typeof document !== "undefined" &&
          document.visibilityState !== "visible")
      )
        return;
      const key = `${state.groupId}:${id}`;
      if ((readThrough.get(key) ?? 0) >= last) return;
      await request(`/${id}/read${query()}`, "POST", { sequence: last });
      readThrough.set(key, last);
      if (state.selected?.id === id)
        emit({
          rows: state.rows.map((r) => (r.id === id ? { ...r, unread: 0 } : r)),
        });
    },
    async more() {
      const offset = state.nextOffset;
      if (offset === null || state.busy) return;
      const current = epoch;
      emit({ busy: true });
      try {
        const p = conversationPage.parse(
          await request(
            listQuery({
              filter: state.filter,
              search: state.search,
              offset: String(offset),
            }),
          ),
        );
        if (current === epoch)
          emit({
            rows: [
              ...new Map(
                [...state.rows, ...p.conversations].map((r) => [r.id, r]),
              ).values(),
            ],
            nextOffset: p.nextOffset,
          });
      } catch (e) {
        if (current === epoch) fail(e);
      } finally {
        emit({ busy: false });
      }
    },
    async older() {
      if (!state.selected || !state.hasMore || state.busy) return;
      const current = epoch,
        ticket = selection,
        id = state.selected.id;
      emit({ busy: true });
      try {
        const path = `/${id}/messages${query({ before: String(state.messages[0]!.sequence) })}`;
        const p =
          prefetched?.path === path &&
          prefetched.page.identityVersion === identityVersion
            ? prefetched.page
            : messagePage.parse(await request(path));
        prefetched = null;
        if (current === epoch && ticket === selection) {
          if (p.identityVersion !== identityVersion) {
            emit({ busy: false });
            await api.refresh();
          } else
            emit({
              messages: [...p.messages, ...state.messages],
              hasMore: p.hasMore,
            });
          prefetch(id, p.messages, p.hasMore);
        }
      } catch (e) {
        if (current === epoch && ticket === selection) fail(e);
      } finally {
        emit({ busy: false });
      }
    },
    async send(
      id: string,
      body: string,
      internal: boolean,
      extra: {
        rich?: string;
        replyTo?: string | null;
        forwardedFrom?: string | null;
        attachments?: string[];
      } = {},
    ) {
      if (state.busy || !state.selected) return false;
      const current = epoch,
        ticket = selection,
        conversation = state.selected.id;
      emit({ busy: true, error: "" });
      try {
        await request(`/${conversation}/messages${query()}`, "POST", {
          id,
          body,
          internal,
          ...extra,
        });
        if (current !== epoch || ticket !== selection) return true;
        emit({ busy: false });
        await api.refresh();
        return true;
      } catch (e) {
        if (current === epoch && ticket === selection) fail(e);
        return false;
      } finally {
        emit({ busy: false });
      }
    },
    async update(input: { done?: boolean; assignedTo?: string | null }) {
      if (state.busy || !state.selected) return;
      const current = epoch,
        ticket = selection,
        conversation = state.selected;
      emit({ busy: true, error: "" });
      try {
        const r = conversationSchema.parse(
          (
            (await request(`/${conversation.id}${query()}`, "PATCH", {
              ...input,
              version: conversation.version,
            })) as { conversation: unknown }
          ).conversation,
        );
        if (current === epoch && ticket === selection)
          emit({
            selected: r,
            rows: state.rows.map((v) => (v.id === r.id ? r : v)),
          });
      } catch (e) {
        if (current === epoch && ticket === selection) fail(e);
      } finally {
        emit({ busy: false });
      }
    },
    async action(path: string, method = "POST", body?: unknown) {
      const current = epoch,
        ticket = selection;
      try {
        await request(path, method, body);
        cache.clear();
        prefetched = null;
        if (current === epoch && ticket === selection) await api.refresh();
        return true;
      } catch (e) {
        if (current === epoch && ticket === selection) fail(e);
        return false;
      }
    },
    path(suffix = "") {
      return state.selected ? `/${state.selected.id}${suffix}${query()}` : "";
    },
    async createTeam(recipients: string[], title: string) {
      const current = epoch;
      emit({ busy: true, error: "" });
      try {
        const r = conversationSchema.parse(
          (
            (await request("/team", "POST", { recipients, title })) as {
              conversation: unknown;
            }
          ).conversation,
        );
        if (current !== epoch) return;
        await api.select(r);
        return r;
      } catch (e) {
        if (current === epoch) fail(e);
      } finally {
        emit({ busy: false });
      }
    },
    async directParticipant(target:{id:string;organizationId:string}) {
      if(state.busy||!state.selected)return;
      const current=epoch;
      emit({busy:true,error:""});
      try {
        const result=await request(api.path("/direct"),"POST",target) as {conversation:unknown};
        const conversation=conversationSchema.parse(result.conversation);
        if(current!==epoch)return;
        await api.select(conversation);
        return conversation;
      } catch { if(current===epoch)emit({error:"Could not open this direct conversation. Please try again."}); }
      finally {emit({busy:false});}
    },
    async create(target: {
      kind: "user" | "group";
      id: string;
      organizationId: string;
      email?: string;
    }, personal = false) {
      if (state.busy) return;
      const current = epoch;
      emit({ busy: true, error: "" });
      try {
        const r = conversationSchema.parse(
          (
            (await request("", "POST", {
              target,
              ...(!personal && state.groupId ? { groupId: state.groupId } : {}),
            })) as { conversation: unknown }
          ).conversation,
        );
        if (current !== epoch) return;
        // New empty selections stay out of the list until their first message.
        await api.select(r);
        return r;
      } catch (e) {
        if (current === epoch) fail(e);
      } finally {
        emit({ busy: false });
      }
    },
  };
  return api;
}
