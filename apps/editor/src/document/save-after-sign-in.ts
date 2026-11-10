/**
 * A Save the person asked for while signed out continues once they have
 * signed in (#2161). An email sign-in reloads the editor; GitHub and Google
 * end on the Gallery, so a choice of either also brings this window back to
 * the editor, whose tabs it then resumes. No imports: the page entry reads
 * this before anything loads.
 */
const PENDING_KEY = "icm.save-after-sign-in";
const RETURN_KEY = "icm.save-after-sign-in.return";
const PENDING_FOR_MS = 15 * 60_000;

type SessionStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function write(storage: SessionStore, key: string, value: object): void {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Without storage the person presses Save again after signing in.
  }
}

/** A stored record and whether it is recent enough to act on. */
function read(
  storage: SessionStore,
  key: string,
  now: number,
): { record: Record<string, unknown>; fresh: boolean } | null {
  try {
    const raw = storage.getItem(key);
    if (raw === null) return null;
    const record = JSON.parse(raw) as Record<string, unknown>;
    const fresh =
      typeof record.at === "number" && now - record.at <= PENDING_FOR_MS;
    return { record, fresh };
  } catch {
    return null;
  }
}

function forget(storage: SessionStore, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // Nothing kept, nothing to forget.
  }
}

/** Remembers the Save of this Project for when this window is signed in. */
export function rememberSaveOnSignIn(
  projectId: string,
  page: Pick<Document, "addEventListener" | "removeEventListener"> = document,
  storage: SessionStore = sessionStorage,
  clock: () => number = Date.now,
): void {
  write(storage, PENDING_KEY, { projectId, at: clock() });
  const chose = (event: Event) => {
    const target = event.target as Partial<Element> | null;
    if (!target?.closest?.('a[href^="/api/auth/"]')) return;
    write(storage, RETURN_KEY, { at: clock() });
    page.removeEventListener("click", chose, { capture: true });
  };
  page.addEventListener("click", chose, { capture: true });
}

/** Whether a Save of this Project waits for the sign-in; true answers it. */
export function takePendingSave(
  projectId: string,
  storage: SessionStore = sessionStorage,
  now = Date.now(),
): boolean {
  const pending = read(storage, PENDING_KEY, now);
  if (!pending) return false;
  // Another tab's Save keeps waiting for that tab while it is recent.
  if (pending.fresh && pending.record.projectId !== projectId) return false;
  forget(storage, PENDING_KEY);
  return pending.fresh;
}

/**
 * Where the Gallery's page load goes instead, if anywhere: back to the
 * editor after a GitHub or Google sign-in begun from a Save.
 */
export function saveAfterSignInRedirect(
  location: Pick<Location, "pathname">,
  storage: SessionStore = sessionStorage,
  now = Date.now(),
): string | null {
  if (!/^\/?$/u.test(location.pathname)) return null;
  const chosen = read(storage, RETURN_KEY, now);
  if (!chosen) return null;
  forget(storage, RETURN_KEY);
  return chosen.fresh ? "/editor?resume=1" : null;
}
