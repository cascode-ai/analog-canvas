import { describe, expect, it } from "vitest";

import workerEntry from "./index";

/**
 * The request path a browser actually takes for a chunk name that no longer
 * exists.
 *
 * Why this file is separate and phrased this way: the change that caused the
 * 2026-09-01 outage passed every check while the deployed Worker threw
 * Cloudflare 1101 on the same paths. Its tests never exercised the code that
 * ran. So these drive the exported fetch handler itself, with an ASSETS stub
 * that behaves the way the platform was MEASURED to behave against workerd:
 * a miss under `not_found_handling: single-page-application` comes back as
 * the shell at status 200, not as a 404.
 *
 * The stub is written from that measurement rather than from the docs, and
 * the live curl after deploying is still the evidence that settles it.
 */
const SHELL = "<!doctype html><title>Analog Canvas</title>";

function envWithAssets(files: Record<string, string>) {
  return {
    ASSETS: {
      fetch: async (request: Request) => {
        const path = new URL(request.url).pathname;
        const body = files[path];
        if (body !== undefined) {
          return new Response(body, {
            headers: {
              "content-type": path.endsWith(".js")
                ? "text/javascript; charset=utf-8"
                : "text/html; charset=utf-8",
            },
          });
        }
        // Measured platform behaviour: every miss is the shell, at 200.
        return new Response(SHELL, {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      },
    },
  } as unknown as Parameters<typeof workerEntry.fetch>[1];
}

const env = envWithAssets({
  "/index.html": SHELL,
  "/assets/App-real123.js": "export const ok = true;",
});

const get = (path: string) =>
  workerEntry.fetch(new Request(`https://example.test${path}`), env);

describe("a chunk name that no longer exists", () => {
  it("answers 404, not the shell dressed as a script", async () => {
    // The user-visible bug: the browser asked for JavaScript, was handed
    // HTML, and was told it succeeded — which it reports as "Failed to fetch
    // dynamically imported module".
    const response = await get("/assets/App-nonexistent.js");
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(await response.text()).not.toContain("doctype");
  });

  it("does not cache the refusal", async () => {
    // The next deploy may legitimately publish that name again.
    const response = await get("/assets/App-nonexistent.js");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("still serves an asset that exists", async () => {
    const response = await get("/assets/App-real123.js");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("javascript");
  });
});

describe("client routes keep the shell", () => {
  // The other half of the boundary, and the half the earlier attempt broke:
  // these paths never had a file behind them, so their miss IS the shell.
  it.each(["/editor", "/analytics", "/g/abc123", "/"])(
    "%s renders the shell",
    async (path) => {
      const response = await get(path);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
      expect(await response.text()).toContain("doctype");
    },
  );
});

describe("hashed asset HTTP caching", () => {
  it.each(["App-abcdefgh.js", "App-ab12_CD-.css", "font-abcdefgh.woff2"])(
    "makes %s immutable while preserving its content and validators",
    async (file) => {
      const env = {
        ASSETS: {
          fetch: async () =>
            new Response("asset", {
              headers: {
                "content-type": "application/octet-stream",
                etag: '"hash"',
                "cache-control": "public, max-age=0, must-revalidate",
              },
            }),
        },
      } as unknown as Parameters<typeof workerEntry.fetch>[1];
      const response = await workerEntry.fetch(
        new Request(`https://example.test/assets/${file}`),
        env,
      );
      expect(response.headers.get("cache-control")).toBe(
        "public, max-age=31536000, immutable",
      );
      expect(response.headers.get("etag")).toBe('"hash"');
      expect(await response.text()).toBe("asset");
    },
  );
  it.each([
    ["/assets/plain.js", 200, "max-age=0"],
    ["/assets/App-abcdefgh.js", 404, "no-store"],
    ["/assets/App-abcdefgh.js", 500, "no-store"],
    ["/assets/App-abcdefgh.js", 200, "private, max-age=0"],
    ["/assets/App-abcdefgh.js", 200, "no-store"],
  ])("preserves policy for %s / %s / %s", async (path, status, policy) => {
    const env = {
      ASSETS: {
        fetch: async () =>
          new Response("body", {
            status,
            headers: {
              "content-type": "text/javascript",
              "cache-control": policy,
            },
          }),
      },
    } as unknown as Parameters<typeof workerEntry.fetch>[1];
    const response = await workerEntry.fetch(
      new Request(`https://example.test${path}`),
      env,
    );
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe(policy);
  });
});
