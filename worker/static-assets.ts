// Static assets behind the Worker. This module imports nothing, so the
// real-runtime test can load it into workerd as it is.

type Assets = { fetch(request: Request): Promise<Response> };

const HASHED_ASSET = /\/[\w.-]+-[\w-]{8,}\.[\w]+$/;
const IMMUTABLE_ASSET = "public, max-age=31536000, immutable";

/** Whether a build asset gets a brotli sibling in the deploy candidate. */
export function isCompressibleAsset(name: string): boolean {
  return /\.(?:js|css|wasm|ttf)$/u.test(name);
}

function isShell(response: Response): boolean {
  return (response.headers.get("content-type") ?? "")
    .toLowerCase()
    .includes("text/html");
}

/**
 * Cloudflare may rewrite `Accept-Encoding` on the way to a Worker; the
 * client's own value is `request.cf.clientAcceptEncoding`.
 */
function clientAcceptsBrotli(request: Request): boolean {
  const { cf } = request as Request & {
    cf?: { clientAcceptEncoding?: string };
  };
  const header =
    cf?.clientAcceptEncoding ?? request.headers.get("accept-encoding") ?? "";
  return header.split(",").some((token) => {
    const [coding, ...parameters] = token.trim().toLowerCase().split(";");
    if (coding?.trim() !== "br") return false;
    const quality = parameters
      .map((parameter) => /^\s*q=([\d.]+)\s*$/u.exec(parameter)?.[1])
      .find((value) => value !== undefined);
    return quality === undefined || Number(quality) > 0;
  });
}

/**
 * The asset's `.br` sibling labelled with the original's content type, or
 * null when the client does not take brotli, asks for a range (which the
 * asset layer answers with the whole identity file), or either file is
 * missing. The original is read with HEAD, so only one body is fetched.
 */
async function fetchBrotliSibling(
  request: Request,
  assets: Assets,
): Promise<Response | null> {
  if (
    !["GET", "HEAD"].includes(request.method) ||
    request.headers.has("range") ||
    !clientAcceptsBrotli(request)
  ) {
    return null;
  }
  const url = new URL(request.url);
  url.pathname += ".br";
  const [original, sibling] = await Promise.all([
    assets.fetch(new Request(request.url, { method: "HEAD" })),
    assets.fetch(new Request(url, request)),
  ]);
  const contentType = original.headers.get("content-type");
  if (
    original.status !== 200 ||
    !contentType ||
    isShell(original) ||
    (sibling.status !== 200 && sibling.status !== 304) ||
    isShell(sibling)
  ) {
    await sibling.body?.cancel();
    return null;
  }
  const headers = new Headers(sibling.headers);
  headers.set("content-type", contentType);
  headers.set("content-encoding", "br");
  return encodedResponse(sibling.body, sibling.status, headers);
}

/** A body that already carries its Content-Encoding is not encoded again. */
function encodedResponse(
  body: ReadableStream | null,
  status: number,
  headers: Headers,
): Response {
  const init: ResponseInit & { encodeBody: "automatic" | "manual" } = {
    status,
    headers,
    encodeBody: headers.has("content-encoding") ? "manual" : "automatic",
  };
  return new Response(body, init);
}

/**
 * Serve a static asset, and let a missing one be missing.
 *
 * The boundary, which is the thing an earlier attempt did not draw: a path
 * under `/assets/` names a CONTENT-HASHED FILE. The name is a promise about
 * the bytes behind it, so if those bytes are gone the honest answer is 404.
 * Every other path is a CLIENT ROUTE — `/editor`, `/g/<id>` — which never had
 * a file behind it, and whose miss is answered with the shell so the app can
 * boot and route it.
 *
 * The asset layer cannot tell them apart: `not_found_handling:
 * single-page-application` answers both with index.html at status 200. That
 * is right for a route and wrong for an asset, and it is the bug a browser
 * reports as "Failed to fetch dynamically imported module" after a redeploy
 * retires a chunk name. So `/assets/*` runs the Worker first, and the shell
 * arriving where a script was requested is recognised and turned into a 404.
 *
 * Detection is by content type rather than by comparing bytes: a real file
 * under /assets/ is script, style, font or image, and never text/html.
 *
 * A client that takes brotli gets a compressible hashed asset from its
 * pre-compressed sibling when the deploy carries one; both answers then pass
 * the same rules below.
 */
export async function serveAsset(
  request: Request,
  assets: Assets,
): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/assets/")) return assets.fetch(request);
  const hashed = HASHED_ASSET.test(path);
  const compressible = hashed && isCompressibleAsset(path);
  const response =
    (compressible ? await fetchBrotliSibling(request, assets) : null) ??
    (await assets.fetch(request));
  if (isShell(response)) {
    await response.body?.cancel();
    return new Response(`Not found: ${path}`, {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        // A retired name must not be cached as anything, least of all as a
        // 404 that outlives the next deploy that might reuse it.
        "cache-control": "no-store",
      },
    });
  }
  // Only successful content-hashed build assets are immutable. Errors and
  // explicitly private responses keep their policy.
  const immutable =
    hashed &&
    (response.status === 200 || response.status === 304) &&
    !/\b(no-store|private)\b/i.test(
      response.headers.get("cache-control") ?? "",
    ) &&
    !response.headers.has("set-cookie");
  if (!immutable && !compressible) return response;
  const headers = new Headers(response.headers);
  if (immutable) headers.set("cache-control", IMMUTABLE_ASSET);
  // The same name is answered in brotli or not, by the request's encodings.
  if (compressible) headers.append("vary", "Accept-Encoding");
  return encodedResponse(response.body, response.status, headers);
}
