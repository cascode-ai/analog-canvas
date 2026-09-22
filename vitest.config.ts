import { configDefaults, defineConfig } from "vitest/config";

// These contracts launch plain Node CLIs or import their built entrypoints.
// Keep their build preparation out of ordinary focused source-module tests.
const standaloneTests = [
  "scripts/analyze-native-simulation-examples.test.mjs",
  "scripts/build-native-simulation-examples.test.mjs",
  "scripts/native-example-runner.test.mjs",
  "scripts/package-vacask-harness.test.mjs",
];

export default defineConfig({
  test: {
    coverage: {
      enabled: false,
    },
    projects: [
      {
        test: {
          name: "modules",
          include: [
            "apps/**/*.test.{ts,tsx}",
            "containers/**/*.test.mjs",
            "worker/**/*.test.ts",
            "packages/**/*.test.{ts,tsx}",
            "scripts/**/*.test.mjs",
          ],
          exclude: [...configDefaults.exclude, ...standaloneTests],
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
