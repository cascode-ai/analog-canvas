import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { verifyPreviewCandidate } from "./lib/preview-candidate.mjs";
vi.mock("node:fs/promises", () => ({
  readdir: vi.fn(async () =>
    ["index-test.js", "simulation-lazy.js"].map((name) => ({
      name,
      isDirectory: () => false,
      isFile: () => true,
    })),
  ),
  readFile: vi.fn(async (url) =>
    url.pathname.endsWith("index.html")
      ? '<script src="/assets/index-test.js"></script>'
      : Buffer.from("candidate-entry"),
  ),
}));
vi.mock("node:child_process", () => ({ execFileSync: () => "a".repeat(40) }));
beforeEach(() => vi.stubEnv("GITHUB_SHA", "a".repeat(40)));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it("matches the served asset graph and bytes, not just HTTP 200", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (url) =>
        new Response(
          url.pathname === "/editor"
            ? '<script src="/assets/index-test.js"></script>'
            : "candidate-entry",
        ),
    ),
  );
  const evidence = await verifyPreviewCandidate("https://preview.example");
  expect(evidence.entry).toBe("/assets/index-test.js");
  expect(evidence.entrySha256).toMatch(/^[a-f0-9]{64}$/u);
  expect(evidence.assets.map((a) => a.path)).toEqual([
    "/assets/index-test.js",
    "/assets/simulation-lazy.js",
  ]);
});
it("rejects a stale lazy simulation chunk even when the entry still matches", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (url) =>
        new Response(
          url.pathname === "/editor"
            ? '<script src="/assets/index-test.js"></script>'
            : url.pathname.endsWith("simulation-lazy.js")
              ? "old simulation implementation"
              : "candidate-entry",
        ),
    ),
  );
  await expect(
    verifyPreviewCandidate("https://preview.example"),
  ).rejects.toThrow(/Served asset bytes differ.*simulation-lazy/u);
});
it("refuses a live shell from a different candidate", async () => {
  vi.stubGlobal(
    "fetch",
    async () => new Response('<script src="/assets/index-old.js"></script>'),
  );
  await expect(
    verifyPreviewCandidate("https://preview.example"),
  ).rejects.toThrow(/not serving this candidate/u);
});
it("refuses mismatched served bytes under the same asset name", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (url) =>
        new Response(
          url.pathname === "/editor"
            ? '<script src="/assets/index-test.js"></script>'
            : "changed-entry",
        ),
    ),
  );
  await expect(
    verifyPreviewCandidate("https://preview.example"),
  ).rejects.toThrow(/Served entry bytes differ/u);
});
