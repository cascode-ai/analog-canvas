/** Keep an uncertain command's identity across retries, including a page reload. */
const pending = new Map<string, string>();
const prefix = "canvas-gallery-lifecycle:";
type LifecycleAction = "recycle" | "restore" | "delete";
const pathOf = (id: string, action: LifecycleAction) =>
  `/api/gallery/${id}${action === "delete" ? "" : "/" + action}`;

function stored(path: string): string | null {
  try {
    return globalThis.sessionStorage?.getItem(prefix + path) ?? null;
  } catch {
    return null;
  }
}

export async function galleryLifecycleRequest(
  id: string,
  action: LifecycleAction,
  fetchLike: typeof fetch = fetch,
): Promise<Response> {
  const path = pathOf(id, action);
  const key = pending.get(path) ?? stored(path) ?? crypto.randomUUID();
  pending.set(path, key);
  try {
    globalThis.sessionStorage?.setItem(prefix + path, key);
  } catch {
    /* In-memory retry still works. */
  }
  const response = await fetchLike(path, {
    method: action === "delete" ? "DELETE" : "POST",
    credentials: "same-origin",
    headers: { "idempotency-key": key },
  });
  if (response.ok || response.status < 500) {
    const completed: LifecycleAction[] = response.ok
      ? ["recycle", "restore", "delete"]
      : [action];
    for (const next of completed) {
      const done = pathOf(id, next);
      pending.delete(done);
      try {
        globalThis.sessionStorage?.removeItem(prefix + done);
      } catch {
        /* Storage can be disabled. */
      }
    }
  }
  return response;
}
