import { RealtimeClient } from '@supabase/realtime-js';
import { z } from 'zod';
export const changeSchema = z.object({
  target: z.string().max(300),
  kind: z.enum(['messages', 'typing', 'calls', 'groups']),
  conversationId: z.uuid().optional(),
});
export type WorkspaceChange = z.infer<typeof changeSchema>;
const listeners = new Set<(event: WorkspaceChange | null) => void>();
export const workspaceEvents = {
  subscribe(listener: (event: WorkspaceChange | null) => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  receive(payload: unknown) {
    const event = changeSchema.safeParse(payload);
    if (event.success) for (const listener of listeners) listener(event.data);
  },
  reconnect() { for (const listener of listeners) listener(null); },
};
/** Supabase credentials and the private backend topic never reach a browser. */
export function startSupabaseRealtime(origin: string, secret: string) {
  const client = new RealtimeClient(`${origin}/realtime/v1`, { params: { apikey: secret } });
  client.channel('platform:backend:v1', { config: { private: true } })
    .on('broadcast', { event: 'change' }, event => workspaceEvents.receive(event.payload))
    .subscribe(status => {
      if (status === 'SUBSCRIBED') workspaceEvents.reconnect();
      // No provider error text: it may include connection details.
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') console.error('Realtime connection interrupted; retrying');
    });
  return async () => { await client.removeAllChannels(); client.disconnect(); };
}
