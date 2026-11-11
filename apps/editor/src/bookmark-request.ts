type PendingBookmark = { key: string; body: string };
const pending = new Map<string, PendingBookmark>();

/** An uncertain Save/Remove keeps its intended state, never another toggle. */
export async function bookmarkRequest(
  id: string,
  account: string,
  saved: boolean,
  expectedVersion: string | null,
  fetchLike: typeof fetch,
): Promise<Response> {
  const storageKey = `canvas-bookmark:${account}:${id}`;
  let command = pending.get(storageKey);
  if (!command)
    try {
      const value = JSON.parse(
        sessionStorage.getItem(storageKey) ?? "null",
      ) as PendingBookmark | null;
      if (
        value &&
        typeof value.key === "string" &&
        typeof value.body === "string"
      )
        command = value;
    } catch {
      /* Storage is optional; in-memory retries still work. */
    }
  command ??= {
    key: crypto.randomUUID(),
    body: JSON.stringify({ accountId: account, saved, expectedVersion }),
  };
  pending.set(storageKey, command);
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(command));
  } catch {
    /* Storage may be unavailable. */
  }
  const response = await fetchLike(
    `/api/gallery/${encodeURIComponent(id)}/bookmark`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        "idempotency-key": command.key,
      },
      body: command.body,
    },
  );
  // A definitive supersession cannot be replayed as a fresh toggle. Its next
  // attempt will use the latest observed revision after the page reloads.
  if (
    response.ok ||
    (response.status >= 400 &&
      response.status < 500 &&
      response.status !== 408 &&
      response.status !== 429)
  ) {
    pending.delete(storageKey);
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      /* In-memory state is enough. */
    }
  }
  return response;
}
