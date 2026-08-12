import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      enabled: false,
    },
    include: [
      "apps/**/*.test.{ts,tsx}",
      "worker/**/*.test.ts",
      "packages/**/*.test.{ts,tsx}",
      "scripts/**/*.test.mjs",
      "skills/circuit-layout/scripts/**/*.test.{ts,mjs}",
    ],
  },
});
