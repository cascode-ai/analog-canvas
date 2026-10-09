import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { userWorkspaceRoot } from "./workspace-location.js";
import {
  AgentHttpClient,
  AgentSessionClient,
  ConnectorStore,
  defaultConnectorFilePath,
  WorkspaceBindingStore,
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
  /**
   * The default per-origin connector file, which a long-lived MCP process
   * holds by a lease (#1522). An explicit ANALOG_CANVAS_MCP_CONNECTOR path
   * is the caller's choice, shared or not, and takes none.
   */
  connectorLease?: boolean;
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
    connectorLease: !env.ANALOG_CANVAS_MCP_CONNECTOR?.trim(),
    workspaceRoot: userWorkspaceRoot(env),
    ...(env.ANALOG_CANVAS_TASK_DIR
      ? { taskDirectory: env.ANALOG_CANVAS_TASK_DIR }
      : {}),
  };
}

/** One client state machine; neither entry point needs the other's handler. */
export function createOperationSession(
  config: RuntimeConfig = resolveConfig(),
  options: { shortLived?: boolean } = {},
): OperationSession {
  if (config.taskDirectory && !isAbsolute(config.taskDirectory))
    throw new Error(
      "ANALOG_CANVAS_TASK_DIR must be an absolute writable task directory",
    );
  // One CLI command is one short process: it resumes the file as before
  // and holds no lease that the next command would wait to see go stale.
  const lease = (config.connectorLease ?? false) && !options.shortLived;
  const connectorStore = new ConnectorStore(config.connectorPath, { lease });
  if (lease) releaseLeaseOnExit(connectorStore);
  return {
    ...(config.workspaceRoot ? { workspaceRoot: config.workspaceRoot } : {}),
    ...(config.taskDirectory ? { taskDirectory: config.taskDirectory } : {}),
    client: new AgentSessionClient({
      http: new AgentHttpClient({ baseUrl: config.apiBaseUrl }),
      connectorStore,
      ...(config.taskDirectory
        ? {
            workspaceBindingStore: new WorkspaceBindingStore(
              join(
                config.taskDirectory,
                ".analog-canvas",
                "targets",
                `${encodeURIComponent(new URL(config.apiBaseUrl).origin)}.json`,
              ),
            ),
          }
        : {}),
      requireDurableWorkspaceBinding: options.shortLived ?? false,
    }),
  };
}

/** Give the connector lease back however the process ends, short of a crash. */
function releaseLeaseOnExit(store: ConnectorStore): void {
  process.once("exit", () => store.releaseSync());
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
    process.once(signal, () => {
      store.releaseSync();
      // Ended as the signal would have ended it.
      process.kill(process.pid, signal);
    });
}
