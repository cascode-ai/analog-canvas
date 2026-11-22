import { expect } from "vitest";
import { createEmptyProject } from "@icm/model";
import { createAgentCircuitService } from "@icm/agent-adapter";
import { AgentSessionClient } from "../../../../packages/agent-client/src/session-client";
import { FakeAgentHttp } from "../../../../packages/agent-client/src/test-support/fake-relay";
import { callTool, type ToolSessionState } from "../../../mcp-server/src/tools";
import { EditorDocumentController } from "../document/document-controller";
import { BrowserAgentHost } from "./browser-agent-host";
import type { BrowserAgentPlanningContext } from "./browser-agent-command";

/**
 * The real editor behind the Agent API and the MCP tools: `client` speaks the
 * API, `tool` calls an MCP tool and parses its receipt.
 */
export async function folder(
  project = createEmptyProject("project-1", "Parity"),
  planning: BrowserAgentPlanningContext = {},
) {
  project.documents[0]!.id = "main";
  project.topDocumentId = "main";
  const controller = new EditorDocumentController(project);
  const service = createAgentCircuitService({
    agentId: "test",
    host: new BrowserAgentHost(
      controller,
      undefined,
      undefined,
      undefined,
      planning,
    ),
    permissions: {
      snapshot: true,
      render: true,
      sourceSpans: false,
      semanticControl: false,
      edit: { geometry: true, connectivity: true, presentation: true },
    },
  });
  const http = new FakeAgentHttp();
  http.circuitHandler = async ({ request }) => service.handle(request);
  const client = new AgentSessionClient({ http });
  await client.connect("session-1.code");
  const session: ToolSessionState = { client };
  async function tool(name: string, args: unknown) {
    const result = await callTool(name, args, session);
    const content = result.content[0];
    if (content?.type !== "text")
      throw new Error("Expected a structured receipt");
    return JSON.parse(content.text!);
  }
  async function add() {
    const result = await client.applyActions([
      {
        kind: "place-component",
        symbol: "nmos",
        reference: "M1",
        position: { x: 100, y: 100 },
      },
    ]);
    expect(result.ok, result.message).toBe(true);
    return controller.document.instances[0]!.id;
  }
  return { controller, client, tool, add, http };
}
