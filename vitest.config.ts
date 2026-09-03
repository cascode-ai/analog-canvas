import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // The Workers runtime module behind @cloudflare/containers; see
      // worker/test-support/cloudflare-workers-stub.ts for why a stub is enough.
      "cloudflare:workers": fileURLToPath(
        new URL(
          "./worker/test-support/cloudflare-workers-stub.ts",
          import.meta.url,
        ),
      ),
    },
  },
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
