// Adapted from LXY-freshman/schematic-draft @ 5231840f (AGPL-3.0-only).
// Original author: LXY-freshman. See ../SOURCES.md for exact source and changes.
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";

/**
 * The editor's origin inside the desktop shell.
 *
 * The shell serves the editor bundle over a private `app://` scheme rather
 * than a loopback HTTP port. The origin is therefore stable across launches
 * (recovery copies and preferences stay put), no socket is ever opened, and
 * no other process on the computer can reach the Project API.
 */
export const APP_SCHEME = "app";
export const APP_HOST = "analog-canvas";
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

const TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export interface AppProtocolOptions {
  editorRoot: string;
  exportFile: (request: Request) => Promise<Response>;
  projectFile?: (request: Request) => Promise<Response>;
}

function inside(root: string, requested: string): string {
  const target = resolve(root, requested);
  const relation = relative(root, target);
  if (relation.startsWith("..") || isAbsolute(relation)) {
    throw new Error("Requested path escapes the editor root");
  }
  return target;
}

/**
 * Hash the document's inline bootstrap scripts for a script-src policy that
 * admits only those scripts and bundled modules. This is CSP authorization,
 * not package integrity verification. Inline styles are separately allowed.
 */
function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = [];
  for (const match of html.matchAll(
    /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/giu,
  )) {
    const body = match[1] ?? "";
    if (body.trim().length === 0) continue;
    hashes.push(
      `'sha256-${createHash("sha256").update(body).digest("base64")}'`,
    );
  }
  return hashes;
}

export async function createAppProtocolHandler(
  options: AppProtocolOptions,
): Promise<(request: Request) => Promise<Response>> {
  const root = resolve(options.editorRoot);
  if (!(await stat(root)).isDirectory()) {
    throw new Error(`Editor root is not a directory: ${root}`);
  }
  const indexHtml = await readFile(inside(root, "index.html"), "utf8");
  const scriptSources = ["'self'", ...inlineScriptHashes(indexHtml)].join(" ");
  // Upstream dynamic styles/attributes do not carry the fork's style nonces.
  // Script execution remains self + exact bootstrap hashes; no eval or inline JS.
  const contentSecurityPolicy = [
    "default-src 'self'",
    "img-src 'self' blob: data:",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    `script-src ${scriptSources}`,
    "worker-src 'self' blob:",
    "connect-src 'self'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");

  const secureHeaders = {
    "content-security-policy": contentSecurityPolicy,
    "cross-origin-opener-policy": "same-origin",
    "x-content-type-options": "nosniff",
  };

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (url.protocol !== `${APP_SCHEME}:` || url.host !== APP_HOST) {
      return new Response("Not Found", { status: 404 });
    }
    let pathname: string;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return new Response("Bad path", { status: 400 });
    }

    if (pathname === "/desktop/export") return options.exportFile(request);
    if (pathname.startsWith("/desktop/project/") && options.projectFile)
      return options.projectFile(request);
    if (pathname.startsWith("/api/") || pathname.startsWith("/desktop/"))
      return new Response("Not Found", { status: 404, headers: secureHeaders });

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405 });
    }
    try {
      const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
      let target = inside(root, relativePath);
      try {
        if (!(await stat(target)).isFile()) throw new Error("not a file");
      } catch {
        // Extensionless paths are editor routes; the document answers them.
        if (extname(relativePath)) throw new Error("Asset not found");
        target = inside(root, "index.html");
      }
      const bytes = await readFile(target);
      const immutable = !target.endsWith("index.html");
      if (!immutable) {
        return new Response(
          request.method === "HEAD" ? null : bytes.toString("utf8"),
          {
            status: 200,
            headers: {
              "content-type": TYPES[".html"] ?? "text/html; charset=utf-8",
              "cache-control": "no-cache",
              ...secureHeaders,
              "content-security-policy": contentSecurityPolicy,
            },
          },
        );
      }
      return new Response(request.method === "HEAD" ? null : bytes, {
        status: 200,
        headers: {
          "content-type": TYPES[extname(target)] ?? "application/octet-stream",
          "cache-control": "public, max-age=31536000, immutable",
          ...secureHeaders,
        },
      });
    } catch {
      return new Response("Not Found", { status: 404, headers: secureHeaders });
    }
  };
}
