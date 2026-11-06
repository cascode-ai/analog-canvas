/** Bound bytes while reading, before allocating/parsing a peer's JSON envelope. */
export async function readSyncJson(
  message: Pick<Request, "body">,
  limit: number,
): Promise<unknown> {
  const reader = message.body?.getReader();
  if (!reader) throw new SyntaxError("Missing JSON body");
  let size = 0,
    text = "";
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new RangeError("JSON body too large");
      }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    reader.releaseLock();
  }
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
