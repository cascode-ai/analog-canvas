import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  AGENT_MCP_VERSION,
  agentMcpBootstrapManifest,
} from "@icm/agent-adapter";
import { AgentSessionClient, AgentSessionError } from "@icm/agent-client";
import { FakeAgentHttp } from "../../../packages/agent-client/src/test-support/fake-relay.js";
import { callTool, listToolDefinitions } from "./tools.js";
import type { ToolSessionState } from "./tools.js";
import { readResourceContent } from "./resources.js";

const MAX_TOOL_DESCRIPTION_LENGTH = 900;

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
  it("reports an outdated adapter from the origin's manifest, read once per session (#1844)", async () => {
    const [major] = AGENT_MCP_VERSION.split(".").map(Number);
    const latestVersion = `${major! + 1}.0.0`;
    const served = {
      ...agentMcpBootstrapManifest("https://relay.test"),
      version: latestVersion,
    };
    const { session, http } = await toolSession(
      new FakeAgentHttp({ manifest: () => served }),
    );
    const status = async (refresh: boolean) =>
      parseText(await callTool("connection_status", { refresh }, session)) as {
        runtime: Record<string, unknown>;
      };
    // Local only: nothing read yet, so nothing to report.
    expect((await status(false)).runtime).not.toHaveProperty("latestVersion");
    expect(http.manifestReads).toBe(0);
    const outdated = {
      version: AGENT_MCP_VERSION,
      latestVersion,
      status: "outdated",
      upgrade: {
        manifestUrl: "https://relay.test/api/agent/mcp-manifest.json",
        hosts: {
          codex: served.hosts.codex.command,
          claudeCode: served.hosts.claudeCode.command,
        },
      },
    };
    expect((await status(true)).runtime).toMatchObject(outdated);
    expect((await status(false)).runtime).toMatchObject(outdated);
    expect((await status(true)).runtime).toMatchObject(outdated);
    expect(http.manifestReads).toBe(1);
  });
  it("reports no release when the manifest is current or unreachable (#1844)", async () => {
    const current = await toolSession();
    expect(
      parseText(
        await callTool("connection_status", { refresh: true }, current.session),
      ),
    ).toMatchObject({
      runtime: { latestVersion: AGENT_MCP_VERSION, status: "current" },
    });
    let reachable = false;
    const unreachable = await toolSession(
      new FakeAgentHttp({
        manifest: () => {
          if (!reachable) throw new Error("fetch failed");
          return agentMcpBootstrapManifest("https://relay.test");
        },
      }),
    );
    const result = await callTool(
      "connection_status",
      { refresh: true },
      unreachable.session,
    );
    expect(result.isError).toBeFalsy();
    const { runtime } = parseText(result) as {
      runtime: Record<string, unknown>;
    };
    expect(runtime).toEqual({
      version: AGENT_MCP_VERSION,
      apiBaseUrl: "https://relay.test",
    });
    // A failed read is not kept: the next network read tries again.
    reachable = true;
    expect(
      parseText(
        await callTool(
          "connection_status",
          { refresh: true },
          unreachable.session,
        ),
      ),
    ).toMatchObject({ runtime: { latestVersion: AGENT_MCP_VERSION } });
    expect(unreachable.http.manifestReads).toBe(2);
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
  it("gives every tool a description and a JSON-schema input", () => {
    const tools = listToolDefinitions();
    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThan(10);
      expect(tool.inputSchema.type).toBe("object");
    }
    // The full edit union must not be inlined into default tool descriptions.
    const serialized = JSON.stringify(tools);
    expect(serialized).not.toContain("align_instances");
    expect(serialized).not.toContain("add_power_rail");
  });
  // Every Agent context pays for every description on every turn, so a long
  // workflow or policy text belongs in a reference the description links to.
  it("keeps every tool description within the length cap", () => {
    for (const tool of listToolDefinitions())
      expect(tool.description.length, tool.name).toBeLessThanOrEqual(
        MAX_TOOL_DESCRIPTION_LENGTH,
      );
  });
  it("links the Gallery and User Components descriptions to the guidance moved out of them", () => {
    const tools = listToolDefinitions();
    const reference = readResourceContent(
      "analog-canvas://reference/mcp-tools",
    ).text;
    for (const name of ["gallery_circuits", "user_components"])
      expect(tools.find((t) => t.name === name)!.description).toContain(
        "analog-canvas://reference/mcp-tools",
      );
    expect(reference).toContain('scope:"ai-seats"');
    expect(reference).toContain("takeOver:true");
    expect(reference).toContain("idempotencyKey");
    expect(reference).toContain("publicationVersion:1");
  });
});
