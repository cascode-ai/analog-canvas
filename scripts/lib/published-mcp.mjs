import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Only the immutable, pinned distribution is an installed-client acceptance. */
export function publishedMcpDeclaration(manifest) {
  assert.equal(manifest.format, "analog-canvas-mcp-bootstrap-v1");
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/u);
  const url = `https://github.com/cascode-ai/analog-canvas/releases/download/mcp-v${manifest.version}/analog-canvas-mcp-server-${manifest.version}.tgz`;
  assert.equal(manifest.distribution.downloadUrl, url);
  assert.match(manifest.distribution.sha256, /^[a-f0-9]{64}$/u);
  return {
    version: manifest.version,
    url,
    sha256: manifest.distribution.sha256,
  };
}

export function verifyPublishedMcpBytes(bytes, declaration) {
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    declaration.sha256,
    "Published MCP bytes do not match the served distribution manifest",
  );
}

export async function downloadPublishedMcp(baseUrl, directory) {
  const manifestResponse = await fetch(
    new URL("/api/agent/mcp-manifest.json", baseUrl),
    { cache: "no-store", signal: AbortSignal.timeout(30_000) },
  );
  assert.equal(manifestResponse.status, 200, "MCP manifest is unavailable");
  const declaration = publishedMcpDeclaration(await manifestResponse.json());
  const response = await fetch(declaration.url, {
    signal: AbortSignal.timeout(30_000),
  });
  assert.equal(response.status, 200, "Published MCP package is unavailable");
  const bytes = Buffer.from(await response.arrayBuffer());
  verifyPublishedMcpBytes(bytes, declaration);
  const archive = join(directory, "published-mcp.tgz");
  const executable = join(directory, "published-mcp.mjs");
  await writeFile(archive, bytes);
  // Read one member to stdout instead of extracting arbitrary archive paths.
  const program = execFileSync(
    "tar",
    ["-xOf", archive, "package/bin/analog-canvas-mcp.mjs"],
    { maxBuffer: 16 * 1024 * 1024, timeout: 30_000 },
  );
  await writeFile(executable, program);
  return { executable, receipt: { source: "published", ...declaration } };
}
