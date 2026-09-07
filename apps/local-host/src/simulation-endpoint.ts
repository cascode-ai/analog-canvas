import type { IncomingMessage, ServerResponse } from "node:http";

/** Transport seam only. Deployments own simulator discovery and supervision. */
export async function handleLocalSimulation(
  request: IncomingMessage,
  response: ServerResponse,
  handler?: (request: Request) => Promise<Response>,
): Promise<void> {
  const send = (status: number, payload: unknown) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(payload));
  };
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      size += (chunk as Buffer).length;
      if (size > 4 * 1024 * 1024) {
        send(413, { error: "request-too-large" });
        return;
      }
      chunks.push(chunk as Buffer);
    }
    const text = Buffer.concat(chunks).toString("utf8");
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      send(400, { error: "invalid-json" });
      return;
    }
    if (handler) {
      const result = await handler(
        new Request("http://localhost/api/simulate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: text,
        }),
      );
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(Buffer.from(await result.arrayBuffer()));
      return;
    }
    if (
      body &&
      typeof body === "object" &&
      "operation" in body &&
      body.operation === "capabilities"
    ) {
      send(200, {
        configured: false,
        inputs: [],
        analyses: [],
        parsedAnalyses: [],
        profiles: [],
        maxTimeoutMs: 0,
        maxInputBytes: 0,
        cancel: false,
      });
      return;
    }
    send(503, {
      error: "simulation-not-configured",
      message:
        "Configure a local execution adapter to run simulations. Editing and saved inputs remain available.",
    });
  } catch {
    send(503, {
      error: "simulation-executor-unavailable",
      message:
        "Local simulation adapter is unavailable; the host remains usable.",
    });
  }
}
