import { createGunzip, createInflate, createBrotliDecompress } from "node:zlib";
import type { Readable } from "node:stream";
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import sanitizeHtml from "sanitize-html";
export function publicIPv4(ip: string) {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((v) => !Number.isInteger(v) || v < 0 || v > 255))
    return false;
  const [a, b] = p;
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a! >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b! >= 16 && b! <= 31) ||
    (a === 192 && (b === 168 || b === 0 || b === 2)) ||
    (a === 100 && b! >= 64 && b! <= 127) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0)
  );
}
export type LinkPreview = {
  url: string;
  domain: string;
  title: string;
  description: string;
  image: string | null;
  available: boolean;
};
const cache = new Map<string, { until: number; value: LinkPreview }>();
function safeUrl(raw: string) {
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  )
    throw Error("Unsupported URL");
  return url;
}
async function publicAddress(url: URL) {
  const resolved = await lookup(url.hostname, { family: 4, all: true });
  if (!resolved.length || resolved.some((a) => !publicIPv4(a.address)))
    throw Error("Private target");
  return resolved[0]!.address;
}
// Each redirect gets a fresh public-address check; requests use the checked IP.
async function fetchPreview(url: URL, hops = 0): Promise<string> {
  safeUrl(url.href);
  const address = await publicAddress(url);
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: "GET",
        family: 4,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; LogistiCallPreview/1.0)",
          Accept: "text/html,application/json",
          "Accept-Encoding": "identity",
        },
        lookup: (_hostname, options, cb) => {
          // Modern Node can request an array even with a pinned address.
          if ((options as { all?: boolean }).all)
            cb(null, [{ address, family: 4 }] as unknown as string, 4);
          else cb(null, address, 4);
        },
      },
      (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode ?? 0)) {
          res.resume();
          if (hops >= 3 || !res.headers.location) {
            reject(Error("Redirect limit"));
            return;
          }
          try {
            void fetchPreview(
              safeUrl(new URL(res.headers.location, url).href),
              hops + 1,
            ).then(resolve, reject);
          } catch (e) {
            reject(e);
          }
          return;
        }
        if (
          res.statusCode !== 200 ||
          !/text\/html|application\/(?:json|octet-stream)/i.test(
            String(res.headers["content-type"]),
          )
        ) {
          res.resume();
          reject(Error("Preview unavailable"));
          return;
        }
        void readPreviewBody(
          res,
          String(res.headers["content-encoding"] ?? ""),
        ).then(resolve, reject);
      },
    );
    const timer = setTimeout(() => req.destroy(Error("Timeout")), 5000);
    req.on("close", () => clearTimeout(timer));
    req.on("error", reject);
    req.end();
  });
}
export function readPreviewBody(
  source: Readable,
  encoding = "",
): Promise<string> {
  return new Promise((resolve, reject) => {
    let finished = false;
    const fail = (error: Error) => {
      if (!finished) {
        finished = true;
        reject(error);
        source.destroy();
      }
    };
    source.on("error", fail);
    source.once("readable", () => {
      const prefix = source.read(2) as Buffer | null;
      if (prefix) source.unshift(prefix);
      const gzip =
        encoding === "gzip" || (prefix?.[0] === 0x1f && prefix?.[1] === 0x8b);
      const decoder = gzip
        ? createGunzip()
        : encoding === "br"
          ? createBrotliDecompress()
          : encoding === "deflate"
            ? createInflate()
            : null;
      const stream = decoder ?? source;
      const chunks: Buffer[] = [];
      let size = 0,
        rawSize = 0;
      const finish = () => {
        if (finished) return;
        const text = Buffer.concat(chunks).toString("utf8");
        if (
          !/^\s*(?:<!doctype\s+html|<html\b|<head\b|<meta\b|<title\b|\{)/i.test(
            text,
          )
        ) {
          fail(Error("Not preview metadata"));
          return;
        }
        finished = true;
        resolve(text);
        decoder?.destroy();
        source.destroy();
      };
      stream.on("data", (chunk: Buffer) => {
        chunks.push(chunk.subarray(0, Math.max(0, 524288 - size)));
        size += chunk.length;
        if (size >= 524288 || chunk.toString("utf8").includes("</head>"))
          finish();
      });
      stream.on("end", finish);
      stream.on("error", fail);
      if (decoder) {
        source.on("data", (chunk: Buffer) => {
          rawSize += chunk.length;
          if (rawSize > 524288) fail(Error("Compressed response too large"));
        });
        source.pipe(decoder);
      }
    });
  });
}
function plain(value: string) {
  return sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} })
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .slice(0, 500);
}
export function previewMetadata(html: string, base: string) {
  const meta = new Map<string, string>();
  sanitizeHtml(html, {
    allowedTags: [],
    allowedAttributes: {},
    transformTags: {
      meta: (_tag, attrs) => {
        const key = attrs.property || attrs.name;
        if (key && attrs.content) meta.set(key.toLowerCase(), attrs.content);
        return { tagName: "meta", attribs: {} };
      },
    },
  });
  const title = plain(
    meta.get("og:title") ||
      meta.get("twitter:title") ||
      html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ||
      "",
  );
  const description = plain(
    meta.get("og:description") ||
      meta.get("description") ||
      meta.get("twitter:description") ||
      "",
  );
  let image: string | null = null;
  try {
    const value = meta.get("og:image") || meta.get("twitter:image");
    if (value) image = safeUrl(new URL(value, base).href).href;
  } catch {}
  return { title, description, image };
}
export async function linkPreview(raw: string): Promise<LinkPreview> {
  const url = safeUrl(raw);
  const fallback: LinkPreview = {
    url: url.href,
    domain: url.hostname,
    title: "",
    description: "",
    image: null,
    available: false,
  };
  const hit = cache.get(url.href);
  if (hit && hit.until > Date.now()) return hit.value;
  let value = fallback;
  try {
    const youtube = [
      "youtube.com",
      "www.youtube.com",
      "m.youtube.com",
      "youtu.be",
    ].includes(url.hostname);
    if (youtube) {
      try {
        const endpoint = new URL("https://www.youtube.com/oembed");
        endpoint.searchParams.set("url", url.href);
        endpoint.searchParams.set("format", "json");
        const data = JSON.parse(await fetchPreview(endpoint));
        if (typeof data.title === "string")
          value = {
            ...fallback,
            title: plain(data.title),
            description:
              typeof data.author_name === "string"
                ? plain(data.author_name)
                : "",
            image:
              typeof data.thumbnail_url === "string"
                ? safeUrl(data.thumbnail_url).href
                : null,
            available: true,
          };
      } catch {
        /* Fall back to the page's own metadata. */
      }
    }
    if (!value.available) {
      const metadata = previewMetadata(await fetchPreview(url), url.href);
      value = { ...fallback, ...metadata, available: !!metadata.title };
    }
    if (value.image) {
      try {
        await publicAddress(safeUrl(value.image));
      } catch {
        value.image = null;
      }
    }
  } catch {
    /* Preview failure never blocks sending. */
  }
  if (cache.size >= 100) cache.delete(cache.keys().next().value!);
  cache.set(url.href, {
    until: Date.now() + (value.available ? 300000 : 15000),
    value,
  });
  return value;
}
