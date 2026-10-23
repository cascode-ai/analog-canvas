import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliDecompressSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import {
  createDeploymentCandidate,
  verifyDeployedCandidate,
  verifyDeploymentCandidate,
} from "./deployment-candidate.mjs";

const COMMIT = "a".repeat(40);

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "analog-canvas-candidate-test-"));
  const worker = join(root, "bundle");
  const editor = join(root, "dist");
  const output = join(root, "candidate");
  await Promise.all([
    mkdir(worker),
    mkdir(join(editor, "assets"), { recursive: true }),
  ]);
  await writeFile(join(worker, "index.js"), "export default {};\n");
  await writeFile(
    join(editor, "index.html"),
    '<script type="module" src="/assets/app-test.js"></script>\n',
  );
  await writeFile(
    join(editor, "assets", "app-test.js"),
    "const ready = true;\n".repeat(64),
  );
  await writeFile(join(editor, "assets", "font-test.woff2"), "woff2");
  const manifest = await createDeploymentCandidate({
    outputDirectory: output,
    workerBundleDirectory: worker,
    editorDirectory: editor,
    commit: COMMIT,
    version: "1.2.3",
  });
  return { output, manifest };
}

describe("deployment candidate", () => {
  it("checks candidate provenance and detects a truncated payload without content hashing", async () => {
    const { output, manifest } = await fixture();
    expect(manifest).not.toHaveProperty("payloadSha256");
    await expect(verifyDeploymentCandidate(output, COMMIT)).resolves.toEqual(
      manifest,
    );
    await expect(
      verifyDeploymentCandidate(output, "b".repeat(40)),
    ).rejects.toThrow();
    await writeFile(
      join(output, "editor", "assets", "app-test.js"),
      "changed\n",
    );
    await expect(verifyDeploymentCandidate(output, COMMIT)).rejects.toThrow();
  });

  it("carries a brotli sibling for compressible assets only", async () => {
    const { output, manifest } = await fixture();
    const assets = join(output, "editor", "assets");
    expect((await readdir(assets)).sort()).toEqual([
      "app-test.js",
      "app-test.js.br",
      "font-test.woff2",
    ]);
    expect(
      brotliDecompressSync(await readFile(join(assets, "app-test.js.br"))),
    ).toEqual(await readFile(join(assets, "app-test.js")));
    expect(manifest.fileCount).toBe(5);
  });

  it("proves that the deployed editor serves the accepted entry bytes", async () => {
    const { output } = await fixture();
    const shell = await readFile(join(output, "editor", "index.html"), "utf8");
    const entry = await readFile(
      join(output, "editor", "assets", "app-test.js"),
    );
    // fetch() decodes the body, so the bytes compare against the original.
    const serve = (encoding) => async (url) => {
      if (url.pathname === "/editor")
        return new Response(shell, {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      if (url.pathname === "/assets/app-test.js")
        return new Response(entry, {
          status: 200,
          headers: {
            "content-type": "text/javascript",
            ...(encoding ? { "content-encoding": encoding } : {}),
          },
        });
      return new Response("missing", { status: 404 });
    };
    await expect(
      verifyDeployedCandidate(output, "https://candidate.example", serve("br")),
    ).resolves.toEqual({
      commit: COMMIT,
      version: "1.2.3",
      entry: "/assets/app-test.js",
    });
    await expect(
      verifyDeployedCandidate(
        output,
        "https://candidate.example",
        serve("gzip"),
      ),
    ).rejects.toThrow(/brotli/u);
  });
});
