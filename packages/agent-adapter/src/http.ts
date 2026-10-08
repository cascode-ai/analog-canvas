import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";

import { AGENT_API_VERSION, AgentCircuitResponseSchema } from "./schema.js";
import {
  invalidAgentRequestResponse,
  parseAgentCircuitRequest,
} from "./request-contract.js";
import type { AgentCircuitService } from "./service.js";

export interface LoopbackAgentServerOptions {
  token: string;
  host?: "127.0.0.1" | "::1";
  port?: number;
  maxRequestBytes?: number;
}

export interface LoopbackAgentServer {
  url: string;
  close(): Promise<void>;
}

function writeJson(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  const data = JSON.stringify(body);
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(data, "utf8"),
  });
  response.end(data);
}

function httpError(code: string, message: string) {
  return AgentCircuitResponseSchema.parse({
    apiVersion: AGENT_API_VERSION,
    requestId: "http-error",
    operation: "error",
    ok: false,
    error: { code, message },
    diagnostics: [],
  });
}

function authorized(request: IncomingMessage, token: string): boolean {
  const supplied = request.headers.authorization ?? "";
  const expected = Buffer.from(`Bearer ${token}`, "utf8");
  const actual = Buffer.from(supplied, "utf8");
  return (
    actual.byteLength === expected.byteLength &&
    timingSafeEqual(actual, expected)
  );
}

async function readJsonBody(
  request: IncomingMessage,
  maximum: number,
): Promise<unknown> {
  const declared = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(declared) && declared > maximum) {
    throw new Error("HTTP_BODY_TOO_LARGE");
  }
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.byteLength;
    if (length > maximum) throw new Error("HTTP_BODY_TOO_LARGE");
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("HTTP_INVALID_JSON");
  }
}

/** @public The `./loopback` entry point's server for desktop and scripted hosts. */
export async function startLoopbackAgentServer(
  service: AgentCircuitService,
  options: LoopbackAgentServerOptions,
): Promise<LoopbackAgentServer> {
  if (options.token.length < 32) {
    throw new Error(
      "Agent loopback bearer token must contain at least 32 characters",
    );
  }
  const host = options.host ?? "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "::1") {
    throw new Error("Agent HTTP adapter may bind only to a loopback address");
  }
  const maximum = options.maxRequestBytes ?? service.limits.maxRequestBytes;
  const server = createServer(async (request, response) => {
    if (request.method !== "POST") {
      writeJson(
        response,
        405,
        httpError("HTTP_METHOD_NOT_ALLOWED", "Use POST /circuit"),
      );
      return;
    }
    if (request.url !== "/circuit") {
      writeJson(
        response,
        404,
        httpError("HTTP_NOT_FOUND", "Unknown Agent API path"),
      );
      return;
    }
    if (!authorized(request, options.token)) {
      writeJson(
        response,
        401,
        httpError("HTTP_UNAUTHORIZED", "A valid bearer token is required"),
      );
      return;
    }
    const contentType = request.headers["content-type"]?.split(";", 1)[0];
    if (contentType !== "application/json") {
      writeJson(
        response,
        415,
        httpError(
          "HTTP_UNSUPPORTED_MEDIA",
          "Content-Type must be application/json",
        ),
      );
      return;
    }
    try {
      const input = await readJsonBody(request, maximum);
      const inputVersion =
        input && typeof input === "object" && "apiVersion" in input
          ? (input as { apiVersion?: unknown }).apiVersion
          : undefined;
      if (inputVersion !== AGENT_API_VERSION) {
        writeJson(
          response,
          400,
          httpError(
            "HTTP_API_VERSION_MISMATCH",
            `/circuit requires apiVersion ${AGENT_API_VERSION}`,
          ),
        );
        return;
      }
      const parsed = parseAgentCircuitRequest(input);
      if (!parsed.success) {
        writeJson(response, 400, parsed.response);
        return;
      }
      writeJson(response, 200, service.handle(parsed.data));
    } catch (error) {
      const code =
        error instanceof Error ? error.message : "HTTP_INVALID_REQUEST";
      writeJson(
        response,
        code === "HTTP_BODY_TOO_LARGE" ? 413 : 400,
        code === "HTTP_BODY_TOO_LARGE"
          ? httpError(code, `Request body exceeds ${maximum} bytes`)
          : invalidAgentRequestResponse({
              requestId: "http-error",
            }),
      );
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Agent loopback server did not expose a TCP address");
  }
  const displayHost = host === "::1" ? `[${host}]` : host;
  return {
    url: `http://${displayHost}:${address.port}/circuit`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
