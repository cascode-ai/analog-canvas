import { agentServerInstructions } from "./guidance.generated.js";
import { AGENT_MCP_VERSION } from "@icm/agent-adapter";
import {
  createOperationSession,
  resolveConfig,
  siteBinding,
  type RuntimeConfig,
} from "./operation-session.js";
export { resolveConfig } from "./operation-session.js";
import {
  listResourceEntries,
  listResourceTemplates,
  readResourceContent,
} from "./resources.js";
import {
  callTool,
  listToolDefinitions,
  type ToolSessionState,
} from "./tools.js";
import type { McpServerHandler, McpServerInfo } from "./protocol.js";

export const MCP_SERVER_NAME = "analog-canvas";
export const MCP_SERVER_VERSION = AGENT_MCP_VERSION;

export type McpServerConfig = RuntimeConfig;

export const MCP_SERVER_INFO: McpServerInfo = {
  name: MCP_SERVER_NAME,
  version: MCP_SERVER_VERSION,
  instructions: agentServerInstructions,
};

/**
 * Assemble the MCP handler with one process-local Helper and on-demand
 * resources; local mode passes the session it opened on a workspace.
 */
export function assembleServer(
  config: McpServerConfig = resolveConfig(),
  toolSession: ToolSessionState = createOperationSession(config),
): {
  handler: McpServerHandler;
  serverInfo: McpServerInfo;
  toolSession: ToolSessionState;
} {
  const handler: McpServerHandler = {
    listTools: () =>
      listToolDefinitions().filter(
        (tool) => tool.name !== "open_canvas" || toolSession.webTasks,
      ),
    callTool: (name, args) => callTool(name, args, toolSession),
    listResources: listResourceEntries,
    listResourceTemplates,
    readResource: readResourceContent,
  };
  const binding = siteBinding(toolSession);
  return {
    handler,
    serverInfo: {
      ...MCP_SERVER_INFO,
      instructions: toolSession.localMode
        ? "Analog Canvas MCP on the local Project file. Read get_context and use the existing circuit tools on this workspace."
        : `${agentServerInstructions}\n\nThis server is bound to ${binding.apiOrigin} and connects only Claims from that address.${binding.note ? ` ${binding.note}` : ""}`,
    },
    toolSession,
  };
}
