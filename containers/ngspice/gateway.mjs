import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 8080);
const EXECUTOR_URL = new URL(
  process.env.SIMULATION_EXECUTOR_URL ?? "http://executor:8080",
);
const ACCESS_TOKEN = (process.env.SIMULATION_ACCESS_TOKEN ?? "").trim();
const MAX_REQUEST_BYTES = positiveEnv(
  "SIMULATION_GATEWAY_MAX_REQUEST_BYTES",
  4 * 1024 * 1024,
);
const MAX_RESPONSE_BYTES = positiveEnv(
  "SIMULATION_GATEWAY_MAX_RESPONSE_BYTES",
  4 * 1024 * 1024,
);

if (!ACCESS_TOKEN) throw new Error("SIMULATION_ACCESS_TOKEN is required");

function positiveEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function authorized(request) {
  const match = /^Bearer\s+(\S+)$/u.exec(request.headers.authorization ?? "");
  if (!match) return false;
  const presented = Buffer.from(match[1], "utf8");
  const expected = Buffer.from(ACCESS_TOKEN, "utf8");
  return (
    presented.length === expected.length && timingSafeEqual(presented, expected)
  );
}

function send(response, status, body, headers = {}) {
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": body.byteLength,
    "cache-control": "no-store",
    ...headers,
  });
  response.end(body);
}

function readBounded(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    request.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_REQUEST_BYTES) {
        reject(Object.assign(new Error("request-too-large"), { status: 413 }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

const server = createServer(async (request, response) => {
  const path = request.url ?? "/";
  const isHealth = request.method === "GET" && path === "/health";
  const isOperation =
    request.method === "POST" && (path === "/run" || path === "/cancel");
  if (!isHealth && !isOperation) {
    send(response, 404, Buffer.from('{"error":"not-found"}'));
    return;
  }
  if (isOperation && !authorized(request)) {
    send(response, 401, Buffer.from('{"error":"unauthorized"}'), {
      "www-authenticate": "Bearer",
    });
    request.resume();
    return;
  }
  try {
    const body = isOperation ? await readBounded(request) : undefined;
    const upstream = new URL(path, EXECUTOR_URL);
    const result = await fetch(upstream, {
      method: request.method,
      ...(body
        ? {
            body,
            headers: { "content-type": "application/json" },
          }
        : {}),
      signal: AbortSignal.timeout(140_000),
    });
    const bytes = Buffer.from(await result.arrayBuffer());
    if (bytes.byteLength > MAX_RESPONSE_BYTES) {
      send(
        response,
        502,
        Buffer.from('{"error":"executor-response-too-large"}'),
      );
      return;
    }
    send(response, result.status, bytes, {
      ...(result.headers.get("retry-after")
        ? { "retry-after": result.headers.get("retry-after") }
        : {}),
    });
  } catch (error) {
    const status = error?.status === 413 ? 413 : 502;
    const code = status === 413 ? "request-too-large" : "executor-unreachable";
    send(response, status, Buffer.from(JSON.stringify({ error: code })));
  }
});

server.listen(PORT, () => {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : PORT;
  console.log(`simulation gateway listening on ${port}`);
});
