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
  /**
   * The assets binding is configured with single-page-application not-found
   * handling, so anything it cannot match comes back as the shell.
   */
  function envServing(files: Record<string, string>) {
    return {
      ASSETS: {
        fetch(request: Request) {
          const path = new URL(request.url).pathname;
          const body = files[path];
          return Promise.resolve(
            body === undefined
              ? new Response("<!doctype html><html></html>", {
                  headers: { "content-type": "text/html" },
                })
              : new Response(body, {
                  headers: { "content-type": "text/javascript" },
                }),
          );
        },
      },
    } as unknown as Parameters<typeof worker.fetch>[1];
  }

  const call = (env: unknown, path: string) =>
    worker.fetch(
      new Request(`https://analog-canvas.test${path}`),
      env as Parameters<typeof worker.fetch>[1],
    );

  it("serves an asset that exists", async () => {
    const env = envServing({ "/assets/App-abc.js": "export const a = 1;" });
    const response = await call(env, "/assets/App-abc.js");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("export const a");
  });

  it("404s a hashed asset the build no longer has", async () => {
    // A page open across a deploy asks for names this build does not carry.
    // Answering with the shell hands the browser a document where it asked
    // for a module, and every cache in the path is invited to keep it under
    // a name that promised to be immutable.
    const env = envServing({});
    const response = await call(env, "/assets/App-gone.js");
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("still renders the shell for a route with no file behind it", async () => {
    const env = envServing({});
    for (const path of ["/g/2cdq4dmhy9", "/editor", "/mine"]) {
      const response = await call(env, path);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
    }
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
    expect(assets.not_found_handling).toBe("single-page-application");
  });
});
