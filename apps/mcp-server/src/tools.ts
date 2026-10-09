import { executeOperation } from "./operations.js";
import type { OperationSession } from "./operation-session.js";
import { entryResult } from "./entry-result.js";
import type { McpToolCallResult } from "./protocol.js";

export { listToolDefinitions } from "./tool-discovery.js";
export { ToolFailure } from "./operations.js";
/** @internal The tests read each tool's contract through this module. */
export { describeToolContract, toolInputSchema } from "./operations.js";
export type { OperationSession as ToolSessionState } from "./operation-session.js";

/** MCP adaptation only; CLI calls the same operation boundary directly. */
export async function callTool(
  name: string,
  args: unknown,
  session: OperationSession,
): Promise<McpToolCallResult> {
  return entryResult(name, await executeOperation(name, args, session));
}
