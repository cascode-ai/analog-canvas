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
  return command !== "list-tools" && command !== "batch";
}

/** A local executable adapter, not a second server or network protocol. */
export async function runHttpCommand(
  server: { toolSession: OperationSession },
  command: string,
  input: string,
  options: { reportStartup?: boolean } = {},
): Promise<unknown> {
  if (command === "list-tools") return listToolDefinitions();
  if (command === "resource") return readResourceContent(input.trim());
  const args: unknown = JSON.parse(input.trim() || "{}");
  if (command === "circuit") return server.toolSession.client.request(args);
  // Identical definitions, validation and AgentSessionClient to the MCP path.
  return entryResult(
    command,
    await executeOperation(command, args, server.toolSession, {
      reportStartup: options.reportStartup ?? true,
    }),
  );
}

/**
 * `--http batch`: one tool call per JSON line, `{"tool": "...", "args":
 * {...}}`, each run as it arrives and answered by one result line, in
 * order (#1227). The whole batch shares one session: one connector resume
 * and one Snapshot cache, where one process per call paid both each time.
 * Only the first result reports the process's startup. A line that fails
 * does not stop the ones after it; the count of failed lines is returned.
 */
export async function runHttpBatch(
  server: { toolSession: OperationSession },
  lines: AsyncIterable<string>,
  write: (line: string) => void,
): Promise<number> {
  let failed = 0;
  let first = true;
  for await (const line of lines) {
    if (!line.trim()) continue;
    let result: unknown;
    try {
      const entry = JSON.parse(line) as { tool?: unknown; args?: unknown };
      if (typeof entry.tool !== "string" || entry.tool === "batch")
        throw new Error('Each line is {"tool": "<tool name>", "args": {...}}');
      result = await runHttpCommand(
        server,
        entry.tool,
        JSON.stringify(entry.args ?? {}),
        { reportStartup: first },
      );
      first = false;
    } catch (error) {
      result = {
        ok: false,
        error: {
          code: "INVALID_BATCH_LINE",
          message: httpCommandFailureMessage(error),
        },
      };
    }
    if (
      typeof result === "object" &&
      result !== null &&
      (("isError" in result && result.isError) ||
        ("ok" in result && result.ok === false))
    )
      failed += 1;
    write(JSON.stringify(result));
  }
  return failed;
}
