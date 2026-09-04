import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      enabled: false,
    },
    include: [
      "apps/**/*.test.{ts,tsx}",
      // The simulation container's harness: plain Node, no bundler, and its
      // own tests beside it for the same reason scripts/ has them.
      "containers/**/*.test.mjs",
      "worker/**/*.test.ts",
      "packages/**/*.test.{ts,tsx}",
      "scripts/**/*.test.mjs",
      "skills/circuit-layout/scripts/**/*.test.{ts,mjs}",
    ],
  },
});
