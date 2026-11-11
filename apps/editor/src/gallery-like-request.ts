/** Persist the prepared intent before sending a mutation, even if the next retry changes region. */
type PendingLike = { key: string; command?: Record<string, unknown> };
const pending = new Map<string, PendingLike>();
const inFlight = new Map<string, Promise<Response>>();
const prefix = "canvas-gallery-like:";

function save(path: string, value: PendingLike | null) {
  if (value) pending.set(path, value);
  else pending.delete(path);
  try {
    if (value)
      globalThis.sessionStorage?.setItem(prefix + path, JSON.stringify(value));
    else globalThis.sessionStorage?.removeItem(prefix + path);
  } catch {
    /* Memory retains retries when storage is unavailable. */
  }
}

function read(path: string): PendingLike {
  const current = pending.get(path);
  if (current) return current;
  try {
    const stored = JSON.parse(
      globalThis.sessionStorage?.getItem(prefix + path) ?? "null",
    ) as PendingLike | null;
    if (
      stored &&
      typeof stored.key === "string" &&
      /^[A-Za-z0-9_-]{1,128}$/.test(stored.key)
    )
      return stored;
  } catch {
    /* Missing or unavailable session storage starts a new intent. */
  }
  return { key: crypto.randomUUID() };
}

export async function galleryLikeRequest(
  id: string,
  take = false,
  fetchLike: typeof fetch = fetch,
): Promise<Response> {
  const path = `/api/gallery/${encodeURIComponent(id)}/like`,
    query = take ? "?take=1" : "",
    identity = path + query;
  const running = inFlight.get(identity);
  if (running) return (await running).clone();
  const run = async () => {
    const intent = read(identity);
    save(identity, intent);
    const headers = {
      "idempotency-key": intent.key,
      "content-type": "application/json",
    };
    if (!intent.command) {
      const prepared = await fetchLike(path + "/intent" + query, {
        method: "POST",
        credentials: "same-origin",
        headers,
      });
      if (prepared.status !== 404) {
        if (!prepared.ok) return prepared;
        const command = (await prepared.json().catch(() => null)) as Record<
          string,
          unknown
        > | null;
        if (
          !command ||
          command.entryId !== id ||
          command.commandId !== intent.key
        )
          return Response.json(
            { error: "invalid-like-intent" },
            { status: 502 },
          );
        intent.command = command;
        save(identity, intent);
      }
    }
    const response = await fetchLike(identity, {
      method: "POST",
      credentials: "same-origin",
      headers,
      ...(intent.command
        ? { body: JSON.stringify({ command: intent.command }) }
        : {}),
    });
    if (response.ok || [400, 403, 404, 409, 429].includes(response.status))
      save(identity, null);
    return response;
  };
  const promise = run();
  inFlight.set(identity, promise);
  try {
    return (await promise).clone();
  } finally {
    inFlight.delete(identity);
  }
}
