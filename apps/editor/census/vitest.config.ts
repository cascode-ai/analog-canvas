import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The Gallery census reads user drawings from a local private snapshot. Only
// `pnpm gallery:census` (scripts/gallery-census.mjs) runs it; the ordinary
// suite and CI never include `*.census.ts`.
export default defineConfig({
  root: fileURLToPath(new URL("../../..", import.meta.url)),
  test: {
    coverage: { enabled: false },
    include: ["apps/editor/census/**/*.census.ts"],
    reporters: ["dot"],
  },
});
