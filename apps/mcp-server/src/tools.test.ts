import { describe, expect, it } from "vitest";
import { AgentSessionClient } from "@icm/agent-client";
import {
  capabilitiesResponse,
  FakeAgentHttp,
  renderResponse,
  snapshotResponse,
  transactSuccessResponse,
} from "../../../packages/agent-client/src/test-support/fake-relay.js";
import { testSnapshot } from "../../../packages/agent-client/src/test-support/snapshot-fixture.js";
import { callTool, listToolDefinitions } from "./tools.js";
import type { ToolSessionState } from "./tools.js";

async function toolSession(
  http: FakeAgentHttp = new FakeAgentHttp(),
): Promise<{ session: ToolSessionState; http: FakeAgentHttp }> {
  const client = new AgentSessionClient({
    http,
  });
  const session: ToolSessionState = { client };
  return { session, http };
}

function parseText(result: {
  content: { type: string; text?: string }[];
}): unknown {
  expect(result.content[0]?.type).toBe("text");
  return JSON.parse(result.content[0]!.text!);
}

describe("mcp tool surface", () => {
  it("exposes twelve compact tools with JSON-schema inputs", () => {
    const tools = listToolDefinitions();
    expect(tools.map((tool) => tool.name)).toEqual([
      "connect",
      "disconnect",
      "connection_status",
      "export_file",
      "import_file",
      "get_context",
      "inspect",
      "search",
      "apply_actions",
      "advanced_transact",
      "verify",
      "render",
    ]);
    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThan(10);
      expect(tool.inputSchema.type).toBe("object");
    }
    // The full edit union must not be inlined into default tool descriptions.
    const serialized = JSON.stringify(tools);
    expect(serialized).not.toContain("align_instances");
    expect(serialized).not.toContain("add_power_rail");
  });

  it("connect maps to claim, capabilities, and snapshot", async () => {
    const { session, http } = await toolSession();
    const result = await callTool(
      "connect",
      { claimCode: "session-1.code" },
      session,
    );
    const value = parseText(result) as {
      ok: boolean;
      mode: string;
      context: { revision: number };
    };
    expect(value.ok).toBe(true);
    expect(value.mode).toBe("claimed");
    expect(value.context.revision).toBe(5);
    expect(http.claims).toEqual(["session-1.code"]);
    expect(http.circuitCalls.map((call) => call.request.operation)).toEqual([
      "capabilities",
      "snapshot",
    ]);
  });

  it("get_context returns the compact context document", async () => {
    const { session } = await toolSession();
    await callTool("connect", { claimCode: "session-1.code" }, session);
    const value = parseText(
      await callTool("get_context", {}, session),
    ) as Record<string, unknown>;
    expect(value).toMatchObject({
      projectId: "project-1",
      documentId: "main",
      documentName: "Main",
      revision: 5,
      instanceCount: 2,
      netCount: 2,
      errors: 0,
      warnings: 1,
      connection: "online",
    });
  });

  it("inspect and search refresh by default so human edits are visible", async () => {
    const { session, http } = await toolSession();
    await callTool("connect", { claimCode: "session-1.code" }, session);
    const after = testSnapshot();
    after.document.instances[0]!.parameters = { w: "4u", l: "1u" };
    http.circuitHandler = async ({ request }) =>
      request.operation === "snapshot"
        ? snapshotResponse(request.requestId, after)
        : capabilitiesResponse(request.requestId);
    const instance = parseText(
      await callTool(
        "inspect",
        { target: { kind: "object", name: "M1" } },
        session,
      ),
    ) as Record<string, unknown>;
    expect(instance).toMatchObject({
      id: "instance-1",
      reference: "M1",
      symbolId: "nmos",
      parameters: { w: "4u", l: "1u" },
    });
    const hits = parseText(
      await callTool("search", { query: "vout", limit: 5 }, session),
    ) as { hits: { kind: string; id: string }[] };
    expect(hits.hits.length).toBeGreaterThan(0);
    expect(hits.hits.some((hit) => hit.id === "net-vout")).toBe(true);
    expect(
      http.circuitCalls.filter((call) => call.request.operation === "snapshot"),
    ).toHaveLength(3);
  });

  it("apply_actions rejects a hidden multi-transaction batch before committing", async () => {
    const http = new FakeAgentHttp();
    const { session } = await toolSession(http);
    await callTool("connect", { claimCode: "session-1.code" }, session);
    const transacts: boolean[] = [];
    http.circuitHandler = async ({ request }) => {
      switch (request.operation) {
        case "transact":
          transacts.push(request.dryRun ?? false);
          return transactSuccessResponse(
            request.requestId,
            request.expectedRevision,
          );
        case "snapshot": {
          const count = http.circuitCalls.filter(
            (call) => call.request.operation === "snapshot",
          ).length;
          if (count > 1) return snapshotResponse(request.requestId);
          return snapshotResponse(request.requestId);
        }
        default:
          return capabilitiesResponse(request.requestId);
      }
    };
    const result = await callTool(
      "apply_actions",
      {
        actions: [
          {
            kind: "place-component",
            symbol: "capacitor",
            reference: "C1",
            position: { x: 100, y: 100 },
          },
          {
            kind: "connect",
            from: { kind: "pin", instance: "R1", pin: "2" },
            to: { kind: "net", net: "Vout" },
          },
        ],
      },
      session,
    );
    const value = parseText(result) as {
      ok: boolean;
      code: string;
      transactions: number;
    };
    expect(result.isError).toBe(true);
    expect(value).toMatchObject({
      ok: false,
      code: "ACTION_BATCH_NOT_ATOMIC",
      transactions: 2,
    });
    expect(transacts).toEqual([]);
  });

  it("creates visible wire geometry for a pin-to-pin connect", async () => {
    const http = new FakeAgentHttp();
    const { session } = await toolSession(http);
    await callTool("connect", { claimCode: "session-1.code" }, session);
    const transacts: Extract<
      (typeof http.circuitCalls)[number]["request"],
      { operation: "transact" }
    >[] = [];
    http.circuitHandler = async ({ request }) => {
      switch (request.operation) {
        case "transact":
          transacts.push(request);
          return transactSuccessResponse(
            request.requestId,
            request.expectedRevision,
            ["route-new"],
          );
        case "snapshot": {
          const after = testSnapshot();
          after.document.revision = 6;
          return snapshotResponse(request.requestId, after, 6);
        }
        default:
          return capabilitiesResponse(request.requestId);
      }
    };

    const result = await callTool(
      "apply_actions",
      {
        actions: [
          {
            kind: "connect",
            from: { kind: "pin", instance: "M1", pin: "G" },
            to: { kind: "pin", instance: "R1", pin: "2" },
            via: [{ x: 360, y: 240 }],
          },
        ],
      },
      session,
    );

    expect(parseText(result)).toMatchObject({ ok: true, transactions: 1 });
    expect(transacts).toHaveLength(2);
    for (const request of transacts) {
      expect(request.edits).toBeUndefined();
      expect(request.wireIntent).toMatchObject({
        from: {
          kind: "endpoint",
          endpoint: {
            kind: "terminal",
            instanceId: "instance-1",
            pinName: "G",
          },
        },
        to: {
          kind: "endpoint",
          endpoint: {
            kind: "terminal",
            instanceId: "instance-2",
            pinName: "2",
          },
        },
        waypoints: [{ x: 360, y: 240 }],
      });
    }
  });

  it("apply_actions surfaces compile failures without sending", async () => {
    const { session, http } = await toolSession();
    await callTool("connect", { claimCode: "session-1.code" }, session);
    const calls = http.circuitCalls.length;
    const result = await callTool(
      "apply_actions",
      {
        actions: [
          {
            kind: "place-component",
            symbol: "not-in-catalog",
            reference: "X1",
            position: { x: 0, y: 0 },
          },
        ],
      },
      session,
    );
    expect(result.isError).toBe(true);
    const value = parseText(result) as { ok: boolean; code: string };
    expect(value.ok).toBe(false);
    expect(value.code).toBe("ACTION_COMPILE_FAILED");
    // Compilation resolves catalog and object names against a fresh Snapshot.
    expect(http.circuitCalls.length).toBe(calls + 1);
  });

  it("allows advanced transactions without a resource-read ceremony", async () => {
    const { session, http } = await toolSession();
    await callTool("connect", { claimCode: "session-1.code" }, session);
    http.circuitHandler = async ({ request }) => {
      switch (request.operation) {
        case "transact":
          return transactSuccessResponse(
            request.requestId,
            request.expectedRevision,
          );
        case "snapshot":
          return snapshotResponse(request.requestId);
        default:
          return capabilitiesResponse(request.requestId);
      }
    };
    const allowed = await callTool(
      "advanced_transact",
      {
        edits: [
          {
            kind: "move_instance",
            instanceId: "instance-1",
            position: { x: 1, y: 2 },
          },
        ],
      },
      session,
    );
    expect(parseText(allowed)).toMatchObject({ ok: true });
  });

  it("verify refreshes and reports changed objects", async () => {
    const http = new FakeAgentHttp();
    const { session } = await toolSession(http);
    await callTool("connect", { claimCode: "session-1.code" }, session);
    http.circuitHandler = async ({ request }) => {
      if (request.operation === "snapshot") {
        const count = http.circuitCalls.filter(
          (call) => call.request.operation === "snapshot",
        ).length;
        if (count > 1) {
          const after = testSnapshot();
          after.document.revision = 6;
          after.document.nets[0]!.name = "VoutX";
          return snapshotResponse(request.requestId, after, 6);
        }
      }
      if (request.operation === "capabilities") {
        return capabilitiesResponse(request.requestId);
      }
      return renderResponse(request.requestId);
    };
    const value = parseText(await callTool("verify", {}, session)) as {
      revision: number;
      changedObjectIds: string[];
      warnings: number;
    };
    expect(value.revision).toBe(6);
    expect(value.changedObjectIds).toContain("net-vout");
    expect(value.warnings).toBe(1);
  });

  it("render returns an svg image block plus a compact summary", async () => {
    const { session } = await toolSession();
    await callTool("connect", { claimCode: "session-1.code" }, session);
    const result = await callTool("render", { mode: "formal" }, session);
    expect(result.content).toHaveLength(2);
    const [summary, image] = result.content as [
      { type: string; text?: string },
      { type: string; data?: string; mimeType?: string },
    ];
    expect(summary.type).toBe("text");
    expect((JSON.parse(summary.text!) as { mode: string }).mode).toBe("formal");
    expect(image.type).toBe("image");
    expect(image.mimeType).toBe("image/svg+xml");
    expect(image.data).toBe(
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>', "utf8").toString(
        "base64",
      ),
    );
  });
});
