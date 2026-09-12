import {
  createSimulationFolder,
  readSimulationExperimentConfig,
} from "@icm/model";
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
  it("exposes compact Circuit, File and Simulation tools with JSON-schema inputs", () => {
    const tools = listToolDefinitions();
    expect(tools.map((tool) => tool.name)).toEqual([
      "connect",
      "disconnect",
      "connection_status",
      "project_cells",
      "simulation",
      "simulation_folder",
      "simulation_output",
      "simulation_measurement",
      "simulation_device_operating_point",
      "simulation_files",
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

  it("exposes Cloud Cell discovery through the Project Resource", async () => {
    const { session, http } = await toolSession();
    await callTool("connect", { claimCode: "session-1.code" }, session);
    const value = parseText(
      await callTool("project_cells", { action: "list-projects" }, session),
    ) as { ok: boolean; projects: unknown[] };
    expect(value).toEqual({
      apiVersion: "3.0",
      requestId: expect.any(String),
      operation: "list-projects",
      ok: true,
      projects: [],
    });
    expect(http.projectCalls).toHaveLength(1);
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

  it("manages source experiments without replacing authored bytes during rename/clone", async () => {
    const http = new FakeAgentHttp(),
      { session } = await toolSession(http);
    await callTool("connect", { claimCode: "session-1.code" }, session);
    const snapshot = testSnapshot();
    const folder = createSimulationFolder({
      id: "s",
      name: "OP",
      profileId: "test",
      documentId: "main",
    });
    folder.input.files[0]!.text =
      "* custom 🧪\r\n.control\r\nrepeat 2\r\nop\r\nend\r\n.endc\r\n.end";
    snapshot.project.simulationFolders = [folder];
    const writes: unknown[] = [];
    http.circuitHandler = async ({ request }) => {
      if (request.operation === "snapshot")
        return snapshotResponse(request.requestId, snapshot);
      if (request.operation === "transact") {
        writes.push(request);
        return transactSuccessResponse(
          request.requestId,
          request.expectedRevision,
        );
      }
      return capabilitiesResponse(request.requestId);
    };
    expect(
      parseText(
        await callTool(
          "simulation_folder",
          { action: "update", folderId: "s", name: "Bias" },
          session,
        ),
      ),
    ).toMatchObject({ ok: true });
    expect(
      parseText(
        await callTool(
          "simulation_folder",
          { action: "clone", folderId: "s", newFolderId: "copy", name: "AC" },
          session,
        ),
      ),
    ).toMatchObject({ ok: true });
    expect(writes[0]).toMatchObject({
      structureEdits: [
        {
          kind: "upsert_simulation_folder",
          folder: { id: "s", name: "Bias", input: folder.input },
        },
      ],
    });
    expect(writes[1]).toMatchObject({
      structureEdits: [
        {
          kind: "upsert_simulation_folder",
          folder: { id: "copy", input: folder.input },
        },
      ],
    });
    expect(
      parseText(
        await callTool(
          "simulation_folder",
          {
            action: "create",
            folderId: "text",
            name: "Native",
            profileId: "test",
          },
          session,
        ),
      ),
    ).toMatchObject({ ok: true });
    expect(writes[2]).toMatchObject({
      structureEdits: [
        {
          folder: {
            version: 4,
            input: { kind: "source", circuitBindings: [] },
          },
        },
      ],
    });
    expect(
      parseText(
        await callTool(
          "simulation_folder",
          {
            action: "create",
            folderId: "dut-text",
            name: "DUT text",
            profileId: "test",
            rootDocumentId: "main",
            dut: { name: "amp", ports: ["inp", "inn", "out"] },
          },
          session,
        ),
      ),
    ).toMatchObject({ ok: true });
    expect(writes[3]).toMatchObject({
      structureEdits: [
        {
          folder: {
            input: {
              circuitBindings: [{ documentId: "main", emission: "subcircuit" }],
              files: expect.arrayContaining([
                expect.objectContaining({
                  path: "testbench.spice",
                  text: expect.stringContaining("XDUT inp inn out amp"),
                }),
              ]),
            },
          },
        },
      ],
    });
    expect(
      parseText(
        await callTool(
          "simulation_folder",
          { action: "update", folderId: "s" },
          session,
        ),
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "SIMULATION_FOLDER_UPDATE_EMPTY" },
    });
  });
  it("retains legacy JSON helpers without permitting native experiments to downgrade", async () => {
    const http = new FakeAgentHttp(),
      { session } = await toolSession(http);
    await callTool("connect", { claimCode: "session-1.code" }, session);
    const snapshot = testSnapshot();
    snapshot.project.simulationFolders = [
      createSimulationFolder({
        id: "s",
        name: "Program",
        profileId: "test",
        documentId: "main",
      }),
    ];
    const native = snapshot.project.simulationFolders[0]!.input.files[0]!.text;
    http.circuitHandler = async ({ request }) => {
      if (request.operation === "snapshot")
        return snapshotResponse(request.requestId, snapshot);
      if (request.operation === "transact") {
        const edit = request.structureEdits?.[0];
        if (edit?.kind === "upsert_simulation_folder") {
          snapshot.project.simulationFolders = [edit.folder];
          snapshot.project.structureRevision++;
        }
        return transactSuccessResponse(
          request.requestId,
          request.expectedRevision,
        );
      }
      return capabilitiesResponse(request.requestId);
    };
    const original = JSON.stringify(snapshot.project.simulationFolders);
    for (const name of [
      "simulation_output",
      "simulation_measurement",
      "simulation_device_operating_point",
    ]) {
      expect(
        parseText(
          await callTool(name, { action: "list", folderId: "s" }, session),
        ),
      ).toMatchObject({
        ok: false,
        error: { code: "SIMULATION_NATIVE_CODE_REQUIRED" },
      });
    }
    expect(
      parseText(
        await callTool(
          "simulation_output",
          {
            action: "upsert",
            folderId: "s",
            label: "Vout",
            expression: { kind: "vector", vector: "v(out)" },
          },
          session,
        ),
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "SIMULATION_NATIVE_CODE_REQUIRED" },
    });
    expect(JSON.stringify(snapshot.project.simulationFolders)).toBe(original);
    // Explicit fixture for the retained v1 compatibility lane.
    snapshot.project.simulationFolders[0]!.input.files.find(
      (f) => f.path === "experiment.json",
    )!.text = JSON.stringify({
      version: 1,
      environment: { profileId: "test" },
    });
    const cfg = () => {
      const result = readSimulationExperimentConfig(
        snapshot.project.simulationFolders[0]!,
      );
      if (!result.ok) throw Error(result.message);
      return result.config;
    };
    expect(
      parseText(
        await callTool(
          "simulation_output",
          {
            action: "upsert",
            folderId: "s",
            outputId: "gain",
            label: "Gain",
            expression: {
              kind: "db20",
              operand: { kind: "vector", vector: "v(out)" },
            },
          },
          session,
        ),
      ),
    ).toMatchObject({ ok: true });
    expect(
      parseText(
        await callTool(
          "simulation_measurement",
          {
            action: "upsert",
            folderId: "s",
            measurementId: "gain-at-1k",
            label: "Gain at 1 kHz",
            analysis: "ac",
            outputId: "gain",
            method: { kind: "sample-at", coordinate: 1000 },
          },
          session,
        ),
      ),
    ).toMatchObject({ ok: true });
    expect(
      parseText(
        await callTool(
          "simulation_device_operating_point",
          {
            action: "upsert",
            folderId: "s",
            deviceOperatingPointId: "m1",
            targetDocumentId: "main",
            instanceId: "instance-1",
            occurrence: [],
            circuit: { bindingId: "circuit", callPath: [] },
          },
          session,
        ),
      ),
    ).toMatchObject({ ok: true });
    expect(cfg()).toMatchObject({
      outputs: [{ id: "gain" }],
      measurements: [{ id: "gain-at-1k" }],
      deviceOperatingPoints: [
        { id: "m1", circuit: { bindingId: "circuit", callPath: [] } },
      ],
    });
    expect(
      snapshot.project.simulationFolders[0]!.input.files.find(
        (f) => f.path === "run.cir",
      )!.text,
    ).toBe(native);
    expect(snapshot.project.simulationFolders[0]!.input).not.toHaveProperty(
      "analyses",
    );
  });
  it("returns recoverable errors for broken configuration and lets the same session repair it", async () => {
    const http = new FakeAgentHttp(),
      { session } = await toolSession(http);
    await callTool("connect", { claimCode: "session-1.code" }, session);
    const snapshot = testSnapshot(),
      folder = createSimulationFolder({
        id: "s",
        name: "Draft",
        profileId: "test",
      });
    folder.input.files.find((f) => f.path === folder.input.configPath)!.text =
      "{";
    snapshot.project.simulationFolders = [folder];
    http.circuitHandler = async ({ request }) =>
      request.operation === "snapshot"
        ? snapshotResponse(request.requestId, snapshot)
        : capabilitiesResponse(request.requestId);
    expect(
      parseText(
        await callTool(
          "simulation_output",
          { action: "list", folderId: "s" },
          session,
        ),
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "SIMULATION_CONFIG_INVALID", recovery: "fix-input" },
    });
    expect(
      parseText(
        await callTool(
          "simulation_folder",
          { action: "get", folderId: "s" },
          session,
        ),
      ),
    ).toMatchObject({
      ok: true,
      folder: {
        input: {
          files: expect.arrayContaining([
            { path: "experiment.json", text: "{" },
          ]),
        },
      },
    });
    snapshot.project.simulationFolders = [
      createSimulationFolder({
        id: "s",
        name: "Repaired",
        profileId: "test",
      }),
    ];
    expect(
      parseText(
        await callTool(
          "simulation_output",
          { action: "list", folderId: "s" },
          session,
        ),
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "SIMULATION_NATIVE_CODE_REQUIRED" },
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
