export type Change = { kind: 'messages' | 'calls' | 'typing' | 'groups' | 'profiles' | 'resync'; conversationId?: string; conversationIds?: string[]; selfProfile?: boolean };
type Connection = { source: EventSource; listeners: Set<(event: Change) => void>; timer?: ReturnType<typeof setTimeout> | undefined; pending: Map<string, Change> };
const connections = new Map<string, Connection>();
/** One same-origin event stream per signed-in identity, shared by all views. */
export function subscribeWorkspace(org: string, user: string, listener: (event: Change) => void) {
  const key = `${org}:${user}`;
  let connection = connections.get(key);
  if (!connection) {
    const source = new EventSource(`/v1/organizations/${org}/messaging/events?${new URLSearchParams({ userId: user })}`);
    connection = { source, listeners: new Set(), pending: new Map() };
    connections.set(key, connection);
    const current = connection;
    source.addEventListener('change', event => {
      try {
        const value = JSON.parse((event as MessageEvent).data) as Change;
        if (!['messages','calls','typing','groups','profiles','resync'].includes(value.kind)) return;
        if (value.kind === "profiles") window.dispatchEvent(new Event("logisticall:profile-changed"));
        if (value.kind === 'calls' || value.kind === 'resync') { for (const receive of current.listeners) receive(value); return; }
        const eventKey=value.kind+(value.selfProfile?':self':'');
        const previous = current.pending.get(eventKey);
        const ids = [...new Set([...(previous?.conversationIds ?? []), ...(value.conversationId ? [value.conversationId] : [])])];
        current.pending.set(eventKey, {...value, ...(ids.length ? {conversationIds:ids} : {})});
        current.timer ??= setTimeout(() => {
          current.timer = undefined;
          const events = [...current.pending.values()]; current.pending.clear();
          for (const event of events) for (const receive of current.listeners) receive(event);
        }, 100);
      } catch { /* Invalid event cannot mutate workspace state. */ }
    });
  }
  connection.listeners.add(listener);
  const current = connection;
  return () => {
    current.listeners.delete(listener);
    if (!current.listeners.size) { current.source.close(); clearTimeout(current.timer); current.pending.clear(); connections.delete(key); }
  };
}
