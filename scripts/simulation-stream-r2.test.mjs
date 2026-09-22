import { createRequire } from "node:module";
import { it, expect } from "vitest";
import { boundExecutionStream } from "../packages/simulation-service/src/execution-receipt.ts";

// Exercise the actual Workers R2 binding, not a Node stream/storage mock.
// Use the runtime already pinned by the editor's Wrangler dependency.
const editorRequire = createRequire(
  new URL("../apps/editor/package.json", import.meta.url),
);
const { Miniflare, convertV4MiniflareOptions } = createRequire(
  editorRequire.resolve("wrangler/package.json"),
)("miniflare");

it("stores receipt-bound large bodies in R2 and rejects length/digest mismatches", async () => {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      compatibilityDate: "2026-08-11",
      r2Buckets: ["RESULTS"],
      script: `
        const boundExecutionStream = ${boundExecutionStream.toString()};
        export default { async fetch(request, env) {
          const mode = new URL(request.url).pathname;
          const bytes = new Uint8Array(5 * 1024 * 1024 + 1).fill(97);
          bytes[bytes.length - 1] = 122;
          const digest = await crypto.subtle.digest('SHA-256', bytes);
          const length = bytes.length + (mode === '/short' ? 1 : mode === '/long' ? -1 : 0);
          const body = boundExecutionStream(new Response(bytes).body, length);
          try {
            await env.RESULTS.put(mode, body, {
              sha256: mode === '/digest' ? new Uint8Array(32) : digest,
            });
            const stored = new Uint8Array(await (await env.RESULTS.get(mode)).arrayBuffer());
            return Response.json({ length: stored.length, first: stored[0], last: stored.at(-1) });
          } catch (error) {
            return Response.json({ error: String(error), stored: !!await env.RESULTS.head(mode) }, { status: 422 });
          }
        }};
      `,
    }),
  );
  try {
    const good = await mf.dispatchFetch("http://test/complete");
    expect(good.status).toBe(200);
    expect(await good.json()).toEqual({
      length: 5 * 1024 * 1024 + 1,
      first: 97,
      last: 122,
    });
    for (const mode of ["short", "long", "digest"]) {
      const response = await mf.dispatchFetch(`http://test/${mode}`);
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ stored: false });
    }
  } finally {
    await mf.dispose();
  }
}, 30000);
