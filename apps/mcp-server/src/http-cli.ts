import type { OperationSession } from "./operation-session.js";
import { executeOperation } from "./operations.js";
import { entryResult } from "./entry-result.js";
import { listToolDefinitions } from "./tool-discovery.js";
import { readResourceContent } from "./resources.js";

const UUID =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu;

/**
 * The line a failed command prints: the error's own message, and its code
 * when it has one, so the caller can act on it. No stack trace is printed,
 * and anything shaped like a credential (a Bearer value, the UUIDs session
 * secrets are made of) is masked, since a caller may be a model.
 */
export function httpCommandFailureMessage(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
          .replace(/\bBearer\s+\S+/giu, "Bearer [redacted]")
          .replace(UUID, "[redacted]")
          .trim()
      : "";
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (typeof error.code === "string" || typeof error.code === "number")
      ? ` (${error.code})`
      : "";
  return message
    ? `HTTP client command failed: ${message}${code}`
    : "HTTP client command failed. Check the command, published schema, and connection status.";
}

/** No-argument commands must not wait for an open terminal/pipe to close. */
export function httpCommandReadsStdin(command: string): boolean {
  return command !== "list-tools";
}

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
