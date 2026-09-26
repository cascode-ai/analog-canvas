import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** Separate composition entry/output: Web routes, telemetry and SW never boot. */
export default defineConfig({
  base: "/",
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
