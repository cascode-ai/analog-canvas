import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";

import {
  isSimulationInputRevision,
  type ModelLibrarySelection,
} from "@icm/spice-run";

import { simulateLocally } from "./simulate.js";

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
  /** The simulator to run; the user's own install by default. */
  ngspicePath?: string;
  /** Explicit model-library directive, path, and optional section. */
  modelLibrary?: ModelLibrarySelection | null;
}

/** A deck larger than this is a mistake upstream, not a simulation. */
const MAX_SIMULATION_REQUEST_BYTES = 4 * 1024 * 1024;

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
    const isSimulate =
      request.url === "/api/simulate" && request.method === "POST";
    if (!isSimulate && request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405).end("Method Not Allowed");
      return;
    }
    if (isSimulate) {
      await handleSimulate(request, response, options);
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

/**
 * The local simulation endpoint. Same request and same result shape as the
 * hosted route, so the editor reaches one interface and only the location of
 * ngspice differs.
 *
 * The host binds to loopback and the page it serves is same-origin, so no CORS
 * headers are offered: a browser page from anywhere else cannot reach this,
 * which is the point of a surface whose reason for existing is that the
 * circuit stays on the machine.
 */
async function handleSimulate(
  request: IncomingMessage,
  response: ServerResponse,
  options: LocalHostOptions,
): Promise<void> {
  const send = (status: number, payload: unknown): void => {
    const body = JSON.stringify(payload);
    response.writeHead(status, {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body),
    });
    response.end(body);
  };

  const chunks: Buffer[] = [];
  let size = 0;
  let refused = false;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_SIMULATION_REQUEST_BYTES) {
      refused = true;
      break;
    }
    chunks.push(chunk as Buffer);
  }
  if (refused) {
    send(413, { error: "request-too-large" });
    return;
  }

  let body: {
    netlist?: unknown;
    testbench?: unknown;
    timeoutMs?: unknown;
    inputRevision?: unknown;
  };
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as typeof body;
  } catch {
    send(400, { error: "invalid-json" });
    return;
  }
  const netlist = typeof body.netlist === "string" ? body.netlist : null;
  const testbench = typeof body.testbench === "string" ? body.testbench : null;
  if (
    !netlist ||
    !testbench ||
    !isSimulationInputRevision(body.inputRevision)
  ) {
    send(400, {
      error: "invalid-request",
      message:
        "A simulation needs a circuit netlist and the testbench you wrote for it.",
    });
    return;
  }
  const inputRevision = body.inputRevision;

  const outcome = await simulateLocally(
    {
      netlist,
      testbench,
      ...(typeof body.timeoutMs === "number"
        ? { timeoutMs: body.timeoutMs }
        : {}),
      ...(inputRevision ? { inputRevision } : {}),
    },
    {
      ...(options.ngspicePath ? { ngspicePath: options.ngspicePath } : {}),
      modelLibrary: options.modelLibrary ?? null,
    },
  );
  if (outcome.kind === "simulator-unavailable") {
    // 501: this installation cannot simulate. Not a statement about the
    // circuit, and phrased so the reader knows which of the two it is.
    send(501, { error: "simulator-unavailable", message: outcome.message });
    return;
  }
  send(200, outcome.result);
}
