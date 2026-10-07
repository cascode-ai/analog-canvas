import { ANALYTICS_PERSISTENCE_IDENTITY } from "../apps/editor/analytics/worker";
import { sessionUserOf, type AuthNamespaceLike } from "./auth";
import { sameOrigin } from "./same-origin";

/**
 * Point-in-time recovery of the durable stores. Cloudflare keeps 30 days of
 * every SQLite-backed Durable Object's history; this exposes it to a signed-in
 * administrator. A restore rolls back one whole object — for `gallery` that is
 * the Gallery and every private Cloud Project together — so it is an
 * emergency operation, and it answers an undo bookmark first.
 */

/** The path a store object answers recovery on; the public cannot reach it. */
export const RECOVERY_PATH = "/internal/point-in-time-recovery";

/** The calls recovery needs. Production objects have them; tests may not. */
export type RecoverableState = {
  storage: {
    getCurrentBookmark?(): Promise<string>;
    getBookmarkForTime?(timestamp: number): Promise<string>;
    onNextSessionRestoreBookmark?(bookmark: string): Promise<string>;
  };
  abort?(reason?: string): void;
};

/**
 * Inside a store object: answer the Worker's recovery call, or null for every
 * other request. `GET` answers the current bookmark and, with `?at=`, the one
 * for that time; `POST {bookmark}` arms the
 * restore and returns its undo bookmark, `POST {restart: true}` restarts the
 * object so the armed restore applies.
 */
export async function answerPointInTimeRecovery(
  request: Request,
  state: RecoverableState,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== RECOVERY_PATH) return null;
  const { storage } = state;
  if (
    !storage.getCurrentBookmark ||
    !storage.getBookmarkForTime ||
    !storage.onNextSessionRestoreBookmark ||
    !state.abort
  )
    return Response.json({ error: "recovery-unavailable" }, { status: 501 });
  const body =
    request.method === "POST"
      ? ((await request.json().catch(() => null)) as {
          bookmark?: unknown;
          restart?: unknown;
        } | null)
      : null;
  if (body?.restart === true) {
    // Never caught: aborting resets the object and fails this very call.
    state.abort("point-in-time recovery");
    return Response.json({ restarting: true });
  }
  try {
    if (request.method === "GET") {
      const at = url.searchParams.get("at");
      if (at === null)
        return Response.json({ current: await storage.getCurrentBookmark() });
      const time = Date.parse(at);
      if (!Number.isFinite(time))
        return Response.json({ error: "invalid-time" }, { status: 400 });
      return Response.json({
        bookmark: await storage.getBookmarkForTime(time),
        current: await storage.getCurrentBookmark(),
      });
    }
    if (typeof body?.bookmark !== "string" || body.bookmark === "")
      return Response.json({ error: "bookmark-required" }, { status: 400 });
    return Response.json({
      undoBookmark: await storage.onNextSessionRestoreBookmark(body.bookmark),
    });
  } catch (error) {
    // A time outside the retained 30 days, or a malformed bookmark.
    return Response.json(
      {
        error: "recovery-refused",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 400 },
    );
  }
}

/**
 * A store class that also answers recovery, so each store's own code stays
 * unaware of it. The Worker exports its stores through this.
 */
export function withPointInTimeRecovery<
  Store extends new (
    // A mixin's constructor must accept any arguments (TS2545).
    ...args: any[]
  ) => { fetch(request: Request): Promise<Response> },
>(Base: Store) {
  return class extends Base {
    constructor(...args: any[]) {
      super(...args);
      recoverableStates.set(this, args[0] as RecoverableState);
    }
    override async fetch(request: Request): Promise<Response> {
      return (
        (await answerPointInTimeRecovery(
          request,
          recoverableStates.get(this)!,
        )) ?? super.fetch(request)
      );
    }
  };
}

/** Each wrapped store's state; an exported class cannot carry a private field. */
const recoverableStates = new WeakMap<object, RecoverableState>();

type StoreObject = {
  fetch(input: string, init?: RequestInit): Promise<Response>;
};
type StoreNamespace = { getByName(name: string): StoreObject };

