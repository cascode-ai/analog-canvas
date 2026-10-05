import {
  createSimulationFolder,
  readSimulationExperimentConfig,
} from "@icm/model";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { AgentSessionClient, AgentSessionError } from "@icm/agent-client";
import {
  capabilitiesResponse,
  errorResponse,
  FakeAgentHttp,
  folderDirectoryResponse,
  renderResponse,
  snapshotResponse,
  stateSnapshotResponse,
  transactSuccessResponse,
} from "../../../packages/agent-client/src/test-support/fake-relay.js";
import { testSnapshot } from "../../../packages/agent-adapter/src/test-support/snapshot-fixture.js";
import { callTool, listToolDefinitions } from "./tools.js";
import type { ToolSessionState } from "./tools.js";
import otaProject from "../../../netlists/native-ota-library/legacy-source.icproj.json";

const dutDocumentId = "document-ota-5t";
const dutName = "ota_5t";
// The OTA Cell's exported order: the testbench connects by position.
const dutPorts = ["VDD", "VSS", "IBIAS", "VINN", "VINP", "VOUT"];

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

// The first tool listing builds every tool's contract: about a second
// alone, and past the 5 s a test gets beside the full suite on a CI runner.
// Each worker builds them once, here, outside any one test's time.
beforeAll(() => void listToolDefinitions(), 30_000);

