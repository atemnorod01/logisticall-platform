export interface MediaStorage {
  put(key: string, data: Buffer, mime: string): Promise<void>;
  get(key: string, size: number): Promise<Buffer>;
}

/** Private bucket; the messaging API authorizes every read before fetching bytes. */
export function supabaseMediaStorage(origin: string, secret: string, bucket: string, fetcher: typeof fetch = fetch): MediaStorage {
  const base = new URL(origin);
  if (base.protocol !== "https:" || base.username || base.password || base.pathname !== "/" || base.search || base.hash)
    throw Error("Invalid media storage origin");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(bucket) || !secret) throw Error("Invalid media storage configuration");
  function url(key: string) {
    if (!/^[a-f0-9-]+\/[a-f0-9-]+$/.test(key)) throw Error("Invalid media object key");
    return `${base.origin}/storage/v1/object/${bucket}/${key}`;
  }
  const headers = {apikey: secret, Authorization: `Bearer ${secret}`};
  return {
    async put(key, data, mime) {
      const response = await fetcher(url(key), {method:"POST",headers:{...headers,"Content-Type":mime,"x-upsert":"true"},body:new Uint8Array(data),redirect:"error",signal:AbortSignal.timeout(20000)});
      if (!response.ok) throw Error("Media storage upload failed");
      await response.body?.cancel();
    },
    async get(key, size) {
      const response = await fetcher(url(key), {headers,redirect:"error",signal:AbortSignal.timeout(20000)});
      if (!response.ok || !response.body) throw Error("Media storage download failed");
      const chunks: Uint8Array[] = [];
      const reader = response.body.getReader();
      let length = 0;
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          length += chunk.value.length;
          if (length > size || length > 26214400) throw Error("Media storage size mismatch");
          chunks.push(chunk.value);
        }
        if (length !== size) throw Error("Media storage size mismatch");
        return Buffer.concat(chunks);
      } finally { await reader.cancel(); }
    },
  };
}
