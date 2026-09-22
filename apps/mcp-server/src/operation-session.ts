import { homedir } from "node:os";
import {
  AgentHttpClient,
  AgentSessionClient,
  ConnectorStore,
  defaultConnectorFilePath,
} from "@icm/agent-client";

export interface OperationSession {
  client: AgentSessionClient;
  workspaceBase?: string;
  workspaceBases?: Map<string, string>;
}

export interface RuntimeConfig {
  apiBaseUrl: string;
  connectorPath: string;
}

export function resolveConfig(
  env: Record<string, string | undefined> = process.env,
): RuntimeConfig {
  const apiBaseUrl =
    env.ANALOG_CANVAS_API_URL ?? "https://analog-canvas.tokenzhang.com";
  return {
    apiBaseUrl,
    connectorPath: defaultConnectorFilePath(homedir(), env, apiBaseUrl),
  };
}

/** One client state machine; neither entry point needs the other's handler. */
export function createOperationSession(
  config: RuntimeConfig = resolveConfig(),
): OperationSession {
  return {
    client: new AgentSessionClient({
      http: new AgentHttpClient({ baseUrl: config.apiBaseUrl }),
      connectorStore: new ConnectorStore(config.connectorPath),
    }),
  };
}
