export type ProxyEnvironment = { APP_ORIGIN: string; API_ORIGIN: string };
export async function proxyRequest(
  request: Request,
  env: ProxyEnvironment,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  const failure = (status: number) =>
    Response.json(
      { message: "Service unavailable" },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  let origin: URL, upstream: URL, incoming: URL;
  try {
    origin = new URL(env.APP_ORIGIN);
    upstream = new URL(env.API_ORIGIN);
    incoming = new URL(request.url);
    if (
      [origin, upstream].some(
        (url) =>
          url.protocol !== "https:" ||
          url.href !== url.origin + "/" ||
          url.username ||
          url.password,
      )
    )
      return failure(503);
    if (
      incoming.origin !== origin.origin ||
      !/^\/(auth|v1)\//.test(incoming.pathname)
    )
      return failure(404);
  } catch {
    return failure(503);
  }
  const method = request.method;
  if (
    !["GET", "HEAD", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"].includes(
      method,
    )
  )
    return failure(405);
  if (
    !["GET", "HEAD", "OPTIONS"].includes(method) &&
    request.headers.get("Origin") !== origin.origin
  )
    return failure(403);
  // Allowlist forwarded headers. Do not trust client-supplied routing, actor,
  // impersonation, bearer, or IP headers at the browser BFF boundary.
  const headers = new Headers();
  for (const name of [
    "Accept",
    "Content-Type",
    "Cookie",
    "Origin",
    "X-CSRF-Token",
    "Range",
  ]) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  let body: Uint8Array<ArrayBuffer> | undefined;
  const messaging = /^\/v1\/organizations\/[^/]+\/messaging(?:\/|$)/.test(incoming.pathname);
  const upload = method === "PUT" && /^\/v1\/organizations\/[^/]+\/messaging\/[^/]+\/attachments\/[^/]+$/.test(incoming.pathname);
  // Binary uploads use octet-stream; preserve the declared media type so the
  // API can compare it with the reservation and validate the file signature.
  if (upload) {
    const fileType = request.headers.get("X-File-Type");
    if (fileType !== null) headers.set("X-File-Type", fileType);
  }
  const calls = /^\/v1\/organizations\/[^/]+\/calls$/.test(incoming.pathname);
  const streaming = method === "GET" && messaging && /\/(?:events|typing-events|identity-events)$/.test(incoming.pathname);
  const mediaDownload = method === "GET" && /^\/v1\/organizations\/[^/]+\/messaging\/[^/]+\/attachments\/[^/]+$/.test(incoming.pathname);
  const numberRequest = ['GET','POST'].includes(method) && /^\/v1\/(?:platform|organizations\/[0-9a-f-]{36})\/phone-numbers\/(search|orders|console\/.*)$/.test(incoming.pathname);
  const bodyLimit = numberRequest ? 65536 : upload ? 26214400 : calls ? 2900000 : messaging ? 500000 : 16384;
  if (request.body && !["GET", "HEAD"].includes(method)) {
    const reader = request.body.getReader(),
      chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > bodyLimit) {
          await reader.cancel();
          return failure(413);
        }
        chunks.push(part.value);
      }
      body = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.length;
      }
    } catch {
      return failure(400);
    }
  }
  const target = new URL(upstream.origin);
  target.pathname = incoming.pathname;
  target.search = incoming.search;
  try {
    const response = await fetcher(target, {
      method,
      headers,
      ...(body ? { body } : {}),
      redirect: "manual",
      signal: AbortSignal.timeout(numberRequest ? 70000 : upload || streaming || mediaDownload ? 60000 : 12000),
    });
    const outgoing = new Headers();
    for (const name of ["Content-Type", "Location", "Retry-After", "Content-Disposition", "Content-Range", "Accept-Ranges", "Content-Length"]) {
      const value = response.headers.get(name);
      if (value !== null) outgoing.set(name, value);
    }
    for (const value of response.headers.getSetCookie())
      outgoing.append("Set-Cookie", value);
    outgoing.set("Cache-Control", "no-store");
    outgoing.set("X-Content-Type-Options", "nosniff");
    outgoing.set("Referrer-Policy", "no-referrer");
    outgoing.set("X-Frame-Options", "DENY");
    return new Response(response.body, {
      status: response.status,
      headers: outgoing,
    });
  } catch {
    return failure(503);
  }
}
