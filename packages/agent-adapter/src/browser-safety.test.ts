import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createEmptyDocument } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import {
  AGENT_SESSION_PROTOCOL_VERSION,
  AgentSessionControlMessageSchema,
  AgentSessionMessageSchema,
  AgentSessionScopeSchema,
  AgentTransportErrorCodeSchema,
} from "./envelope.js";
import { base64EncodeUtf8, utf8ByteLength } from "./platform.js";
import type { AgentPermissions } from "./schema.js";
import { createAgentCircuitService } from "./service.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
const allPermissions: AgentPermissions = {
  snapshot: true,
  render: true,
  sourceSpans: false,
  edit: { geometry: true, connectivity: true, presentation: true },
};

// WP-WA1: the browser-safe surface must carry the whole operation path without
// node:crypto or Node Buffer. This proves capabilities/snapshot/render run end
// to end through the browser-safe service, that the platform helpers are
// byte-identical to the Node equivalents, and that the frozen envelope/scopes
// parse representative values.

describe("agent-adapter browser-safe boundary", () => {
  it("runs capabilities/snapshot/render through the browser-safe service", () => {
    const document = createEmptyDocument("document-main", "Main");
    const service = createAgentCircuitService({
      agentId: "agent-browser",
      resolver,
      permissions: allPermissions,
      store: {
        getDocument: () => document,
        commitDocument: () => {
          /* read-only assertions do not commit */
        },
      },
    });

    const capabilities = service.handle({
      apiVersion: "3.0",
      requestId: "r1",
      operation: "capabilities",
    });
    expect(capabilities.ok).toBe(true);

    const snapshot = service.handle({
      apiVersion: "3.0",
      requestId: "r2",
      operation: "snapshot",
      documentId: document.id,
    });
    expect(snapshot.ok).toBe(true);

    const render = service.handle({
      apiVersion: "3.0",
      requestId: "r3",
      operation: "render",
      documentId: document.id,
      mode: "formal",
    });
    expect(render.ok).toBe(true);
    if (render.ok && render.operation === "render") {
      expect(render.artifact.encoding).toBe("base64");
      expect(render.artifact.sha256).toMatch(/^[a-f0-9]{64}$/u);
    }
  });

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

  it("frozen envelope, scope, and transport-error schemas parse values", () => {
    const message = AgentSessionMessageSchema.parse({
      protocolVersion: AGENT_SESSION_PROTOCOL_VERSION,
      sessionId: "s1",
      messageId: "m1",
      requestId: "r1",
      sentAt: "2026-08-12T12:00:00Z",
      kind: "circuit-request",
      payload: { example: true },
    });
    expect(message.kind).toBe("circuit-request");

    expect(
      AgentSessionControlMessageSchema.parse({
        protocolVersion: AGENT_SESSION_PROTOCOL_VERSION,
        sessionId: "s1",
        kind: "heartbeat",
        nonce: "heartbeat-1",
      }).kind,
    ).toBe("heartbeat");

    expect(AgentSessionScopeSchema.parse("circuit.edit.geometry")).toBe(
      "circuit.edit.geometry",
    );
    expect(AgentTransportErrorCodeSchema.parse("EDITOR_OFFLINE")).toBe(
      "EDITOR_OFFLINE",
    );
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
