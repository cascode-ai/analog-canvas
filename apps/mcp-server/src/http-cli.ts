import type { OperationSession } from "./operation-session.js";
import { executeOperation } from "./operations.js";
import { entryResult } from "./entry-result.js";
import { listToolDefinitions } from "./tool-discovery.js";
import { readResourceContent } from "./resources.js";

/** A local executable adapter, not a second server or network protocol. */
export async function runHttpCommand(
  server: { toolSession: OperationSession },
  command: string,
  input: string,
): Promise<unknown> {
  if (command === "list-tools") return listToolDefinitions();
  if (command === "resource") return readResourceContent(input.trim());
  const args: unknown = JSON.parse(input.trim() || "{}");
  if (command === "circuit") return server.toolSession.client.request(args);
  // Identical definitions, validation and AgentSessionClient to the MCP path.
  return entryResult(
    command,
    await executeOperation(command, args, server.toolSession),
  );
}
