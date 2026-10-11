import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { isOnlineImplementation } from "./build/desktop-module-policy";

/** Separate composition entry/output: Web routes, telemetry and SW never boot. */
export default defineConfig({
  base: "/",
  // Offline artifacts never inherit local .env files or public-prefixed values.
  // Hosted feature flags and credentials belong to the Web/server composition.
  envDir: false,
  envPrefix: [],
  define: { "import.meta.env.ICM_DESKTOP": "true" },
  plugins: [
    react(),
    {
      name: "desktop-module-evidence",
      // Online leaf modules have no required offline initialization. Removing
      // their unused imports must not keep a lazy online UI alive as a side effect.
      transform(code, id) {
        if (isOnlineImplementation(id))
          return { code, moduleSideEffects: false };
      },
      generateBundle(_options, bundle) {
        const modules = new Set<string>();
        for (const item of Object.values(bundle)) {
          if (item.type === "chunk")
            for (const [id, module] of Object.entries(item.modules)) {
              if (module.renderedLength)
                modules.add(
                  id
                    .replaceAll("\\", "/")
                    .replace(
                      resolve(import.meta.dirname, "../..").replaceAll(
                        "\\",
                        "/",
                      ) + "/",
                      "",
                    ),
                );
              if (module.renderedLength && isOnlineImplementation(id))
                this.error(`Online implementation in desktop output: ${id}`);
            }
        }
        this.emitFile({
          type: "asset",
          fileName: "desktop-modules.json",
          source: JSON.stringify([...modules].sort(), null, 2),
        });
      },
    },
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
