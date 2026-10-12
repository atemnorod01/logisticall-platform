export type Change = { kind: 'messages' | 'calls' | 'typing' | 'groups' | 'profiles' | 'resync'; conversationId?: string };
type Connection = { source: EventSource; listeners: Set<(event: Change) => void> };
const connections = new Map<string, Connection>();
/** One same-origin event stream per signed-in identity, shared by all views. */
export function subscribeWorkspace(org: string, user: string, listener: (event: Change) => void) {
  const key = `${org}:${user}`;
  let connection = connections.get(key);
  if (!connection) {
    const source = new EventSource(`/v1/organizations/${org}/messaging/events?${new URLSearchParams({ userId: user })}`);
    connection = { source, listeners: new Set() };
    connections.set(key, connection);
    const current = connection;
    source.addEventListener('change', event => {
      try {
        const value = JSON.parse((event as MessageEvent).data) as Change;
        if (!['messages','calls','typing','groups','profiles','resync'].includes(value.kind)) return;
        if (value.kind === "profiles") window.dispatchEvent(new Event("logisticall:profile-changed"));
        for (const receive of current.listeners) receive(value);
      } catch { /* Invalid event cannot mutate workspace state. */ }
    });
  }
  connection.listeners.add(listener);
  const current = connection;
  return () => {
    current.listeners.delete(listener);
    if (!current.listeners.size) { current.source.close(); connections.delete(key); }
  };
}
