import { defineConfig, devices } from "@playwright/test";

// Keep Playwright's readiness probe on loopback even when the development
// machine exports a system HTTP proxy.
process.env.NO_PROXY = [process.env.NO_PROXY, "127.0.0.1", "localhost"]
  .filter(Boolean)
  .join(",");

const e2ePort = Number(process.env.ICM_E2E_PORT ?? "4173");
const e2eBaseUrl = `http://127.0.0.1:${e2ePort}`;
const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
// A running editor to test instead of starting one: a live check of the
// deployed site (editor-only cases: anything a case does reaches that
// server), or one server shared by several runs.
const externalBaseUrl = process.env.ICM_E2E_BASE_URL?.replace(/\/+$/u, "");
// The server serves the editor built for tests (scripts/build-e2e-editor.mjs,
// about a second, rebuilt at every start): a page loads a few chunks instead
// of hundreds of modules the dev server compiles on first request. Measured
// 2026-10-01 with 4 workers: about 20% less time per spec file, and no more
// cold first loads timing out. ICM_E2E_SERVER=dev serves the source instead.
const serveSource = process.env.ICM_E2E_SERVER === "dev";
const editorServer = serveSource
  ? `pnpm --filter @icm/editor exec vite --host 127.0.0.1 --port ${e2ePort}`
  : "node scripts/build-e2e-editor.mjs && " +
    `pnpm --filter @icm/editor exec vite preview --outDir dist-e2e --host 127.0.0.1 --port ${e2ePort} --strictPort`;

export default defineConfig({
  testDir: "apps/editor/e2e",
  // Each scenario owns an isolated browser context. Test-level parallelism
  // lets CI shards balance cases instead of assigning the entire suite to one
  // shard based on the three large spec files.
  fullyParallel: true,
  // The per-test budget catches a hung test, not a slow machine. The longest
  // editor flows take 10-14 s alone and two to three times that while other
  // workers load the same machine, which failed them at the old 30 s default.
  // Speed itself is measured by performance.spec.ts.
  timeout: 60_000,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // Locally, also keep each case's duration, so a slow case is found by
  // reading test-results/e2e-report.json (`pnpm e2e:slowest`), not by guessing.
  reporter: process.env.CI
    ? "line"
    : [["line"], ["json", { outputFile: "test-results/e2e-report.json" }]],
  use: {
    baseURL: externalBaseUrl ?? e2eBaseUrl,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
    ...(chromiumExecutablePath
      ? { launchOptions: { executablePath: chromiumExecutablePath } }
      : process.env.CI
        ? {}
        : { channel: "chrome" }),
  },
  ...(externalBaseUrl
    ? {}
    : {
        webServer: {
          command: editorServer,
          url: e2eBaseUrl,
          reuseExistingServer:
            !process.env.CI && process.env.ICM_E2E_ISOLATED !== "1",
          // The test build runs first: about a second here, longer on a
          // cold CI runner.
          timeout: 120_000,
        },
      }),
});
