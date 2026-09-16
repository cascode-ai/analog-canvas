import type { assembleServer } from "./server.js";

/** A local executable adapter, not a second server or network protocol. */
export async function runHttpCommand(
  server: ReturnType<typeof assembleServer>,
  command: string,
  input: string,
): Promise<unknown> {
  if (command === "list-tools") return server.handler.listTools();
  if (command === "resource") return server.handler.readResource(input.trim());
  const args: unknown = JSON.parse(input.trim() || "{}");
  if (command === "circuit") return server.toolSession.client.request(args);
  // Identical definitions, validation and AgentSessionClient to the MCP path.
  return server.handler.callTool(command, args);
}
