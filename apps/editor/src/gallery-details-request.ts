type PendingDetails = { body: string; key: string };
const pending = new Map<string, PendingDetails>();

/** A retry after a lost reply/reload reconciles the same metadata command. */
export async function galleryDetailsRequest(
  id: string,
  account: string,
  details: { name: string; description: string },
  fetchLike: typeof fetch,
): Promise<Response> {
  const storageKey = `canvas-gallery-details:${account}:${id}`;
  const body = JSON.stringify(details);
  let previous = pending.get(storageKey);
  if (!previous) {
    try {
      const stored: unknown = JSON.parse(
        sessionStorage.getItem(storageKey) ?? "null",
      );
      if (
        stored &&
        typeof stored === "object" &&
        "body" in stored &&
        "key" in stored &&
        typeof stored.body === "string" &&
        typeof stored.key === "string"
      )
        previous = stored as PendingDetails;
    } catch {
      /* Storage may be unavailable. */
    }
  }
  const command =
    previous?.body === body ? previous : { body, key: crypto.randomUUID() };
  pending.set(storageKey, command);
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(command));
  } catch {
    /* In-memory retry remains. */
  }
  const response = await fetchLike(`/api/gallery/${encodeURIComponent(id)}`, {
    method: "PATCH",
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      "idempotency-key": command.key,
    },
    body,
  });
  // A conflict/auth refusal may follow an earlier committed but unanswered
  // attempt. Only success or explicitly changed content ends that identity.
  if (response.ok) {
    pending.delete(storageKey);
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      /* Storage may be unavailable. */
    }
  }
  return response;
}
