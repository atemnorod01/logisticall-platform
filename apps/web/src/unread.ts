import { useEffect, useState } from 'react';
import { subscribeWorkspace } from './realtime.js';
export function useUnreadMessages(org: string | undefined, user: string | undefined) {
  const key = `${org}:${user}`;
  const [state, setState] = useState({ key: '', count: 0 });
  useEffect(() => {
    if (!org || !user) return;
    let live = true, busy = false, pending = false;
    const abort = new AbortController();
    const load = async () => {
      if (busy) { pending = true; return; }
      busy = true;
      try {
        const response = await fetch(`/v1/organizations/${org}/messaging/badges`, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10000)]) });
        if (response.status === 401 || response.status === 403) { if (live) setState({ key, count: 0 }); return; }
        if (!response.ok) throw Error();
        const value = await response.json() as { messages: number };
        if (live && Number.isInteger(value.messages) && value.messages >= 0) setState({ key, count: value.messages });
      } catch { /* Retain the last count through transient connection failures. */ }
      finally { busy = false; if (pending && live) { pending = false; void load(); } }
    };
    const refresh = () => { if (document.visibilityState === 'visible') void load(); };
    void load();
    const unsubscribe = subscribeWorkspace(org, user, event => { if (event.kind !== 'typing' && event.kind !== 'calls') refresh(); });
    const fallback = setInterval(refresh, 60000);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('online', refresh);
    return () => { live = false; abort.abort(); unsubscribe(); clearInterval(fallback); document.removeEventListener('visibilitychange', refresh); window.removeEventListener('online', refresh); };
  }, [org, user, key]);
  return state.key === key ? state.count : 0;
}
