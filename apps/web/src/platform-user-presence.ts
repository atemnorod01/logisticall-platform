import { useEffect, useState } from "react";
import { z } from "zod";

const responseSchema = z.object({
  presence: z.record(z.string(), z.enum(["available", "away", "busy", "offline", "unknown"])),
});

export function usePlatformUserPresence(ids: string[]) {
  const key = [...new Set(ids)].sort().join(",");
  const [states, setStates] = useState<Record<string, string>>({});
  useEffect(() => {
    setStates({});
    if (!key) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running = false;
    async function refresh() {
      if (running || abort.signal.aborted || document.hidden) return;
      running = true;
      clearTimeout(timer);
      const users = key.split(","), next: Record<string, string> = {};
      try {
        for (let i = 0; i < users.length; i += 50) {
          const batch = users.slice(i, i + 50);
          try {
            const response = await fetch(`/v1/platform/user-presence?${new URLSearchParams({ids: batch.join(",")})}`, {
              cache: "no-store",
              signal: AbortSignal.any([abort.signal, AbortSignal.timeout(8000)]),
            });
            if (!response.ok) throw Error();
            Object.assign(next, responseSchema.parse(await response.json()).presence);
          } catch {
            for (const id of batch) next[id] = "unknown";
          }
        }
        if (!abort.signal.aborted) setStates(next);
      } finally {
        running = false;
        if (!abort.signal.aborted) timer = setTimeout(() => void refresh(), 5000);
      }
    }
    const resume = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    void refresh();
    return () => {
      abort.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
    };
  }, [key]);
  return states;
}
