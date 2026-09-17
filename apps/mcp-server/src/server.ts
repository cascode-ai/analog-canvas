import { agentServerInstructions } from "./guidance.generated.js";
import { homedir } from "node:os";
import { AGENT_MCP_VERSION } from "@icm/agent-adapter";
import {
  AgentHttpClient,
  AgentSessionClient,
  ConnectorStore,
  defaultConnectorFilePath,
} from "@icm/agent-client";
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

export interface McpServerConfig {
  apiBaseUrl: string;
  connectorPath: string;
}

export function resolveConfig(
  env: Record<string, string | undefined> = process.env,
): McpServerConfig {
  const apiBaseUrl =
    env.ANALOG_CANVAS_API_URL ?? "https://analog-canvas.tokenzhang.com";
  return {
    apiBaseUrl,
    connectorPath: defaultConnectorFilePath(homedir(), env, apiBaseUrl),
  };
}

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
  const http = new AgentHttpClient({ baseUrl: config.apiBaseUrl });
  const client = new AgentSessionClient({
    http,
    connectorStore: new ConnectorStore(config.connectorPath),
  });
  const toolSession: ToolSessionState = { client };
  const handler: McpServerHandler = {
    listTools: listToolDefinitions,
    callTool: (name, args) => callTool(name, args, toolSession),
    listResources: listResourceEntries,
    listResourceTemplates,
    readResource: readResourceContent,
  };
  return { handler, serverInfo: MCP_SERVER_INFO, toolSession };
}