describe("mcp tool surface", () => {
  it("circuit_properties sends terminal control for the editor to plan", async () => {
    const { session, http } = await toolSession();
    await callTool("connect", { claimCode: "session-1.code" }, session);
    const snapshot = testSnapshot();
    const source = snapshot.document.instances[0]!;
    source.symbolId = "cccs";
    source.netlist = {
      parameters: { gain: "4" },
      control: { kind: "current", sensorInstanceId: "sensor" },
    };
    http.circuitHandler = async ({ request }) => {
      if (request.operation === "snapshot")
        return snapshotResponse(request.requestId, snapshot);
      if (request.operation === "transact")
        return transactSuccessResponse(
          request.requestId,
          request.expectedRevision,
          [source.id],
        );
      return capabilitiesResponse(request.requestId);
    };
    const control = {
      kind: "terminal-current",
      instanceId: "instance-2",
      pinName: "1",
      direction: "out",
    };
    const result = await callTool(
      "circuit_properties",
      {
        actions: [
          {
            kind: "set-source-control",
            target: { kind: "instance", id: source.id },
            control,
          },
        ],
      },
      session,
    );
    expect(parseText(result)).toMatchObject({ ok: true });
    // The editor plans it as Properties does (authoring-helper.test.ts).
    expect(
      http.circuitCalls
        .filter(({ request }) => request.operation === "transact")
        .map(({ request }) => request),
    ).toMatchObject([
      {
        actions: [
          {
            kind: "set-source-control",
            target: { kind: "instance", id: source.id },
            control,
          },
        ],
      },
    ]);
  });
  it("reads context, diagnostics and folder names through lightweight server projections", async () => {
    const { session, http } = await toolSession();
    await callTool("connect", { claimCode: "session-1.code" }, session);
    const snapshot = testSnapshot();
    snapshot.project.simulationFolders = [
      createSimulationFolder({
        id: "small-op",
        name: "OP",
        profileId: "test",
        documentId: "main",
      }),
    ];
    snapshot.project.simulationFolders[0]!.input.files[0]!.text =
      "private-source-body";
    http.circuitHandler = async ({ request }) => {
      if (request.operation === "snapshot" && request.projection === "state")
        return stateSnapshotResponse(
          request.requestId,
          snapshot,
          request.diagnosticDetail === "items",
        );
      if (
        request.operation === "snapshot" &&
        request.projection === "folder-directory"
      )
        return folderDirectoryResponse(request.requestId, snapshot);
      if (request.operation === "snapshot")
        return snapshotResponse(request.requestId, snapshot);
      return capabilitiesResponse(request.requestId);
    };
    expect(parseText(await callTool("get_context", {}, session))).toMatchObject(
      {
        revision: 5,
        instanceCount: snapshot.document.instances.length,
      },
    );
    expect(
      parseText(
        await callTool("inspect", { target: { kind: "diagnostics" } }, session),
      ),
    ).toMatchObject({
      revision: 5,
      counts: { total: 1, warnings: 1 },
      items: [{ code: "VISUAL_SPACING" }],
    });
    const folders = parseText(
      await callTool("simulation_folder", { action: "list" }, session),
    );
    expect(folders).toMatchObject({
      ok: true,
      folders: [{ id: "small-op", name: "OP" }],
    });
    expect(JSON.stringify(folders)).not.toContain("private-source-body");
    expect(
      http.circuitCalls
        .filter((call) => call.request.operation === "snapshot")
        .map((call) =>
          call.request.operation === "snapshot"
            ? call.request.projection
            : undefined,
        ),
    ).toEqual(["bootstrap", "state", "state", "folder-directory"]);
  });

  it("classifies invalid arguments without dispatching or echoing submitted values", async () => {
    const { session, http } = await toolSession();
    const result = await callTool(
      "simulation",
      {
        request: { operation: "capabilities" },
        waitMs: "private-invalid-value",
      },
      session,
    );
    expect(result.isError).toBe(true);
    expect(parseText(result)).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_TOOL_INPUT",
        recovery: "fix-input",
        issues: [{ path: ["waitMs"], code: "invalid_type" }],
      },
    });
    expect(JSON.stringify(result)).not.toContain("private-invalid-value");
    expect(http.circuitCalls).toHaveLength(0);
  });
  it.each(["ngspice", "vacask"] as const)(
    "creates a %s template from the selected Profile",
    async (engine) => {
      const http = new FakeAgentHttp();
      const { session } = await toolSession(http);
      await callTool("connect", { claimCode: "session-1.code" }, session);
      vi.spyOn(session.client, "projectResource").mockResolvedValue({
        apiVersion: "3.0",
        requestId: "netlist",
        operation: "read-project-code",
        ok: true,
        structureRevision: 0,
        projectCode: JSON.stringify(otaProject),
      });
      vi.spyOn(session.client, "simulationResource").mockResolvedValue({
        apiVersion: "3.0",
        requestId: "caps",
        operation: "capabilities",
        ok: true,
        capabilities: {
          configured: true,
          inputs: ["source"],
          analyses: ["op"],
          parsedAnalyses: ["op"],
          profiles: [{ id: "selected", engine, corners: [] }],
          maxTimeoutMs: 1000,
          maxInputBytes: 10000,
          maxOutputBytes: 10000,
          cancel: false,
        },
      });
      const writes: unknown[] = [];
      let snapshots = 0;
      http.circuitHandler = async ({ request }) => {
        if (request.operation === "snapshot") {
          snapshots++;
          return snapshotResponse(request.requestId);
        }
        if (request.operation === "transact") {
          writes.push(request);
          return transactSuccessResponse(
            request.requestId,
            request.expectedRevision,
          );
        }
        return capabilitiesResponse(request.requestId);
      };
      const created = parseText(
        await callTool(
          "simulation_folder",
          {
            action: "create",
            name: "Bias",
            profileId: "selected",
            rootDocumentId: dutDocumentId,
            dut: { name: dutName, ports: dutPorts },
          },
          session,
        ),
      );
      expect(created).toMatchObject({
        ok: true,
        dut: {
          name: dutName,
          ports: dutPorts,
          subckt: expect.stringContaining(`.subckt ${dutName}`),
        },
      });
      // The receipt is about the folder, not the open drawing (#1231).
      expect(Object.keys(created as object)[0]).toBe("folder");
      expect(created).not.toHaveProperty("diagnostics");
      expect(created).not.toHaveProperty("diagnosticDelta");
      expect(snapshots).toBe(1);
      expect(writes).toEqual([
        expect.objectContaining({
          structureEdits: [
            expect.objectContaining({
              folder: expect.objectContaining({
                input: expect.objectContaining({
                  files: expect.arrayContaining([
                    expect.objectContaining({
                      path: "run.cir",
                      text: expect.stringContaining(
                        engine === "ngspice" ? ".control\n" : "\ncontrol\n",
                      ),
                    }),
                    expect.objectContaining({
                      path: "testbench.spice",
                      text: expect.stringContaining(
                        engine === "ngspice"
                          ? `XDUT ${dutPorts.join(" ")} ${dutName}`
                          : `XDUT (${dutPorts.map((port) => `'${port}'`).join(" ")}) '${dutName}'`,
                      ),
                    }),
                  ]),
                }),
              }),
            }),
          ],
        }),
      ]);
      expect(
        parseText(
          await callTool(
            "simulation_folder",
            { action: "create", name: "Unknown", profileId: "unknown" },
            session,
          ),
        ),
      ).toMatchObject({
        ok: false,
        error: { code: "SIMULATION_PROFILE_UNAVAILABLE" },
      });
      expect(writes).toHaveLength(1);
    },
  );
  it.each([500, 502, 429, 408, 400])(
    "classifies HTTP %s without changing the retry identity",
    async (httpStatus) => {
      const { session } = await toolSession();
      vi.spyOn(session.client, "simulationResource").mockRejectedValue(
        new AgentSessionError(
          "HTTP_ERROR",
          `HTTP ${httpStatus}`,
          "request-rejected",
          httpStatus,
        ),
      );
      const result = await callTool(
        "simulation",
        {
          requestId: "same-start",
          request: {
            operation: "start",
            preparedId: "prepared",
            digest: "a".repeat(64),
          },
        },
        session,
      );
      expect(parseText(result)).toMatchObject({
        ok: false,
        requestId: "same-start",
        error: {
          httpStatus,
          stage: "start",
          recovery: httpStatus === 400 ? "fix-input" : "retry-same-request",
        },
      });
      expect(session.client.simulationResource).toHaveBeenCalledTimes(1);
    },
  );
  it("sends several connect actions in one request", async () => {
    const { session, http } = await toolSession();
    await callTool("connect", { claimCode: "session-1.code" }, session);
    http.circuitHandler = async ({ request }) =>
      request.operation === "transact"
        ? transactSuccessResponse(request.requestId, request.expectedRevision)
        : request.operation === "snapshot"
          ? snapshotResponse(request.requestId)
          : capabilitiesResponse(request.requestId);
    const result = await callTool(
      "apply_actions",
      {
        actions: ["G", "D"].map((pin) => ({
          kind: "connect",
          from: { kind: "pin", instance: "M1", pin },
          to: { kind: "pin", instance: "R1", pin: "2" },
        })),
      },
      session,
    );
    expect(parseText(result)).toMatchObject({ ok: true, transactions: 1 });
    const requests = http.circuitCalls
      .map((c) => c.request)
      .filter((r) => r.operation === "transact");
    expect(requests).toHaveLength(1);
    expect(requests[0]!.actions).toHaveLength(2);
  });
  it("reports the actual runtime origin without remote pairing for local readiness", async () => {
    const { session, http } = await toolSession();
    const result = parseText(
      await callTool("connection_status", { refresh: false }, session),
    );
    expect(result).toMatchObject({ runtime: { apiBaseUrl: http.baseUrl } });
  });
  it("advertises raw and captured Specs rather than a retired result renderer", () => {
    const tools = listToolDefinitions();
    expect(tools.find((t) => t.name === "simulation")?.description).toContain(
      "run.details",
    );
    const download = tools.find((t) => t.name === "export_file")!;
    expect(download.description).toContain("simulation_files");
    expect(download.description).toContain("SIMULATION_PLOT_RETIRED");
    expect(download.description).not.toContain("same plot renderer");
  });
  it("exposes compact Circuit, File and Simulation tools with JSON-schema inputs", () => {
    const tools = listToolDefinitions();
    expect(tools.map((tool) => tool.name)).toEqual([
      "describe_tool",
      "connect",
      "disconnect",
      "connection_status",
      "project_cells",
      "gallery_circuits",
      "project_code",
      "netlist_code",
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
      "simulation_source",
      "simulation_edit",
      "simulation_data",
      "simulation_plot",
      "simulation_results",
      "simulation_run",
      "simulation_batch",
      "circuit_place",
      "circuit_wire",
      "circuit_transform",
      "circuit_selection",
      "circuit_text",
      "circuit_properties",
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

  it("exposes Gallery, Project Code and Netlist as direct Agent tools", async () => {
    const { session } = await toolSession();
    await callTool("connect", { claimCode: "session-1.code" }, session);
    const projectResource = vi
      .spyOn(session.client, "projectResource")
      .mockImplementation(async (request) =>
        request.operation === "list-gallery"
          ? {
              apiVersion: "3.0",
              requestId: request.requestId,
              operation: request.operation,
              ok: true,
              entries: [],
              nextCursor: null,
              total: 0,
            }
          : request.operation === "read-gallery-entries"
            ? {
                apiVersion: "3.0",
                requestId: request.requestId,
                operation: request.operation,
                ok: true,
                entries: [],
                remainingEntryIds: [],
              }
            : request.operation === "read-project-code"
              ? {
                  apiVersion: "3.0",
                  requestId: request.requestId,
                  operation: request.operation,
                  ok: true,
                  projectCode: "{}",
                  structureRevision: 5,
                }
              : {
                  apiVersion: "3.0",
                  requestId: request.requestId,
                  operation: "read-netlist",
                  ok: true,
                  structureRevision: 5,
                  cells: [],
                  netlist: {
                    format: "spice",
                    status: "ready",
                    text: ".end\n",
                    diagnostics: [],
                  },
                },
      );

    expect(
      parseText(
        await callTool("gallery_circuits", { action: "list" }, session),
      ),
    ).toMatchObject({ ok: true, total: 0 });
    expect(
      parseText(
        await callTool(
          "gallery_circuits",
          { action: "read-many", galleryEntryIds: ["g1", "g2"] },
          session,
        ),
      ),
    ).toMatchObject({ ok: true, remainingEntryIds: [] });
    expect(
      parseText(await callTool("project_code", { action: "read" }, session)),
    ).toMatchObject({ ok: true, projectCode: "{}" });
    expect(
      parseText(
        await callTool(
          "netlist_code",
          { action: "read", documentId: "cell-bgr" },
          session,
        ),
      ),
    ).toMatchObject({ ok: true, netlist: { text: ".end\n" } });
    expect(
      projectResource.mock.calls.map(([request]) => request.operation),
    ).toEqual([
      "list-gallery",
      "read-gallery-entries",
      "read-project-code",
      "read-netlist",
    ]);
    expect(projectResource.mock.calls.at(-1)?.[0]).toMatchObject({
      operation: "read-netlist",
      documentId: "cell-bgr",
    });
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
    vi.spyOn(session.client, "simulationResource").mockResolvedValue({
      apiVersion: "3.0",
      requestId: "caps",
      operation: "capabilities",
      ok: true,
      capabilities: {
        configured: true,
        inputs: ["source"],
        analyses: ["op"],
        parsedAnalyses: ["op"],
        profiles: [{ id: "test", engine: "vacask", corners: [] }],
        maxTimeoutMs: 1000,
        maxInputBytes: 10000,
        maxOutputBytes: 10000,
        cancel: false,
      },
    });
    const snapshot = testSnapshot();
    vi.spyOn(session.client, "projectResource").mockResolvedValue({
      apiVersion: "3.0",
      requestId: "netlist",
      operation: "read-project-code",
      ok: true,
      structureRevision: 0,
      projectCode: JSON.stringify(otaProject),
    });
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
    ).toMatchObject({
      ok: true,
      folder: { id: "copy", name: "AC", entry: folder.input.entry },
    });
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
            input: {
              kind: "source",
              circuitBindings: [],
              files: expect.arrayContaining([
                expect.objectContaining({
                  path: "run.cir",
                  text: expect.stringContaining("analysis op op"),
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
          {
            action: "create",
            folderId: "bad-dut",
            name: "Bad DUT",
            profileId: "test",
            rootDocumentId: dutDocumentId,
            dut: { name: dutName, ports: ["in\ncontrol"] },
          },
          session,
        ),
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "SIMULATION_HELPER_INPUT_INVALID", recovery: "fix-input" },
    });
    expect(writes).toHaveLength(3);
    expect(
      parseText(
        await callTool(
          "simulation_folder",
          {
            action: "create",
            folderId: "dut-text",
            name: "DUT text",
            profileId: "test",
            rootDocumentId: dutDocumentId,
            dut: { name: dutName, ports: dutPorts },
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
              circuitBindings: [
                { documentId: dutDocumentId, emission: "subcircuit" },
              ],
              files: expect.arrayContaining([
                expect.objectContaining({
                  path: "testbench.spice",
                  text: expect.stringContaining(
                    `XDUT (${dutPorts.map((port) => `'${port}'`).join(" ")}) '${dutName}'`,
                  ),
                }),
              ]),
            },
          },
        },
      ],
    });
    // Issue #1259: the Cell's own port names in another order would wire
    // the testbench to the wrong pins by position.
    const swapped = [dutPorts[1]!, dutPorts[0]!, ...dutPorts.slice(2)];
    expect(
      parseText(
        await callTool(
          "simulation_folder",
          {
            action: "create",
            folderId: "dut-swapped",
            name: "DUT swapped",
            profileId: "test",
            rootDocumentId: dutDocumentId,
            dut: { name: dutName, ports: swapped },
          },
          session,
        ),
      ),
    ).toMatchObject({
      ok: false,
      error: {
        code: "SIMULATION_DUT_PORT_ORDER_MISMATCH",
        message: expect.stringContaining(
          `${dutPorts[1]} is at position 1, the Cell's 2`,
        ),
      },
    });
    expect(writes).toHaveLength(4);
    // Names that are not the Cell's ports are the testbench's own nodes.
    const aliases = ["vdd_tb", ...dutPorts.slice(1)];
    expect(
      parseText(
        await callTool(
          "simulation_folder",
          {
            action: "create",
            folderId: "dut-alias",
            name: "DUT alias",
            profileId: "test",
            rootDocumentId: dutDocumentId,
            dut: { name: dutName, ports: aliases },
          },
          session,
        ),
      ),
    ).toMatchObject({ ok: true, dut: { ports: aliases } });
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

  it("loads inspection state once, reuses it, and honors explicit refresh", async () => {
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
    ).toHaveLength(2);
    await callTool(
      "inspect",
      { target: { kind: "document" }, refresh: true },
      session,
    );
    expect(
      http.circuitCalls.filter((call) => call.request.operation === "snapshot"),
    ).toHaveLength(3);
  });

  it("inspects selected geometry without requesting a full Snapshot", async () => {
    const { session, http } = await toolSession();
    await callTool("connect", { claimCode: "session-1.code" }, session);
    http.circuitHandler = async ({ request }) => {
      if (request.operation !== "snapshot" || request.projection !== "geometry")
        throw new Error(`unexpected ${request.operation} request`);
      return {
        apiVersion: "3.0",
        requestId: request.requestId,
        operation: "snapshot",
        ok: true,
        projection: "geometry",
        projectId: "project-1",
        structureRevision: 0,
        documentId: "main",
        revision: 5,
        objects: [
          {
            kind: "instance",
            id: "instance-1",
            placement: {
              position: { x: 100, y: 200 },
              rotation: 0,
              mirror: "none",
            },
          },
        ],
        missingObjectIds: [],
      };
    };
    const result = parseText(
      await callTool(
        "inspect",
        { target: { kind: "geometry", objectIds: ["instance-1"] } },
        session,
      ),
    );
    expect(result).toMatchObject({
      projection: "geometry",
      revision: 5,
      objects: [{ kind: "instance", id: "instance-1" }],
    });
    expect(
      http.circuitCalls.flatMap(({ request }) =>
        request.operation === "snapshot" ? [request.projection] : [],
      ),
    ).toEqual(["bootstrap", "geometry"]);
  });

  it("apply_actions reports the editor's refusal of a list that needs several calls", async () => {
    const http = new FakeAgentHttp();
    const { session } = await toolSession(http);
    await callTool("connect", { claimCode: "session-1.code" }, session);
    const calls = [
      {
        actionIndices: [0],
        actionKinds: ["place-component"],
        sends: "placement batch" as const,
      },
      { actionIndices: [1], actionKinds: ["connect"], sends: "wires" as const },
    ];
    const message =
      "These actions need 2 calls; one call sends one transaction. Send them in this order, each group in its own call: actions[0] (place-component) as one placement batch; actions[1] (connect) as wires.";
    let transacts = 0;
    http.circuitHandler = async ({ request }) => {
      if (request.operation !== "transact")
        return capabilitiesResponse(request.requestId);
      transacts++;
      const refusal = errorResponse(
        request.requestId,
        "transact",
        "ACTION_BATCH_NOT_ATOMIC",
        message,
      );
      return {
        ...refusal,
        revision: 5,
        error: {
          code: "ACTION_BATCH_NOT_ATOMIC",
          message,
          calls,
          transactions: 2,
        },
      };
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
    expect(result.isError).toBe(true);
    expect(parseText(result)).toEqual({
      ok: false,
      stage: "compile",
      code: "ACTION_BATCH_NOT_ATOMIC",
      message,
      revision: 5,
      transactions: 2,
      calls,
    });
    // The one request was the editor's to refuse; nothing else was sent.
    expect(transacts).toBe(1);
  });

  it.each(["apply_actions", "circuit_wire"])(
    "%s sends a pin-to-pin connect for the editor to route",
    async (tool) => {
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
        tool,
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
      // One relayed request, with no dry-run pass ahead of it. The editor
      // plans the wire and its waypoint (authoring-helper.test.ts).
      expect(transacts).toHaveLength(1);
      expect(transacts[0]).toMatchObject({
        actions: [
          {
            kind: "connect",
            from: { kind: "pin", instance: "M1", pin: "G" },
            to: { kind: "pin", instance: "R1", pin: "2" },
            via: [{ x: 360, y: 240 }],
          },
        ],
      });
    },
  );

  it("apply_actions reports the editor's planning refusal, naming the action", async () => {
    const { session, http } = await toolSession();
    await callTool("connect", { claimCode: "session-1.code" }, session);
    const message =
      'actions[0] (place-component): unknown symbol "not-in-catalog"';
    http.circuitHandler = async ({ request }) => {
      if (request.operation !== "transact")
        return capabilitiesResponse(request.requestId);
      return {
        ...errorResponse(
          request.requestId,
          "transact",
          "ACTION_COMPILE_FAILED",
          message,
        ),
        revision: 5,
        error: {
          code: "ACTION_COMPILE_FAILED",
          message,
          actionIndex: 0,
          actionKind: "place-component",
        },
      };
    };
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
    expect(parseText(result)).toEqual({
      ok: false,
      stage: "compile",
      code: "ACTION_COMPILE_FAILED",
      message,
      actionIndex: 0,
      actionKind: "place-component",
      revision: 5,
    });
  });

  it("apply_actions asks for a reload when the editor page cannot plan actions", async () => {
    const { session, http } = await toolSession();
    // An editor page loaded before it could plan action lists.
    const editor = http.circuitHandler;
    let transacts = 0;
    http.circuitHandler = async (call) => {
      if (call.request.operation === "transact") transacts++;
      const response = await editor(call);
      if (response.operation === "capabilities" && response.ok)
        response.capabilities.transactionForms = ["edits", "command"];
      return response;
    };
    await callTool("connect", { claimCode: "session-1.code" }, session);
    const result = await callTool(
      "apply_actions",
      { actions: [{ kind: "undo" }] },
      session,
    );
    expect(result.isError).toBe(true);
    expect(parseText(result)).toMatchObject({
      ok: false,
      code: "EDITOR_OUTDATED",
    });
    expect(transacts).toBe(0);
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
    await session.client.refreshSnapshot();
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
    expect(http.projectCalls).toHaveLength(0);
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

  it("a Gallery read with render returns the figure as an image block", async () => {
    const data = Buffer.from("png bytes").toString("base64");
    const { session, http } = await toolSession(
      new FakeAgentHttp({
        projects: (request) => ({
          apiVersion: "3.0",
          requestId: request.requestId,
          operation: "read-gallery-entry",
          ok: true,
          entry: {
            id: "296p9s5vn2",
            name: "Telescopic op amp",
            author: "",
            description: "",
            createdAt: "",
            schemaVersion: 1,
            tags: [],
          },
          projectCode: "{}",
          netlist: null,
          figure: {
            documentId: "document-top",
            mediaType: "image/png",
            encoding: "base64",
            data,
            byteLength: 9,
            sha256: "0".repeat(64),
          },
        }),
      }),
    );
    await callTool("connect", { claimCode: "session-1.code" }, session);
    const result = await callTool(
      "gallery_circuits",
      { action: "read", galleryEntryId: "296p9s5vn2", render: "png" },
      session,
    );
    expect(http.projectCalls.at(-1)).toMatchObject({
      operation: "read-gallery-entry",
      render: "png",
    });
    const [summary, image] = result.content as [
      { type: string; text: string },
      { type: string; data?: string; mimeType?: string },
    ];
    // The text keeps the entry and the figure's identity, not its bytes.
    expect(JSON.parse(summary.text)).toMatchObject({
      entry: { id: "296p9s5vn2" },
      figure: { documentId: "document-top", mediaType: "image/png" },
    });
    expect(summary.text).not.toContain(data);
    expect(image).toEqual({ type: "image", data, mimeType: "image/png" });
  });
});