export type RecoveryEnv = {
  AUTH?: AuthNamespaceLike;
  ADMIN_EMAILS?: string;
  ADMIN_EMAILS_EXTRA?: string;
  GALLERY?: StoreNamespace;
  ANALYTICS?: StoreNamespace;
  COMPONENT_LIBRARY?: StoreNamespace;
};

/**
 * The singleton stores that hold durable data, by the name a request uses.
 * The Gallery object also holds every private Cloud Project.
 */
const STORES: Record<string, (env: RecoveryEnv) => StoreObject | undefined> = {
  gallery: (env) => env.GALLERY?.getByName("gallery"),
  accounts: (env) => env.AUTH?.getByName("auth"),
  analytics: (env) =>
    env.ANALYTICS?.getByName(ANALYTICS_PERSISTENCE_IDENTITY.objectName),
  components: (env) => env.COMPONENT_LIBRARY?.getByName("components"),
};

/** `/api/admin/recovery`, or null for every other path. */
export async function routePointInTimeRecovery(
  request: Request,
  env: RecoveryEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/admin/recovery") return null;
  const noStore = { "cache-control": "no-store" };
  if (request.method !== "GET" && request.method !== "POST")
    return Response.json(
      { error: "method-not-allowed" },
      { status: 405, headers: { Allow: "GET, POST", ...noStore } },
    );
  if (request.method === "POST" && !sameOrigin(request))
    return Response.json(
      { error: "forbidden" },
      { status: 403, headers: noStore },
    );
  if ((await sessionUserOf(request, env))?.isAdmin !== true)
    return Response.json(
      { error: "unauthorized" },
      { status: 401, headers: noStore },
    );
  const body =
    request.method === "POST"
      ? ((await request.json().catch(() => null)) as {
          store?: unknown;
          bookmark?: unknown;
          confirm?: unknown;
        } | null)
      : null;
  const store = String(
    request.method === "GET" ? url.searchParams.get("store") : body?.store,
  );
  const object = Object.hasOwn(STORES, store) ? STORES[store]!(env) : undefined;
  if (!object)
    return Response.json(
      { error: "unknown-store", stores: Object.keys(STORES) },
      { status: 400, headers: noStore },
    );
  const target = `https://${store}${RECOVERY_PATH}`;
  if (request.method === "GET") {
    const at = url.searchParams.get("at");
    const response = await object.fetch(
      at === null ? target : `${target}?at=${encodeURIComponent(at)}`,
    );
    return Response.json(
      { store, ...(at === null ? {} : { at }), ...(await response.json()) },
      { status: response.status, headers: noStore },
    );
  }
  // Rolling a store back discards everything written since; the request
  // must name what it restores in words, not only carry a bookmark.
  if (body?.confirm !== `restore ${store}`)
    return Response.json(
      { error: "confirmation-required", confirm: `restore ${store}` },
      { status: 400, headers: noStore },
    );
  const armed = await object.fetch(target, {
    method: "POST",
    body: JSON.stringify({ bookmark: body.bookmark }),
  });
  const result = (await armed.json()) as { undoBookmark?: string };
  if (!armed.ok || !result.undoBookmark)
    return Response.json(result, { status: armed.status, headers: noStore });
  // From here the restore is armed: whatever happens, the answer carries the
  // bookmark that undoes it.
  let restarted = false;
  try {
    await object.fetch(target, {
      method: "POST",
      body: JSON.stringify({ restart: true }),
    });
  } catch {
    // Aborting the object fails the call that asked for it: the expected end.
    restarted = true;
  }
  let current: string | null = null;
  try {
    // A stub that saw its object reset is broken; ask through a new one.
    const response = await STORES[store]!(env)!.fetch(target);
    current = ((await response.json()) as { current?: string }).current ?? null;
  } catch {
    // The object is still starting; the restore has nonetheless applied.
  }
  return Response.json(
    {
      store,
      restoredTo: body.bookmark,
      undoBookmark: result.undoBookmark,
      restarted,
      current,
    },
    { headers: noStore },
  );
}
