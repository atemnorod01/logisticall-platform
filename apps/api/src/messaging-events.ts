// Process-local invalidation delivers settings changes immediately. Periodic
// refresh remains the fallback across replicas and interrupted connections.
const listeners = new Map<string, Set<() => void>>();
export function groupIdentityChanged(id: string) {
  for (const listener of listeners.get(id) ?? []) listener();
}
export function onGroupIdentityChanged(ids: string[], listener: () => void) {
  for (const id of ids) {
    const group = listeners.get(id) ?? new Set();
    group.add(listener);
    listeners.set(id, group);
  }
  return () => {
    for (const id of ids) {
      const group = listeners.get(id);
      group?.delete(listener);
      if (!group?.size) listeners.delete(id);
    }
  };
}
