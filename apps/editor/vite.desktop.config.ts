import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** Separate composition entry/output: Web routes, telemetry and SW never boot. */
export default defineConfig({
  base: "/",
  // Offline artifacts never inherit local .env files or public-prefixed values.
  // Hosted feature flags and credentials belong to the Web/server composition.
  envDir: false,
  envPrefix: [],
  plugins: [
    react(),
    {
      name: "desktop-preview-entry",
      transformIndexHtml: {
        order: "pre",
        handler: (html) =>
          html
            .replace("/src/main.tsx", "/src/entries/desktop.tsx")
            .replace(/\s*<link rel="manifest"[^>]*>/u, ""),
      },
    },
  ],
  build: { outDir: "dist-desktop" },
});
