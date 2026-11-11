import { globSync, readFileSync } from "node:fs";
import { configDefaults, defineConfig } from "vitest/config";

// Tests that need the shared package build: which ones belong here is the
// rule in docs/testing/README.md#pull-request-checks.
const standaloneTests = [
  "containers/ngspice/entrypoint.test.mjs",
  "scripts/analyze-native-simulation-examples.test.mjs",
  "scripts/build-native-simulation-examples.test.mjs",
  "scripts/native-example-runner.test.mjs",
  "scripts/package-vacask-harness.test.mjs",
  "scripts/package-vacask-image.test.mjs",
  "scripts/resource-seed-runtime.test.mjs",
  "scripts/simulation-control-runtime.test.mjs",
  "scripts/vacask-model-symbols.test.mjs",
];

const moduleTests = [
  "apps/**/*.test.{ts,tsx}",
  "containers/**/*.test.mjs",
  "worker/**/*.test.ts",
  "packages/**/*.test.{ts,tsx}",
  "scripts/**/*.test.mjs",
];

// Logic test files share one module registry per worker, so the symbol
// catalog, device registry and schemas load once rather than once per file:
// that cut a full run from about 2.5 minutes to well under one on
// 2026-10-03, and startup alone had timed tests out on a loaded machine.
// React component tests (.test.tsx), which keep module-level UI state, and
// any file that swaps modules or its environment keep a registry of their
// own, found here by what they are and call, so none is shared by mistake.
const ownsRegistry =
  /\bvi\.(?:mock|doMock|unmock|resetModules|importActual)\(|@vitest-environment/u;
const isolatedTests = moduleTests
  .flatMap((pattern) =>
    globSync(pattern, {
      exclude: (path: string) => /(?:^|\/)(?:node_modules|dist)$/u.test(path),
    }),
  )
  // Vitest glob patterns use forward slashes on Windows as well.
  .map((file) => file.replaceAll("\\", "/"))
  .filter(
    (file) =>
      !standaloneTests.includes(file) &&
      (file.endsWith(".tsx") || ownsRegistry.test(readFileSync(file, "utf8"))),
  );

export default defineConfig({
  test: {
    coverage: {
      enabled: false,
    },
    projects: [
      {
        test: {
          name: "modules",
          include: moduleTests,
          exclude: [
            ...configDefaults.exclude,
            ...standaloneTests,
            ...isolatedTests,
          ],
          isolate: false,
        },
      },
      {
        test: {
          name: "isolated",
          include: isolatedTests,
          exclude: [...configDefaults.exclude],
        },
      },
      {
        test: {
          name: "standalone",
          include: standaloneTests,
          globalSetup: ["./scripts/test-standalone-setup.mjs"],
        },
      },
    ],
  },
});
