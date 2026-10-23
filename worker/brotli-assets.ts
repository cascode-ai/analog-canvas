/**
 * Pre-compressed build assets.
 *
 * The Worker re-wraps every content-hashed asset to mark it immutable, and
 * the platform then compresses that response at a low level: Production
 * brotli was no smaller than gzip -9. So the deployment candidate carries a
 * quality-11 `<file>.br` beside each compressible asset
 * (scripts/deployment-candidate.mjs), and the Worker serves it to a client
 * that accepts brotli. Any doubt falls back to the original file.
 *
 * The keys are the extensions the candidate compresses; the values are the
 * content types the asset layer serves the originals with, because the
 * sibling's own type describes a `.br` file.
 */
export const BROTLI_CONTENT_TYPES: Readonly<Record<string, string>> = {
  js: "text/javascript",
  css: "text/css",
  wasm: "application/wasm",
  ttf: "font/ttf",
};

/** The content type of a compressible asset path, or undefined. */
export function brotliContentType(path: string): string | undefined {
  const extension = /\.(\w+)$/u.exec(path)?.[1] ?? "";
  return Object.hasOwn(BROTLI_CONTENT_TYPES, extension)
    ? BROTLI_CONTENT_TYPES[extension]
    : undefined;
}

function acceptsBrotli(header: string | null): boolean {
  return (header ?? "").split(",").some((token) => {
    const [coding, ...parameters] = token.trim().toLowerCase().split(";");
    if (coding?.trim() !== "br") return false;
    const quality = parameters
      .map((parameter) => /^\s*q=([\d.]+)\s*$/u.exec(parameter)?.[1])
      .find((value) => value !== undefined);
    return quality === undefined || Number(quality) > 0;
  });
}

/**
 * The `.br` sibling of a content-hashed asset, or null to serve the original.
 * `cacheControl` is the policy the original would get.
 */
export async function serveBrotliSibling(
  request: Request,
  assets: { fetch(request: Request): Promise<Response> },
  contentType: string,
  cacheControl: string,
): Promise<Response | null> {
  if (!["GET", "HEAD"].includes(request.method)) return null;
  // The asset layer answers a range with the whole file; keep that answer
  // about the identity bytes rather than about the compressed ones.
  if (request.headers.has("range")) return null;
  if (!acceptsBrotli(request.headers.get("accept-encoding"))) return null;
  const url = new URL(request.url);
  url.pathname += ".br";
  const sibling = await assets.fetch(new Request(url, request));
  // A missing sibling comes back as the shell; a 304 answers the sibling's
  // own ETag, which a client only holds from an earlier brotli response.
  if (
    (sibling.status !== 200 && sibling.status !== 304) ||
    (sibling.headers.get("content-type") ?? "").includes("text/html")
  ) {
    await sibling.body?.cancel();
    return null;
  }
  const headers = new Headers(sibling.headers);
  headers.set("content-type", contentType);
  headers.set("content-encoding", "br");
  headers.set("cache-control", cacheControl);
  headers.append("vary", "Accept-Encoding");
  const init: ResponseInit & { encodeBody: "manual" } = {
    status: sibling.status,
    headers,
    // The body is already brotli: the runtime must not encode it again.
    encodeBody: "manual",
  };
  return new Response(sibling.body, init);
}
