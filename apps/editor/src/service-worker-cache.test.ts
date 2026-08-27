import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The static shell worker is plain script, not a module, so it is evaluated
 * here against a stub scope and driven through its own fetch listener. What
 * it decides to keep matters more than most caching: asset names carry a
 * content hash, so anything stored under one is stored under a promise that
 * the name will never mean anything else.
 */
type Listener = (event: {
  request: Request;
  respondWith(value: Promise<Response>): void;
}) => void;

function loadWorker(fetchImpl: typeof fetch) {
  const listeners = new Map<string, Listener>();
  const stored = new Map<string, Response>();
  const cache = {
    match: (request: Request) =>
      Promise.resolve(stored.get(new URL(request.url).pathname)),
    put: (request: Request, response: Response) => {
      stored.set(new URL(request.url).pathname, response);
      return Promise.resolve();
    },
    addAll: () => Promise.resolve(),
  };
  const scope = {
    addEventListener: (name: string, listener: Listener) =>
      listeners.set(name, listener),
    registration: { scope: "https://analog-canvas.test/" },
  };
  const caches = {
    open: () => Promise.resolve(cache),
    keys: () => Promise.resolve([]),
    match: (request: Request) => cache.match(request),
    delete: () => Promise.resolve(true),
  };
  const source = readFileSync(
    resolve(process.cwd(), "apps/editor/public/sw.js"),
    "utf8",
  );
  new Function("self", "caches", "fetch", source)(scope, caches, fetchImpl);
  return { listeners, stored };
}

async function requestScript(
  response: Response,
): Promise<{ stored: Map<string, Response>; served: Response }> {
  const { listeners, stored } = loadWorker((() =>
    Promise.resolve(response)) as unknown as typeof fetch);
  const request = new Request("https://analog-canvas.test/assets/App-abc.js");
  Object.defineProperty(request, "destination", { value: "script" });
  let served: Promise<Response> | null = null;
  listeners.get("fetch")!({
    request,
    respondWith: (value) => {
      served = value;
    },
  });
  return { stored, served: await served! };
}

describe("static shell cache policy", () => {
  it("keeps a script that really is a script", async () => {
    const { stored } = await requestScript(
      new Response("export const a = 1;", {
        headers: { "content-type": "text/javascript" },
      }),
    );
    expect(stored.has("/assets/App-abc.js")).toBe(true);
  });

  it("refuses to keep the app shell under an asset name", async () => {
    // A single-page-application fallback answers a missing asset with the
    // shell at 200. Cached as a script, that name stays broken for as long as
    // the cache lives — long after the deploy that caused it.
    const { stored, served } = await requestScript(
      new Response("<!doctype html><html></html>", {
        headers: { "content-type": "text/html" },
      }),
    );
    expect(stored.has("/assets/App-abc.js")).toBe(false);
    // The response is still passed through; only storing it is refused.
    expect(await served.text()).toContain("doctype");
  });

  it("keeps nothing from a failed request", async () => {
    const { stored } = await requestScript(
      new Response("Not found: /assets/App-abc.js", {
        status: 404,
        headers: { "content-type": "text/plain" },
      }),
    );
    expect(stored.has("/assets/App-abc.js")).toBe(false);
  });

  it("leaves Gallery preview APIs to their HTTP cache policy", () => {
    const { listeners, stored } = loadWorker((() =>
      Promise.reject(
        new Error("the service worker must not fetch an API itself"),
      )) as typeof fetch);
    const request = new Request(
      "https://analog-canvas.test/api/gallery/entry-1/preview.svg?v=2",
    );
    Object.defineProperty(request, "destination", { value: "image" });
    let responded = false;
    listeners.get("fetch")!({
      request,
      respondWith: () => {
        responded = true;
      },
    });
    expect(responded).toBe(false);
    expect(stored.size).toBe(0);
  });

  it("does not store an explicitly no-store static response", async () => {
    const { stored } = await requestScript(
      new Response("export const dynamic = true;", {
        headers: {
          "content-type": "text/javascript",
          "cache-control": "no-store",
        },
      }),
    );
    expect(stored.has("/assets/App-abc.js")).toBe(false);
  });
});
