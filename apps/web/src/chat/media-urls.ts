import { useEffect, useState } from "react";
import type { Attachment } from "../../../../packages/types/src/messaging.js";
const caches = new WeakMap<
  object,
  Map<string, { url: string; until: number }>
>();
export function useMediaUrls(
  files: Attachment[],
  path: (id: string) => string,
  request: (path: string, method?: string) => Promise<unknown>,
) {
  let cache = caches.get(request);
  if (!cache) {
    cache = new Map();
    caches.set(request, cache);
  }
  const scoped = cache;
  const keys = files.map((f) => path(f.id)).join("|"),
    [urls, setUrls] = useState<Record<string, string>>({}),
    [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    let live = true;
    void Promise.all(
      files.map(async (f) => {
        const key = path(f.id),
          old = scoped.get(key);
        if (old && old.until > Date.now()) return [f.id, old.url];
        try {
          const urlPath = key.replace("?", "/url?");
          const result = (await request(urlPath, "POST")) as { url: string };
          if (scoped.size >= 100) scoped.delete(scoped.keys().next().value!);
          scoped.set(key, { url: result.url, until: Date.now() + 540000 });
          return [f.id, result.url];
        } catch {
          return [f.id, "#unavailable"];
        }
      }),
    ).then((entries) => {
      if (live) setUrls(Object.fromEntries(entries));
    });
    return () => {
      live = false;
    };
  }, [keys, tick, request]);
  return urls;
}
