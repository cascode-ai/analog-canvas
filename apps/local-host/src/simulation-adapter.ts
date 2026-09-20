import {
  SIMULATION_EXECUTOR_RESPONSE_MAX_BYTES,
  SIMULATION_EXECUTOR_STREAM_MAX_BYTES,
  SIMULATION_EXECUTOR_TRANSFER_HEADER,
} from "@icm/spice-run";

/** Explicit loopback transport. The executor owns runtime discovery, capabilities
 * and process lifetime; this adapter never starts or retries a simulation. */
export function createLocalSimulationHandler(
  origin: string,
  fetchImpl: typeof fetch = fetch,
): (request: Request) => Promise<Response> {
  const base = new URL(origin);
  if (
    base.protocol !== "http:" ||
    !["127.0.0.1", "[::1]"].includes(base.hostname) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    base.pathname !== "/" ||
    !base.port ||
    Number(base.port) === 0
  )
    throw new Error(
      "Simulation URL must be an explicit loopback HTTP origin and port.",
    );
  const target = new URL("/api/simulate", base);
  return async (request) => {
    let value: unknown;
    const text = await request.text();
    try {
      value = JSON.parse(text);
    } catch {
      return Response.json({ error: "invalid-json" }, { status: 400 });
    }
    if (!value || typeof value !== "object" || Array.isArray(value))
      return Response.json({ error: "invalid-request" }, { status: 400 });
    const operation = (value as { operation?: unknown }).operation;
    if (
      operation !== undefined &&
      operation !== "capabilities" &&
      operation !== "cancel"
    )
      return Response.json({ error: "invalid-operation" }, { status: 400 });
    try {
      const reply = await fetchImpl(target, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [SIMULATION_EXECUTOR_TRANSFER_HEADER]: "receipt-v1",
        },
        body: text,
        redirect: "error",
        signal: AbortSignal.timeout(operation === undefined ? 150000 : 10000),
      });
      const reader = reply.body?.getReader();
      const maximum = reply.headers.has("x-analog-simulation-receipt")
        ? SIMULATION_EXECUTOR_STREAM_MAX_BYTES
        : SIMULATION_EXECUTOR_RESPONSE_MAX_BYTES;
      let size = 0;
      // Preserve backpressure: the adapter must not buffer or duplicate the
      // complete numerical envelope. Once headers are sent, a broken body is
      // a stream failure, never a fabricated successful/complete JSON reply.
      const body = reader
        ? new ReadableStream<Uint8Array>({
            async pull(controller) {
              try {
                const next = await reader.read();
                if (next.done) {
                  reader.releaseLock();
                  controller.close();
                  return;
                }
                size += next.value.byteLength;
                if (size > maximum)
                  throw new Error("Executor response too large");
                controller.enqueue(next.value);
              } catch (error) {
                await reader.cancel().catch(() => {});
                reader.releaseLock();
                controller.error(error);
              }
            },
            async cancel(reason) {
              await reader.cancel(reason).catch(() => {});
              reader.releaseLock();
            },
          })
        : null;
      const headers = new Headers({
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      const retry = reply.headers.get("retry-after");
      if (retry) headers.set("retry-after", retry);
      return new Response(body, {
        status: reply.status,
        headers,
      });
    } catch {
      // Once Run was dispatched, a lost/oversized reply cannot prove nonexecution.
      const error =
        operation === "capabilities"
          ? "simulation-executor-unavailable"
          : operation === "cancel"
            ? "cancel-response-unknown"
            : "simulator-unreachable";
      return Response.json(
        {
          error,
          message:
            operation === "capabilities"
              ? "The configured local executor is unavailable; editing remains usable."
              : "The executor response is unavailable. Do not automatically submit another run.",
        },
        { status: operation === "capabilities" ? 503 : 502 },
      );
    }
  };
}
