/** Keep one publication intent across an uncertain reply and a page reload. */
const pending = new Map<string, { fingerprint: string; key: string }>();

export async function galleryPublicationRequest(
  path: string,
  init: RequestInit,
  fetchLike: typeof fetch = fetch,
): Promise<Response> {
  const identity = `canvas-publication:${init.method ?? "POST"}:${path}`;
  const review = /^\/api\/gallery\/([^/]+)\/reviews$/.exec(path);
  const firstSubmission =
    init.method === "POST" &&
    (path === "/api/gallery/submissions" || review !== null);
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
  let command = previous?.fingerprint === fingerprint ? previous : undefined;
  if (!command) {
    let key = crypto.randomUUID() as string;
    if (firstSubmission) {
      const prepared = await fetchLike(path + "/intent", {
        method: "POST",
        credentials: "same-origin",
      });
      if (!prepared.ok) return prepared;
      const payload = (await prepared.json()) as { key?: unknown };
      if (
        typeof payload.key !== "string" ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(payload.key)
      )
        throw new Error("Submission could not be prepared. Please try again.");
      key = payload.key;
    }
    command = { fingerprint, key };
  }
  pending.set(identity, command);
  try {
    globalThis.sessionStorage?.setItem(identity, JSON.stringify(command));
  } catch {
    /* Reference images and drawings stay out of session storage. */
  }
  const headers = new Headers(init.headers);
  headers.set("idempotency-key", command.key);
  const response = await fetchLike(firstSubmission ? path + "/commit" : path, {
    ...init,
    headers,
  });
  if (firstSubmission && response.ok) {
    // Headers alone do not acknowledge a commit. Read the complete small
    // result before retiring the intent; the caller still consumes its copy.
    // Request drawing bytes are never copied into this receipt check.
    const payload = (await response.clone().json()) as {
      id?: unknown;
      review?: { id?: unknown; entryId?: unknown };
    } | null;
    const id = review ? payload?.review?.id : payload?.id;
    if (
      typeof id !== "string" ||
      !id ||
      (review && payload?.review?.entryId !== review[1])
    )
      throw new Error("Submission was not confirmed. Please try again.");
  }
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
