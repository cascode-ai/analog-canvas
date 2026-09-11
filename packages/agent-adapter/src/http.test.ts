import { createEmptyDocument } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { startLoopbackAgentServer } from "./http.js";
import type { AgentPermissions } from "./schema.js";
import { createAgentCircuitService } from "./service.js";

const permissions: AgentPermissions = {
  snapshot: true,
  render: false,
  sourceSpans: false,
  edit: { geometry: false, connectivity: false, presentation: false },
};

describe("authenticated loopback Agent HTTP adapter", () => {
  it("serves versioned token-protected JSON endpoints with body limits", async () => {
    let document = createEmptyDocument("doc-http", "HTTP test");
    const service = createAgentCircuitService({
      agentId: "agent-http",
      resolver: new InMemorySymbolResolver(builtInSymbols),
      permissions,
      store: {
        getDocument: () => document,
        commitDocument: (next) => {
          document = next;
        },
      },
    });
    const token = "0123456789abcdef0123456789abcdef";
    const server = await startLoopbackAgentServer(service, {
      token,
      maxRequestBytes: 2_048,
    });
    try {
      const unauthorized = await fetch(server.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiVersion: "3.0",
          requestId: "unauthorized",
          operation: "capabilities",
        }),
      });
      expect(unauthorized.status).toBe(401);

      const authorized = await fetch(server.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          apiVersion: "3.0",
          requestId: "authorized",
          operation: "capabilities",
        }),
      });
      expect(authorized.status).toBe(200);
      expect(await authorized.json()).toMatchObject({
        ok: true,
        operation: "capabilities",
      });
      expect(authorized.headers.get("cache-control")).toBe("no-store");

      const snapshotCapabilities = await fetch(server.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          apiVersion: "3.0",
          requestId: "snapshot-capabilities",
          operation: "capabilities",
        }),
      });
      expect(snapshotCapabilities.status).toBe(200);
      expect(await snapshotCapabilities.json()).toMatchObject({
        apiVersion: "3.0",
        ok: true,
        capabilities: {
          operations: ["capabilities", "snapshot", "transact", "render"],
        },
      });

      const malformedV2 = await fetch(server.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          apiVersion: "3.0",
          requestId: "invalid-variant",
          operation: "transact",
          documentId: "doc-http",
          transactionId: "invalid-variant",
          expectedRevision: 0,
          edits: [
            {
              kind: "add_instance",
              instance: {
                id: "R1",
                symbolId: "resistor",
                symbolVariantId: "",
                placement: null,
              },
            },
          ],
        }),
      });
      expect(malformedV2.status).toBe(400);
      expect(await malformedV2.json()).toMatchObject({
        operation: "error",
        ok: false,
        error: { code: "INVALID_REQUEST" },
        diagnostics: [{ path: ["edits", 0, "instance", "symbolVariantId"] }],
      });
      expect(document.revision).toBe(0);

      const versionMismatch = await fetch(server.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          apiVersion: "1.0",
          requestId: "version-mismatch",
          operation: "capabilities",
        }),
      });
      expect(versionMismatch.status).toBe(400);
      expect(await versionMismatch.json()).toMatchObject({
        apiVersion: "3.0",
        ok: false,
        error: { code: "HTTP_API_VERSION_MISMATCH" },
      });

      const oversized = await fetch(server.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ padding: "x".repeat(3_000) }),
      });
      expect(oversized.status).toBe(413);
      expect(await oversized.json()).toMatchObject({
        ok: false,
        error: { code: "HTTP_BODY_TOO_LARGE" },
      });
    } finally {
      await server.close();
    }
  });

  it("rejects weak tokens before opening a listener", async () => {
    const service = createAgentCircuitService({
      agentId: "agent-http",
      resolver: new InMemorySymbolResolver(builtInSymbols),
      permissions,
      store: {
        getDocument: () => createEmptyDocument("doc-http", "HTTP test"),
        commitDocument: () => undefined,
      },
    });
    await expect(
      startLoopbackAgentServer(service, { token: "short" }),
    ).rejects.toThrow(/at least 32/u);
  });
});
