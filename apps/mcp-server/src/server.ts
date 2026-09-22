import { agentServerInstructions } from "./guidance.generated.js";
import { AGENT_MCP_VERSION } from "@icm/agent-adapter";
import {
  createOperationSession,
  resolveConfig,
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
 * Assemble the MCP handler with one process-local Helper and on-demand resources.
 */
export function assembleServer(config: McpServerConfig = resolveConfig()): {
  handler: McpServerHandler;
  serverInfo: McpServerInfo;
  toolSession: ToolSessionState;
} {
  const toolSession = createOperationSession(config);
  const handler: McpServerHandler = {
    listTools: listToolDefinitions,
    callTool: (name, args) => callTool(name, args, toolSession),
    listResources: listResourceEntries,
    listResourceTemplates,
    readResource: readResourceContent,
  };
  return { handler, serverInfo: MCP_SERVER_INFO, toolSession };
}
