import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { base64EncodeUtf8, utf8ByteLength } from "./platform.js";

// WP-WA1: the browser-safe surface must carry the whole operation path without
// node:crypto or Node Buffer. The operations themselves run in
// service.test.ts; this proves the sources stay free of Node built-ins, that
// and that the platform helpers are byte-identical to the Node equivalents.

describe("agent-adapter browser-safe boundary", () => {
  it("browser-safe source files contain no node: imports or Buffer usage", () => {
    const browserSafeFiles = [
      "index.ts",
      "schema.ts",
      "snapshot.ts",
      "service.ts",
      "platform.ts",
      "envelope.ts",
      "session-state.ts",
      "host.ts",
      "openapi.ts",
    ];
    for (const file of browserSafeFiles) {
      const source = readFileSync(
        fileURLToPath(new URL(`./${file}`, import.meta.url)),
        "utf8",
      );
      expect(source, `${file} must not import node: builtins`).not.toMatch(
        /from\s+["']node:/u,
      );
      expect(source, `${file} must not use Buffer`).not.toMatch(
        /\bBuffer\.\w/u,
      );
    }
  });

  it("platform helpers are byte-identical to the Node equivalents", () => {
    const sample = "VDD rail \u2190 \u03b1\u03b2\u03b3 \u03b4"; // multibyte
    expect(utf8ByteLength(sample)).toBe(byteLengthUtf8Node(sample));
    expect(base64EncodeUtf8(sample)).toBe(base64Utf8Node(sample));
  });
});

// Node reference implementations used only inside this test to prove the
// browser-safe helpers produce identical bytes.
function byteLengthUtf8Node(value: string): number {
  return Buffer.byteLength(value, "utf8");
}
function base64Utf8Node(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}
