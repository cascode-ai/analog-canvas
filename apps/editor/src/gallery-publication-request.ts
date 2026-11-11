/** Keep one publication intent across an uncertain reply and a page reload. */
const pending = new Map<string, { fingerprint: string; key: string }>();

export async function galleryPublicationRequest(
  path: string,
  init: RequestInit,
  fetchLike: typeof fetch = fetch,
): Promise<Response> {
  const identity = `canvas-publication:${init.method ?? "POST"}:${path}`;
  const bytes = new TextEncoder().encode(String(init.body ?? ""));
  const fingerprint = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  let previous = pending.get(identity);
  if (!previous) {
    try {
      const stored = JSON.parse(
        globalThis.sessionStorage?.getItem(identity) ?? "null",
      ) as unknown;
      if (
        stored &&
        typeof stored === "object" &&
        "fingerprint" in stored &&
        "key" in stored &&
        typeof stored.fingerprint === "string" &&
        typeof stored.key === "string"
      )
        previous = { fingerprint: stored.fingerprint, key: stored.key };
    } catch {
      /* Memory retains retry identity when storage is unavailable. */
    }
  }
  const command =
    previous?.fingerprint === fingerprint
      ? previous
      : { fingerprint, key: crypto.randomUUID() };
  pending.set(identity, command);
  try {
    globalThis.sessionStorage?.setItem(identity, JSON.stringify(command));
  } catch {
    /* Reference images and drawings stay out of session storage. */
  }
  const headers = new Headers(init.headers);
  headers.set("idempotency-key", command.key);
  const response = await fetchLike(path, { ...init, headers });
  // A refusal can follow an already committed, unanswered request. Only a
  // confirmed result or changed payload starts a new command. Server receipts
  // bind the key to the authenticated account as well as the request.
  if (
    response.ok &&
    response.status !== 207 &&
    pending.get(identity)?.key === command.key
  ) {
    pending.delete(identity);
    try {
      globalThis.sessionStorage?.removeItem(identity);
    } catch {
      /* Storage may be disabled. */
    }
  }
  return response;
}
