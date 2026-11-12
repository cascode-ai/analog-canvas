/**
 * Bound decompressed bytes while reading, before allocating/parsing a peer's
 * JSON envelope. A `Content-Encoding: gzip` body is inflated unless the
 * platform already inflated it (JSON never starts with the gzip magic).
 */
export async function readSyncJson(
  message: Pick<Request, "body" | "headers">,
  limit: number,
): Promise<unknown> {
  if (!message.body) throw new SyntaxError("Missing JSON body");
  const encoding = (message.headers.get("content-encoding") ?? "identity")
    .trim()
    .toLowerCase();
  if (encoding !== "identity" && encoding !== "gzip")
    throw new SyntaxError("Unsupported content encoding");
  const reader = (
    encoding === "gzip" ? await inflated(message.body) : message.body
  ).getReader();
  let size = 0,
    text = "";
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        // A cloned Request is one tee branch: awaiting cancellation waits for
        // the unread sibling, which may itself be waiting for this refusal.
        void reader.cancel().catch(() => {});
        throw new RangeError("JSON body too large");
      }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch (error) {
    if (error instanceof RangeError || error instanceof SyntaxError)
      throw error;
    throw new SyntaxError("Invalid sync body");
  } finally {
    reader.releaseLock();
  }
}

async function inflated(
  body: ReadableStream<Uint8Array>,
): Promise<ReadableStream<Uint8Array>> {
  const reader = body.getReader();
  const first = await reader.read();
  const replay = new ReadableStream<Uint8Array>({
    start(controller) {
      if (first.done) controller.close();
      else controller.enqueue(first.value);
    },
    async pull(controller) {
      const next = await reader.read();
      if (next.done) controller.close();
      else controller.enqueue(next.value);
    },
    cancel: (reason) => reader.cancel(reason),
  });
  return !first.done && first.value[0] === 0x1f && first.value[1] === 0x8b
    ? replay.pipeThrough(
        new DecompressionStream("gzip") as unknown as TransformStream<
          Uint8Array,
          Uint8Array
        >,
      )
    : replay;
}

/** Gzip a peer request body; receivers inflate it with the same bound. */
export async function gzipBody(text: string): Promise<ArrayBuffer> {
  return new Response(
    new Blob([text]).stream().pipeThrough(new CompressionStream("gzip")),
  ).arrayBuffer();
}

/** 15 s plus 1 s per 256 KiB of payload, capped (default 120 s). */
export function syncTimeoutMs(bytes: number, cap = 120_000): number {
  return Math.min(cap, 15_000 + Math.ceil(bytes / (256 * 1024)) * 1000);
}

export function peerOrigin(value: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("Peer must be an HTTPS origin");
  return url;
}
