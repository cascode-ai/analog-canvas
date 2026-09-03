import type { Readable, Writable } from "node:stream";
import { createInterface } from "node:readline";

/**
 * Minimal MCP stdio server protocol layer (ADR 0020).
 *
 * Implements the frozen subset an Analog Canvas host needs: the JSON-RPC 2.0
 * newline-delimited stdio transport, `initialize` negotiation, `ping`,
 * `tools/*`, and `resources/*`. Prompts, sampling, subscriptions, and any
 * unknown request with an ID fail closed with `-32601` so no host ever
 * silently depends on an unimplemented capability. Zero runtime dependencies.
 */

export const SUPPORTED_PROTOCOL_VERSIONS = [
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
] as const;
export const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

export interface McpContentBlock {
  type: "text" | "image";
  text?: string;
  data?: string;
  mimeType?: string;
}

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpResourceEntry {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface McpToolCallResult {
  content: McpContentBlock[];
  isError?: boolean;
}

export interface McpResourceContent {
  uri: string;
  mimeType?: string;
  text: string;
}

export interface McpServerHandler {
  listTools(): McpToolDefinition[];
  callTool(name: string, args: unknown): Promise<McpToolCallResult>;
  listResources(): McpResourceEntry[];
  listResourceTemplates?(): {
    uriTemplate: string;
    name: string;
    description?: string;
    mimeType?: string;
  }[];
  readResource(uri: string): McpResourceContent;
  /** Notified once after a host completes the initialize handshake. */
  onInitialized?(): void;
}

export interface McpServerInfo {
  name: string;
  version: string;
  instructions?: string;
}

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string };
}

const JSON_RPC_PARSE_ERROR = -32700;
const JSON_RPC_METHOD_NOT_FOUND = -32601;
const JSON_RPC_INVALID_REQUEST = -32600;
const JSON_RPC_INTERNAL_ERROR = -32603;

export class McpStdioServer {
  private readonly handler: McpServerHandler;
  private readonly serverInfo: McpServerInfo;
  private readonly input: Readable;
  private readonly output: Writable;
  private readonly log: (message: string) => void;
  private initialized = false;

  constructor(
    handler: McpServerHandler,
    options: {
      serverInfo: McpServerInfo;
      input?: Readable;
      output?: Writable;
      log?: (message: string) => void;
    },
  ) {
    this.handler = handler;
    this.serverInfo = options.serverInfo;
    this.input = options.input ?? process.stdin;
    this.output = options.output ?? process.stdout;
    this.log = options.log ?? (() => undefined);
  }

  /** Read newline-delimited JSON-RPC until the input stream ends. */
  async run(): Promise<void> {
    const lines = createInterface({ input: this.input });
    const done = new Promise<void>((resolve, reject) => {
      lines.on("close", () => resolve());
      lines.on("error", reject);
    });
    // Serialize handling so responses are written in request order even when
    // a host pipelines multiple requests.
    let queue = Promise.resolve();
    lines.on("line", (line) => {
      const trimmed = line.trim();
      if (trimmed.length === 0) return;
      queue = queue
        .then(() => this.handleLine(trimmed))
        .catch((error) => {
          this.log(`unhandled protocol error: ${String(error)}`);
        });
    });
    await done;
    await queue;
  }

  writeMessage(message: unknown): void {
    this.output.write(`${JSON.stringify(message)}\n`);
  }

  private reply(id: number | string, result: unknown): void {
    this.writeMessage({ jsonrpc: "2.0", id, result });
  }

  private replyError(
    id: number | string | null,
    code: number,
    message: string,
  ): void {
    this.writeMessage({ jsonrpc: "2.0", id, error: { code, message } });
  }

  /** Process one line; exposed for protocol tests. */
  async handleLine(line: string): Promise<void> {
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch {
      this.replyError(null, JSON_RPC_PARSE_ERROR, "Parse error");
      return;
    }
    const { id, method, params } = message;
    if (typeof method !== "string" || method.length === 0) {
      if (id !== undefined && id !== null) {
        this.replyError(id, JSON_RPC_INVALID_REQUEST, "Invalid Request");
      }
      return;
    }
    // A missing id marks a notification: never reply, never fail the channel.
    if (id === undefined || id === null) {
      if (method === "notifications/initialized") {
        this.initialized = true;
        this.handler.onInitialized?.();
      }
      return;
    }
    try {
      const result = await this.dispatch(method, params);
      this.reply(id, result);
    } catch (error) {
      if (error instanceof RpcMethodError) {
        this.replyError(id, error.code, error.message);
        return;
      }
      this.log(`internal error handling ${method}: ${String(error)}`);
      this.replyError(id, JSON_RPC_INTERNAL_ERROR, "Internal error");
    }
  }

  private async dispatch(method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case "initialize": {
        const requested =
          typeof params === "object" &&
          params !== null &&
          typeof (params as { protocolVersion?: unknown }).protocolVersion ===
            "string"
            ? (params as { protocolVersion: string }).protocolVersion
            : null;
        const protocolVersion = (
          SUPPORTED_PROTOCOL_VERSIONS as readonly string[]
        ).includes(requested ?? "")
          ? requested
          : LATEST_PROTOCOL_VERSION;
        return {
          protocolVersion,
          capabilities: {
            tools: { listChanged: false },
            resources: { subscribe: false, listChanged: false },
          },
          serverInfo: {
            name: this.serverInfo.name,
            version: this.serverInfo.version,
          },
          ...(this.serverInfo.instructions
            ? { instructions: this.serverInfo.instructions }
            : {}),
        };
      }
      case "ping":
        return {};
      case "tools/list":
        return { tools: this.handler.listTools() };
      case "tools/call": {
        const parsed = this.parseToolCallParams(params);
        const tool = this.handler
          .listTools()
          .find((t) => t.name === parsed.name);
        if (!tool) {
          throw new RpcMethodError(
            JSON_RPC_METHOD_NOT_FOUND,
            `Unknown tool: ${parsed.name}`,
          );
        }
        const result = await this.handler.callTool(
          parsed.name,
          parsed.arguments,
        );
        return {
          content: result.content,
          ...(result.isError ? { isError: true } : {}),
        };
      }
      case "resources/list":
        return { resources: this.handler.listResources() };
      case "resources/templates/list":
        return {
          resourceTemplates: this.handler.listResourceTemplates?.() ?? [],
        };
      case "resources/read": {
        const uri =
          typeof params === "object" && params !== null
            ? (params as { uri?: unknown }).uri
            : undefined;
        if (typeof uri !== "string" || uri.length === 0) {
          throw new RpcMethodError(
            JSON_RPC_INVALID_REQUEST,
            "Missing resource uri",
          );
        }
        return { contents: [this.handler.readResource(uri)] };
      }
      default:
        throw new RpcMethodError(
          JSON_RPC_METHOD_NOT_FOUND,
          `Unknown method: ${method}`,
        );
    }
  }

  private parseToolCallParams(params: unknown): {
    name: string;
    arguments: unknown;
  } {
    if (typeof params !== "object" || params === null) {
      throw new RpcMethodError(
        JSON_RPC_INVALID_REQUEST,
        "Invalid tools/call params",
      );
    }
    const name = (params as { name?: unknown }).name;
    if (typeof name !== "string" || name.length === 0) {
      throw new RpcMethodError(JSON_RPC_INVALID_REQUEST, "Missing tool name");
    }
    const args = (params as { arguments?: unknown }).arguments ?? {};
    return { name, arguments: args };
  }
}

class RpcMethodError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.name = "RpcMethodError";
    this.code = code;
  }
}

export { RpcMethodError };
