import { beforeAll, describe, expect, it, vi } from "vitest";
import { AgentSessionClient, AgentSessionError } from "@icm/agent-client";
import { FakeAgentHttp } from "../../../packages/agent-client/src/test-support/fake-relay.js";
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

// The first tool listing builds every tool's contract: about a second
// alone, and past the 5 s a test gets beside the full suite on a CI runner.
// Each worker builds them once, here, outside any one test's time.
beforeAll(() => void listToolDefinitions(), 30_000);

// What the tools do with the editor is tested against the real editor, in
// apps/editor/src/agent/mcp-*-live.test.ts. These never reach an editor.
describe("mcp tool surface", () => {
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
  it.each([500, 429, 408, 400])(
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
      "user_components",
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
      "circuit_view",
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
});
