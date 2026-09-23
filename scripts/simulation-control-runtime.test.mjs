import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const editorRequire = createRequire(
  new URL("../apps/editor/package.json", import.meta.url),
);
const wranglerRequire = createRequire(
  editorRequire.resolve("wrangler/package.json"),
);
const { Miniflare, convertV4MiniflareOptions } = wranglerRequire("miniflare");
const { build } = wranglerRequire("esbuild");

// The platform supplies (state, env), unlike the old SQLite fixture which
// accidentally supplied an undefined policy. Exercise that production boundary.
it("enforces admission defaults in the actual Workers Durable Object runtime", async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const bundled = await build({
    absWorkingDir: root,
    stdin: {
      resolveDir: root,
      contents: `import { SimulationControlDO } from './worker/simulation-control-do.ts';
        export { SimulationControlDO };
        export default {fetch(request, env) {return env.CONTROL.getByName("simulation").fetch(request);}};`,
    },
    alias: {
      "@icm/simulation-service": "./packages/simulation-service/src/index.ts",
    },
    bundle: true,
    format: "esm",
    platform: "browser",
    write: false,
  });
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      compatibilityDate: "2026-08-11",
      durableObjects: {
        CONTROL: { className: "SimulationControlDO", useSQLite: true },
      },
      script: bundled.outputFiles[0].text,
    }),
  );
  try {
    const admission = {
      ownerId: "owner",
      requestId: "a",
      requestFingerprint: "a".repeat(64),
      preparedId: "p",
      preparedDigest: "b".repeat(64),
      inputRevision: "r",
      environment: { profileId: "p" },
      timeoutMs: 60000,
    };
    const start = (requestId) =>
      mf.dispatchFetch("https://test/accept", {
        method: "POST",
        body: JSON.stringify({ ...admission, requestId }),
      });
    expect((await start("a")).status).toBe(201);
    const refused = await start("b");
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: "OWNER_QUEUE_LIMIT" });
    expect((await mf.dispatchFetch("https://test/operations")).status).toBe(
      200,
    );
  } finally {
    await mf.dispose();
  }
}, 30000);
