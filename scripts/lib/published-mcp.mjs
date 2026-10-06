import assert from "node:assert/strict";
import { createHash } from "node:crypto";

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
