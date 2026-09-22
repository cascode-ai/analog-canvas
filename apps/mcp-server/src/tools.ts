import { executeOperation, operationError } from "./operations.js";
import type { OperationSession } from "./operation-session.js";
import { entryResult, textResult } from "./entry-result.js";
import type { McpToolCallResult } from "./protocol.js";

export { listToolDefinitions } from "./tool-discovery.js";
export {
  describeToolContract,
  toolInputSchema,
  ToolFailure,
} from "./operations.js";
export type { OperationSession as ToolSessionState } from "./operation-session.js";

/** MCP adaptation only; CLI calls the same operation boundary directly. */
export async function callTool(
  name: string,
  args: unknown,
  session: OperationSession,
): Promise<McpToolCallResult> {
  return entryResult(name, await executeOperation(name, args, session));
}

export function toolErrorResponse(
  error: unknown,
  input?: unknown,
): McpToolCallResult {
  return textResult(operationError(error, input), true);
}
