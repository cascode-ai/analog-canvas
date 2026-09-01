import { createServer } from "node:http";
import type { Server } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";

const TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
};

export interface LocalHostOptions {
  editorRoot: string;
  hostname?: "127.0.0.1" | "::1";
  port?: number;
}

export interface RunningLocalHost {
  origin: string;
  server: Server;
  close(): Promise<void>;
}

function inside(root: string, requested: string): string {
  const target = resolve(root, requested);
  const relation = relative(root, target);
  if (relation.startsWith("..") || isAbsolute(relation)) {
    throw new Error("Requested path escapes the editor root");
  }
  return target;
}

export async function startLocalHost(
  options: LocalHostOptions,
): Promise<RunningLocalHost> {
  const root = resolve(options.editorRoot);
  if (!(await stat(root)).isDirectory())
    throw new Error("Editor root is not a directory");
  const hostname = options.hostname ?? "127.0.0.1";
  const server = createServer(async (request, response) => {
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' blob: data:; style-src 'self'; script-src 'self'; worker-src 'self'; connect-src 'self'",
    );
    response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    response.setHeader("X-Content-Type-Options", "nosniff");
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405).end("Method Not Allowed");
      return;
    }
    if (request.url === "/healthz") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"status":"ok","version":"0.2.0"}\n');
      return;
    }
    try {
      const pathname = decodeURIComponent(
        new URL(request.url ?? "/", "http://localhost").pathname,
      );
      const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
      let target = inside(root, relativePath);
      try {
        if (!(await stat(target)).isFile()) throw new Error("not a file");
      } catch {
        if (extname(relativePath)) throw new Error("Asset not found");
        target = inside(root, "index.html");
      }
      const bytes = await readFile(target);
      const requiresRevalidation =
        target.endsWith("index.html") ||
        target.endsWith("sw.js") ||
        target.endsWith("manifest.webmanifest");
      response.writeHead(200, {
        "content-type": TYPES[extname(target)] ?? "application/octet-stream",
        "cache-control": requiresRevalidation
          ? "no-cache"
          : "public, max-age=31536000, immutable",
      });
      response.end(request.method === "HEAD" ? undefined : bytes);
    } catch {
      response.writeHead(404).end("Not Found");
    }
  });
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, hostname, () => resolveListen());
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Local host has no TCP address");
  const bracketedHost = hostname === "::1" ? "[::1]" : hostname;
  return {
    origin: `http://${bracketedHost}:${address.port}`,
    server,
    close: () =>
      new Promise((resolveClose, reject) =>
        server.close((error) => (error ? reject(error) : resolveClose())),
      ),
  };
}
