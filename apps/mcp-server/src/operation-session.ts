import { homedir } from "node:os";
import { isAbsolute } from "node:path";
import { userWorkspaceRoot } from "./workspace-location.js";
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
  workspaceRoot?: string;
  taskDirectory?: string;
}

export interface RuntimeConfig {
  apiBaseUrl: string;
  connectorPath: string;
  workspaceRoot?: string;
  taskDirectory?: string;
}

export function resolveConfig(
  env: Record<string, string | undefined> = process.env,
): RuntimeConfig {
  const apiBaseUrl =
    env.ANALOG_CANVAS_API_URL ?? "https://analog-canvas.tokenzhang.com";
  return {
    apiBaseUrl,
    connectorPath: defaultConnectorFilePath(homedir(), env, apiBaseUrl),
    workspaceRoot: userWorkspaceRoot(env),
    ...(env.ANALOG_CANVAS_TASK_DIR
      ? { taskDirectory: env.ANALOG_CANVAS_TASK_DIR }
      : {}),
  };
}

/** One client state machine; neither entry point needs the other's handler. */
export function createOperationSession(
  config: RuntimeConfig = resolveConfig(),
): OperationSession {
  if (config.taskDirectory && !isAbsolute(config.taskDirectory))
    throw new Error(
      "ANALOG_CANVAS_TASK_DIR must be an absolute writable task directory",
    );
  return {
    ...(config.workspaceRoot ? { workspaceRoot: config.workspaceRoot } : {}),
    ...(config.taskDirectory ? { taskDirectory: config.taskDirectory } : {}),
    client: new AgentSessionClient({
      http: new AgentHttpClient({ baseUrl: config.apiBaseUrl }),
      connectorStore: new ConnectorStore(config.connectorPath),
    }),
  };
}
