import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const editorRequire = createRequire(
  new URL("../apps/editor/package.json", import.meta.url),
);
const runtimeRequire = createRequire(
  editorRequire.resolve("wrangler/package.json"),
);
const { Miniflare, convertV4MiniflareOptions } = runtimeRequire("miniflare");
const { build } = runtimeRequire("esbuild");

// Node SQLite accepts compound queries that the deployed SQL runtime rejects.
// Exercise the public seeding entrance with the actual deployed store classes.
it("initializes every publication stream in the Workers SQL runtime", async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const bundled = await build({
    absWorkingDir: root,
    stdin: {
      resolveDir: root,
      contents: `export { GalleryDO, ComponentLibraryDO } from './worker/index.ts';
        import { routeResourceSync } from './worker/resource-sync.ts';
        export default {fetch: (request, env) => routeResourceSync(request, env)};`,
    },
    bundle: true,
    format: "esm",
    platform: "browser",
    external: ["cloudflare:*"],
    write: false,
  });
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      compatibilityDate: "2026-08-11",
      bindings: {
        RESOURCE_REGION: "overseas",
        RESOURCE_WRITES_ENABLED: "true",
        RESOURCE_SYNC_TOKEN: "fixture-peer",
        RESOURCE_SYNC_ADMIN_TOKEN: "fixture-admin",
      },
      durableObjects: {
        GALLERY: { className: "GalleryDO", useSQLite: true },
        COMPONENT_LIBRARY: { className: "ComponentLibraryDO", useSQLite: true },
      },
      script: bundled.outputFiles[0].text,
    }),
  );
  try {
    for (const stream of [
      "gallery",
      "components",
      "analoggenie",
      "circuitthink",
      "amsnet",
      "analogretriever",
    ]) {
      const response = await mf.dispatchFetch(
        `https://test/api/resource-sync/${stream}/seed`,
        {
          method: "POST",
          headers: { authorization: "Bearer fixture-admin" },
          body: "{}",
        },
      );
      expect(response.status, stream).toBe(200);
      expect(await response.json()).toEqual({ seeded: 0, more: false });
    }
  } finally {
    await mf.dispose();
  }
}, 30000);
