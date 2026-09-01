import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import worker, {
  normalizeAcquisitionSource,
  normalizeTrackedPath,
} from "./index";

describe("analytics request normalization", () => {
  it("keeps bounded page paths and excludes analytics/API routes", () => {
    expect(normalizeTrackedPath("/editor?utm_source=github#canvas")).toBe(
      "/editor",
    );
    expect(normalizeTrackedPath("/analytics")).toBeNull();
    expect(normalizeTrackedPath("/api/stats")).toBeNull();
    expect(normalizeTrackedPath("https://example.com/")).toBeNull();
  });

  it("retains only normalized acquisition categories or hostnames", () => {
    const site = new URL("https://analog-canvas.tokenzhang.com/");
    expect(
      normalizeAcquisitionSource(
        "https://www.google.com/search?q=private",
        "",
        site,
      ),
    ).toBe("search:google");
    expect(
      normalizeAcquisitionSource(
        "https://github.com/some/private/path",
        "",
        site,
      ),
    ).toBe("social:github");
    expect(
      normalizeAcquisitionSource(
        "https://example.com/private/path?q=secret",
        "",
        site,
      ),
    ).toBe("ref:example.com");
    expect(normalizeAcquisitionSource("", "qrcode", site)).toBe("campaign:qr");
  });
});

describe("static asset serving", () => {
  function envServing(files: Record<string, string>) {
    const requestedPaths: string[] = [];
    const env = {
      ASSETS: {
        fetch(request: Request) {
          const path = new URL(request.url).pathname;
          requestedPaths.push(path);
          const body = files[path];
          return Promise.resolve(
            body === undefined
              ? new Response("Not found", { status: 404 })
              : new Response(body, {
                  headers: {
                    "content-type": path.endsWith(".html")
                      ? "text/html"
                      : "text/javascript",
                  },
                }),
          );
        },
      },
    } as unknown as Parameters<typeof worker.fetch>[1];
    return { env, requestedPaths };
  }

  const call = (env: unknown, path: string) =>
    worker.fetch(
      new Request(`https://analog-canvas.test${path}`),
      env as Parameters<typeof worker.fetch>[1],
    );

  it("404s a hashed asset the build no longer has", async () => {
    // A page open across a deploy asks for names this build does not carry.
    // Answering with the shell hands the browser a document where it asked
    // for a module, and every cache in the path is invited to keep it under
    // a name that promised to be immutable.
    const { env, requestedPaths } = envServing({
      "/index.html": "<!doctype html><html></html>",
    });
    const response = await call(env, "/assets/App-gone.js");
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(response.headers.get("cache-control")).toBe("no-store");
    // Do not ask the SPA-configured binding for a missing module: its fallback
    // is the document shell, not JavaScript.
    expect(requestedPaths).toEqual([]);
  });

  it("still renders the shell for a route with no file behind it", async () => {
    const { env, requestedPaths } = envServing({
      "/index.html": "<!doctype html><html></html>",
    });
    for (const path of ["/g/2cdq4dmhy9", "/editor", "/analytics", "/mine"]) {
      const response = await call(env, path);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
    }
    expect(requestedPaths).toEqual([
      "/index.html",
      "/index.html",
      "/index.html",
      "/index.html",
    ]);
  });
});

describe("assets binding wiring", () => {
  /** wrangler.jsonc allows comments and trailing commas; JSON does not. */
  function wranglerConfig(): {
    assets: { run_worker_first?: string[]; not_found_handling?: string };
  } {
    const source = readFileSync(
      resolve(process.cwd(), "wrangler.jsonc"),
      "utf8",
    );
    const stripped = source
      .replace(/^\s*\/\/.*$/gmu, "")
      .replace(/,(\s*[}\]])/gu, "$1");
    return JSON.parse(stripped) as ReturnType<typeof wranglerConfig>;
  }

  it("keeps the Worker out of the asset path", () => {
    // Listing "/assets/*" in run_worker_first made env.ASSETS.fetch re-enter
    // the Worker and every asset request returned 1101. Assets are served
    // directly; the missing-asset 404 has to be built some other way.
    const { assets } = wranglerConfig();
    expect(assets.run_worker_first).not.toContain("/assets/*");
    expect(assets.run_worker_first).toContain("/api/*");
    // Cloudflare uses the SPA fallback for browser navigations, but still
    // invokes the Worker for non-navigation misses such as module fetches.
    expect(assets.not_found_handling).toBe("single-page-application");
  });
});
