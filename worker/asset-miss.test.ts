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
  it.each(["/editor", "/g/abc123", "/"])(
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

describe("pre-compressed hashed assets", () => {
  // The candidate writes `<file>.br` beside a compressible asset; the asset
  // layer serves that file like any other and answers a miss with the shell.
  const files: Record<string, { body: string; type: string }> = {
    "/assets/App-abcdefgh.js": {
      body: "identity",
      type: "text/javascript; charset=utf-8",
    },
    "/assets/App-abcdefgh.js.br": {
      body: "brotli",
      type: "application/octet-stream",
    },
    "/assets/Lazy-abcdefgh.js": {
      body: "identity",
      type: "text/javascript; charset=utf-8",
    },
  };
  const requested: string[] = [];
  const env = {
    ASSETS: {
      fetch: async (request: Request) => {
        const path = new URL(request.url).pathname;
        requested.push(`${request.method} ${path}`);
        const file = files[path];
        const etag = `"${path}"`;
        const headers = { "content-type": file?.type ?? "text/html", etag };
        if (file && request.headers.get("if-none-match") === etag)
          return new Response(null, { status: 304, headers });
        return new Response(
          request.method === "HEAD" ? null : (file?.body ?? SHELL),
          { headers },
        );
      },
    },
  } as unknown as Parameters<typeof workerEntry.fetch>[1];
  const fetchAsset = (path: string, headers: Record<string, string> = {}) =>
    workerEntry.fetch(
      new Request(`https://example.test${path}`, { headers }),
      env,
    );

  it("serves the brotli sibling with the original's type and policy", async () => {
    const response = await fetchAsset("/assets/App-abcdefgh.js", {
      "accept-encoding": "gzip, deflate, br, zstd",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-encoding")).toBe("br");
    expect(response.headers.get("content-type")).toBe("text/javascript");
    expect(response.headers.get("vary")).toBe("Accept-Encoding");
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(response.headers.get("etag")).toBe('"/assets/App-abcdefgh.js.br"');
    expect(await response.text()).toBe("brotli");
  });

  it("answers HEAD and a matching validator from the sibling", async () => {
    const head = await workerEntry.fetch(
      new Request("https://example.test/assets/App-abcdefgh.js", {
        method: "HEAD",
        headers: { "accept-encoding": "br" },
      }),
      env,
    );
    expect(head.headers.get("content-encoding")).toBe("br");
    expect(await head.text()).toBe("");
    const revalidated = await fetchAsset("/assets/App-abcdefgh.js", {
      "accept-encoding": "br",
      "if-none-match": '"/assets/App-abcdefgh.js.br"',
    });
    expect(revalidated.status).toBe(304);
    expect(revalidated.headers.get("content-encoding")).toBe("br");
  });

  it.each([
    ["no brotli", { "accept-encoding": "gzip, deflate" }],
    ["brotli refused", { "accept-encoding": "gzip, br;q=0" }],
    ["a range", { "accept-encoding": "br", range: "bytes=0-3" }],
  ])("serves the original for %s", async (_case, headers) => {
    requested.length = 0;
    const response = await fetchAsset("/assets/App-abcdefgh.js", headers);
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(response.headers.get("content-type")).toContain("javascript");
    expect(response.headers.get("vary")).toBe("Accept-Encoding");
    expect(await response.text()).toBe("identity");
    expect(requested).toEqual(["GET /assets/App-abcdefgh.js"]);
  });

  it("serves the original when the sibling is missing", async () => {
    const response = await fetchAsset("/assets/Lazy-abcdefgh.js", {
      "accept-encoding": "br",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(await response.text()).toBe("identity");
  });

  it("still answers a retired name with 404", async () => {
    const response = await fetchAsset("/assets/App-retired1.js", {
      "accept-encoding": "br",
    });
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-encoding")).toBeNull();
  });

  it("never looks for a sibling of the shell", async () => {
    requested.length = 0;
    const response = await fetchAsset("/editor", { "accept-encoding": "br" });
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(requested).toEqual(["GET /editor"]);
  });
});
