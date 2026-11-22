import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  LATEST_PROTOCOL_VERSION,
  McpStdioServer,
  type McpServerHandler,
} from "./protocol.js";

const handler: McpServerHandler = {
  listTools: () => [
    {
      name: "echo",
      description: "echo",
      inputSchema: { type: "object", properties: {} },
    },
  ],
  callTool: async (name, args) => ({
    content: [{ type: "text", text: `${name}:${JSON.stringify(args)}` }],
  }),
  listResources: () => [
    { uri: "analog-canvas://reference/quickstart", name: "Quickstart" },
  ],
  readResource: (uri) => ({ uri, text: "content" }),
};

async function scriptedServer(
  lines: string[],
): Promise<{ responses: unknown[]; server: McpStdioServer }> {
  const input = new PassThrough();
  const output = new PassThrough();
  const server = new McpStdioServer(handler, {
    serverInfo: { name: "test", version: "0.0.0" },
    input,
    output,
  });
  const collected: unknown[] = [];
  const done = server.run();
  let buffer = "";
  output.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line.trim().length > 0) collected.push(JSON.parse(line));
      newline = buffer.indexOf("\n");
    }
  });
  for (const line of lines) input.write(`${line}\n`);
  input.end();
  await done;
  await new Promise((resolve) => setImmediate(resolve));
  return { responses: collected, server };
}

describe("mcp stdio protocol", () => {
  it("negotiates a supported protocol version and advertises capabilities", async () => {
    const { responses } = await scriptedServer([
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-03-26" },
      }),
    ]);
    const result = (responses[0] as { result: Record<string, unknown> }).result;
    expect(result.protocolVersion).toBe("2025-03-26");
    expect(result.capabilities).toEqual({
      tools: { listChanged: false },
      resources: { subscribe: false, listChanged: false },
    });
  });

  it("falls back to the latest version for unknown requests", async () => {
    const { responses } = await scriptedServer([
      JSON.stringify({
        jsonrpc: "2.0",
        id: 7,
        method: "initialize",
        params: { protocolVersion: "1999-01-01" },
      }),
    ]);
    expect(
      (responses[0] as { result: Record<string, unknown> }).result
        .protocolVersion,
    ).toBe(LATEST_PROTOCOL_VERSION);
  });

  it("lists tools and dispatches calls with arguments", async () => {
    const { responses } = await scriptedServer([
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "echo", arguments: { x: 1 } },
      }),
    ]);
    const tools = (responses[0] as { result: { tools: unknown[] } }).result
      .tools;
    expect(tools).toHaveLength(1);
    const call = (responses[1] as { result: { content: unknown[] } }).result;
    expect(call.content[0]).toEqual({
      type: "text",
      text: 'echo:{"x":1}',
    });
  });

  it("reads listed resources", async () => {
    const { responses } = await scriptedServer([
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "resources/list" }),
      JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "resources/read",
        params: { uri: "analog-canvas://reference/quickstart" },
      }),
    ]);
    const resources = (
      responses[0] as { result: { resources: { uri: string }[] } }
    ).result.resources;
    expect(resources.map((r) => r.uri)).toContain(
      "analog-canvas://reference/quickstart",
    );
    const contents = (
      responses[1] as { result: { contents: { uri: string; text: string }[] } }
    ).result.contents;
    expect(contents[0]).toEqual({
      uri: "analog-canvas://reference/quickstart",
      text: "content",
    });
  });

  it("answers ping, rejects unknown methods, and stays silent for notifications", async () => {
    const { responses } = await scriptedServer([
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "prompts/list" }),
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      "not json at all",
    ]);
    expect((responses[0] as { result: unknown }).result).toEqual({});
    expect((responses[1] as { error: { code: number } }).error.code).toBe(
      -32601,
    );
    expect(
      (responses[2] as { id: null; error: { code: number } }).error.code,
    ).toBe(-32700);
    expect(responses).toHaveLength(3);
  });

  it("rejects an unknown tool name by RPC method error", async () => {
    const { responses } = await scriptedServer([
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "missing", arguments: {} },
      }),
    ]);
    expect((responses[0] as { error: { code: number } }).error.code).toBe(
      -32601,
    );
  });
});
