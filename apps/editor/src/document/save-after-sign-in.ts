/**
 * A Save the person asked for while signed out continues once they have
 * signed in (#2161). An email sign-in reloads the editor and a regional one
 * returns to it; GitHub and Google end on the Gallery, so a choice of either
 * also marks this window to go back to the editor, whose tabs it then
 * resumes. No imports: the page entry reads this before anything loads.
 */
const PENDING_KEY = "icm.save-after-sign-in";
const RETURN_KEY = "icm.save-after-sign-in.return";
const PENDING_FOR_MS = 15 * 60_000;
/** The page's sign-in choices (AccountMenuView), closing unchosen. */
const SIGN_IN_CHOICES = "details.account-signin";
/** Stops listening for the Save that waits now; one at a time. */
let stopListening: () => void = () => {};

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

/** Forgets the waiting Save and its way back: it will not happen. */
export function forgetSaveOnSignIn(
  storage: SessionStore = sessionStorage,
): void {
  forget(storage, PENDING_KEY);
  forget(storage, RETURN_KEY);
}

/**
 * Remembers the Save of this Project for when this window is signed in.
 * Choosing GitHub or Google (a link into /api/auth/) marks the way back;
 * closing the sign-in choices without one forgets the Save. Returns what
 * stops listening, which a timer also does once the Save is too old.
 */
export function rememberSaveOnSignIn(
  projectId: string,
  page: Pick<Document, "addEventListener" | "removeEventListener"> = document,
  storage: SessionStore = sessionStorage,
  clock: () => number = Date.now,
  timers: {
    set(handler: () => void, ms: number): unknown;
    clear(timer: unknown): void;
  } = {
    set: (handler, ms) => window.setTimeout(handler, ms),
    clear: (timer) => window.clearTimeout(timer as number),
  },
): () => void {
  // A second Sign in replaces the first.
  stopListening();
  write(storage, PENDING_KEY, { projectId, at: clock() });
  forget(storage, RETURN_KEY);
  const chose = (event: Event) => {
    const target = event.target as Partial<Element> | null;
    if (!target?.closest?.('a[href^="/api/auth/"]')) return;
    write(storage, RETURN_KEY, { at: clock() });
    stop();
  };
  // `toggle` does not bubble, so it is heard on its way down.
  const declined = (event: Event) => {
    const target = event.target as Partial<HTMLDetailsElement> | null;
    if (!target?.matches?.(SIGN_IN_CHOICES) || target.open) return;
    forgetSaveOnSignIn(storage);
    stop();
  };
  const timer = timers.set(() => stop(), PENDING_FOR_MS);
  function stop(): void {
    page.removeEventListener("click", chose, { capture: true });
    page.removeEventListener("toggle", declined, { capture: true });
    timers.clear(timer);
    if (stopListening === stop) stopListening = () => {};
  }
  page.addEventListener("click", chose, { capture: true });
  page.addEventListener("toggle", declined, { capture: true });
  stopListening = stop;
  return stop;
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
  forgetSaveOnSignIn(storage);
  return pending.fresh;
}

/**
 * Where the Gallery's page load goes instead, if anywhere: back to the
 * editor after a GitHub or Google sign-in begun from a Save that still
 * waits, a failed one included so the editor can say so.
 */
export function saveAfterSignInRedirect(
  location: Pick<Location, "pathname" | "search">,
  storage: SessionStore = sessionStorage,
  now = Date.now(),
): string | null {
  if (!/^\/?$/u.test(location.pathname)) return null;
  const chosen = read(storage, RETURN_KEY, now);
  if (!chosen) return null;
  forget(storage, RETURN_KEY);
  const pending = read(storage, PENDING_KEY, now);
  if (!chosen.fresh || !pending?.fresh) {
    forget(storage, PENDING_KEY);
    return null;
  }
  return new URLSearchParams(location.search).get("auth") === "failed"
    ? "/editor?resume=1&auth=failed"
    : "/editor?resume=1";
}

/**
 * The editor has opened: whatever sign-in was begun ended here or went
 * nowhere, so the way back is spent. A failed sign-in also ends the Save
 * it was for; the caller shows the sign-in choices, which say it failed.
 * Returns whether that is so.
 */
export function settleSaveOnEditorOpen(
  location: Pick<Location, "search">,
  storage: SessionStore = sessionStorage,
): { signInFailed: boolean } {
  forget(storage, RETURN_KEY);
  const signInFailed =
    new URLSearchParams(location.search).get("auth") === "failed";
  if (signInFailed) forget(storage, PENDING_KEY);
  return { signInFailed };
}
