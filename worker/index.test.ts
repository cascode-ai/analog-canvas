import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("assets binding wiring", () => {
  /** wrangler.jsonc allows comments and trailing commas; JSON does not. */
  function wranglerConfig(file = "wrangler.jsonc"): {
    assets: {
      binding?: string;
      run_worker_first?: string[];
      not_found_handling?: string;
    };
    triggers?: { crons?: string[] };
  } {
    const source = readFileSync(resolve(process.cwd(), file), "utf8");
    const stripped = source
      .replace(/^\s*\/\/.*$/gmu, "")
      .replace(/,(\s*[}\]])/gu, "$1");
    return JSON.parse(stripped) as ReturnType<typeof wranglerConfig>;
  }

  it("schedules the netlist mark pass on Production", () => {
    // Stored Gallery marks answer the rule that produced them. Without a
    // tick, a deployed rule change would leave every one of them stale
    // until somebody remembered to press a button. The retired Preview Worker
    // deliberately has no cron; its no-trigger contract lives beside its
    // dormant Wrangler configuration.
    expect(wranglerConfig().triggers?.crons ?? []).not.toHaveLength(0);
  });

  it("routes asset requests through the Worker, with a binding to fetch", () => {
    // This test previously pinned the opposite, on the belief that listing
    // "/assets/*" in run_worker_first made env.ASSETS.fetch re-enter the
    // Worker and produce 1101. That belief was wrong, and it was expensive:
    // it left the shell-for-a-missing-chunk bug unfixable in principle.
    //
    // Measured against workerd locally: with the binding declared, a Worker
    // that runs first for /assets/* and calls env.ASSETS.fetch gets the
    // asset back for a hit and the SPA shell for a miss. No re-entry, no
    // 1101. The 1101 came from the binding being ABSENT, so env.ASSETS was
    // undefined and the first request to reach that line threw — which the
    // same local harness reproduced exactly, by omitting the binding.
    const { assets } = wranglerConfig();
    expect(assets.binding).toBe("ASSETS");
    expect(assets.run_worker_first).toContain("/assets/*");
    expect(assets.run_worker_first).toContain("/api/*");
    // Client routes still get the shell from Cloudflare; the Worker only
    // separates "a hashed file that is gone" from "a route with no file".
    expect(assets.not_found_handling).toBe("single-page-application");
  });
});
