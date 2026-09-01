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
    // Cloudflare owns client-route fallback in front of the Worker. Missing
    // chunks also receive the shell, which the client stale-build recovery
    // recognizes; routing /assets/* through the Worker causes 1101 re-entry.
    expect(assets.not_found_handling).toBe("single-page-application");
  });
});
