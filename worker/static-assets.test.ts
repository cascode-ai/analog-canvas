import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { createRequire, stripTypeScriptTypes } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  brotliCompressSync,
  brotliDecompressSync,
  gunzipSync,
} from "node:zlib";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * serveAsset in workerd, behind the real asset layer, read as raw bytes off
 * the wire. Node's Response ignores `encodeBody`, so only this shows that a
 * sibling leaves the runtime exactly as stored. Miniflare stands in for
 * Cloudflare's front line: it compresses a plain compressible answer for the
 * request's Accept-Encoding, and `cf.clientAcceptEncoding` carries the
 * client's own value.
 */
const editorRequire = createRequire(
  new URL("../apps/editor/package.json", import.meta.url),
);
const { Miniflare, convertV4MiniflareOptions } = createRequire(
  editorRequire.resolve("wrangler/package.json"),
)("miniflare") as {
  Miniflare: new (options: unknown) => {
    ready: Promise<URL>;
    dispose(): Promise<void>;
  };
  convertV4MiniflareOptions(options: unknown): unknown;
};

const SCRIPT = "export const ready = true;\n".repeat(200);
const LAZY = "export const lazy = true;\n".repeat(200);
const SIBLING = brotliCompressSync(SCRIPT);

let mf: InstanceType<typeof Miniflare>;
let origin: URL;

beforeAll(async () => {
  const root = await mkdtemp(join(tmpdir(), "analog-canvas-static-assets-"));
  await mkdir(join(root, "assets"));
  await writeFile(join(root, "index.html"), "<!doctype html><title>Shell");
  await writeFile(join(root, "assets", "App-abcdefgh.js"), SCRIPT);
  await writeFile(join(root, "assets", "App-abcdefgh.js.br"), SIBLING);
  await writeFile(join(root, "assets", "Lazy-abcdefgh.js"), LAZY);
  const source = await readFile(
    new URL("./static-assets.ts", import.meta.url),
    "utf8",
  );
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      compatibilityDate: "2026-08-11",
      script: `${stripTypeScriptTypes(source)}
        export default { fetch: (request, env) => serveAsset(request, env.ASSETS) };`,
      assets: {
        directory: root,
        binding: "ASSETS",
        routerConfig: {
          has_user_worker: true,
          invoke_user_worker_ahead_of_assets: true,
        },
        assetConfig: { not_found_handling: "single-page-application" },
      },
    }),
  );
  origin = await mf.ready;
}, 30000);

afterAll(() => mf?.dispose());

type Raw = { status: number; headers: Record<string, string>; body: Buffer };

/** One request with nothing decoded. `encoding` is the client's own value. */
function send(
  path: string,
  encoding: string | null,
  { method = "GET", headers = {} as Record<string, string> } = {},
): Promise<Raw> {
  const cf = { clientAcceptEncoding: encoding ?? "" };
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      new URL(path, origin),
      {
        method,
        headers: {
          ...(encoding === null ? {} : { "accept-encoding": encoding }),
          "MF-CF-Blob": JSON.stringify(cf),
          ...headers,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers as Record<string, string>,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    request.on("error", reject);
    request.end();
  });
}

function decoded(raw: Raw): string {
  const encoding = raw.headers["content-encoding"];
  if (encoding === "br") return brotliDecompressSync(raw.body).toString();
  if (encoding === "gzip") return gunzipSync(raw.body).toString();
  return raw.body.toString();
}

describe("brotli siblings in workerd", () => {
  it("sends a brotli client the stored sibling, typed as the original", async () => {
    const plain = await send("/assets/App-abcdefgh.js", null);
    // Miniflare's front line re-labels for the first listed coding, so br
    // comes first here; Cloudflare passes an accepted encoding through.
    const response = await send("/assets/App-abcdefgh.js", "br, gzip");
    expect(response.status).toBe(200);
    expect(response.headers["content-encoding"]).toBe("br");
    // Encoded again by the runtime, these would not be the stored bytes.
    expect(response.body.equals(SIBLING)).toBe(true);
    expect(response.headers["content-type"]).toBe(
      plain.headers["content-type"],
    );
    expect(response.headers["content-type"]).toContain("javascript");
    expect(response.headers.vary).toBe("Accept-Encoding");
    expect(response.headers["cache-control"]).toBe(
      "public, max-age=31536000, immutable",
    );
  });

  it.each([
    ["an identity client", null, {}],
    ["a gzip client", "gzip", {}],
    ["a range", "br", { range: "bytes=0-9" }],
    // Cloudflare may rewrite the header; the client's own value decides.
    [
      "a gzip client behind a rewritten header",
      "gzip",
      { "accept-encoding": "br, gzip" },
    ],
  ])("sends %s the original", async (_case, encoding, headers) => {
    const response = await send("/assets/App-abcdefgh.js", encoding, {
      headers,
    });
    expect(response.status).toBe(200);
    expect(response.body.equals(SIBLING)).toBe(false);
    expect(decoded(response)).toBe(SCRIPT);
    expect(response.headers.vary).toContain("Accept-Encoding");
    expect(response.headers["cache-control"]).toBe(
      "public, max-age=31536000, immutable",
    );
    if (encoding === null)
      expect(response.headers["content-encoding"]).toBeUndefined();
  });

  it("sends the original when the sibling is missing", async () => {
    const response = await send("/assets/Lazy-abcdefgh.js", "br");
    expect(response.status).toBe(200);
    expect(decoded(response)).toBe(LAZY);
  });

  it("answers HEAD and the sibling's validator", async () => {
    const head = await send("/assets/App-abcdefgh.js", "br", {
      method: "HEAD",
    });
    expect(head.status).toBe(200);
    expect(head.headers["content-encoding"]).toBe("br");
    expect(head.body.byteLength).toBe(0);
    const etag = (await send("/assets/App-abcdefgh.js", "br")).headers.etag;
    expect(etag).toBeTruthy();
    const revalidated = await send("/assets/App-abcdefgh.js", "br", {
      headers: { "if-none-match": etag ?? "" },
    });
    expect(revalidated.status).toBe(304);
    expect(revalidated.headers.vary).toBe("Accept-Encoding");
    expect(revalidated.headers["cache-control"]).toBe(
      "public, max-age=31536000, immutable",
    );
  });

  it("still answers a retired name with 404", async () => {
    const response = await send("/assets/Gone-abcdefgh.js", "br");
    expect(response.status).toBe(404);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(decoded(response)).toContain("Not found");
  });
});
