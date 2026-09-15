import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import {
  publishedMcpDeclaration,
  verifyPublishedMcpBytes,
} from "./published-mcp.mjs";

it("verifies the immutable package, not only a matching version label", () => {
  const bytes = Buffer.from("package bytes");
  const manifest = {
    format: "analog-canvas-mcp-bootstrap-v1",
    version: "0.10.0",
    distribution: {
      downloadUrl:
        "https://github.com/cascode-ai/analog-canvas/releases/download/mcp-v0.10.0/analog-canvas-mcp-server-0.10.0.tgz",
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
  };
  const declaration = publishedMcpDeclaration(manifest);
  expect(() => verifyPublishedMcpBytes(bytes, declaration)).not.toThrow();
  expect(() =>
    verifyPublishedMcpBytes(
      Buffer.from("different build, same version"),
      declaration,
    ),
  ).toThrow("do not match");
  expect(() =>
    publishedMcpDeclaration({ ...manifest, version: "../main" }),
  ).toThrow();
  expect(() =>
    publishedMcpDeclaration({
      ...manifest,
      distribution: {
        ...manifest.distribution,
        downloadUrl: "https://example.com/package.tgz",
      },
    }),
  ).toThrow();
});
