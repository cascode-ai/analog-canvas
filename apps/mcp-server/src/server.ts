import { homedir } from "node:os";
import {
  AgentHttpClient,
  AgentSessionClient,
  ConnectorStore,
  defaultConnectorFilePath,
} from "@icm/agent-client";
import {
  ADVANCED_EDITS_RESOURCE_URI,
  listResourceEntries,
  readResourceContent,
} from "./resources.js";
import {
  callTool,
  listToolDefinitions,
  type ToolSessionState,
} from "./tools.js";
import type { McpServerHandler, McpServerInfo } from "./protocol.js";

export const MCP_SERVER_NAME = "analog-canvas";
export const MCP_SERVER_VERSION = "0.2.0";

export interface McpServerConfig {
  apiBaseUrl: string;
  connectorPath: string;
}

export function resolveConfig(
  env: Record<string, string | undefined> = process.env,
): McpServerConfig {
  return {
    apiBaseUrl:
      env.ANALOG_CANVAS_API_URL ?? "https://analog-canvas.tokenzhang.com",
    connectorPath: defaultConnectorFilePath(homedir(), env),
  };
}

export const MCP_SERVER_INFO: McpServerInfo = {
  name: MCP_SERVER_NAME,
  version: MCP_SERVER_VERSION,
  instructions:
    "Analog Canvas MCP adapter over the four-operation Agent API. Start with connect, read analog-canvas://reference/quickstart, then get_context. Read reference resources on demand; do not guess symbol IDs, pin names, or revisions.",
};

/**
 * Assemble the MCP handler: one process-local AgentSessionClient Helper plus the
 * advanced-contract read gate that ties `advanced_transact` to actually
 * reading the edit-union resource in this session.
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
  let advancedContractRead = false;
  const toolSession: ToolSessionState = {
    client,
    hasReadAdvancedContract: () => advancedContractRead,
    markAdvancedContractRead: () => {
      advancedContractRead = true;
    },
  };
  const handler: McpServerHandler = {
    listTools: listToolDefinitions,
    callTool: (name, args) => callTool(name, args, toolSession),
    listResources: listResourceEntries,
    readResource: (uri) => {
      const content = readResourceContent(uri);
      if (uri === ADVANCED_EDITS_RESOURCE_URI) {
        toolSession.markAdvancedContractRead();
      }
      return content;
    },
  };
  return { handler, serverInfo: MCP_SERVER_INFO, toolSession };
}
