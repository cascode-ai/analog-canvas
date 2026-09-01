/**
 * Get a page out of a build it can no longer load.
 *
 * A tab holds a document that names content-hashed chunks. Once a deploy
 * replaces them, that document can never boot again: the chunk it asks for
 * is gone, and an ordinary reload can hand back the same document from a
 * cache, so the person sees the same failure a second time and has no way
 * out. Reported as issue #493, where a fresh visit to /editor could not open
 * the editor at all because the failing chunk was the app itself.
 *
 * Recovery discards what this build cached — the shell caches this app
 * installed, and the service worker registration that serves them — and then
 * reloads. Nothing here touches a Project: recovery copies live in
 * IndexedDB, which is deliberately not cleared.
 */
const SHELL_CACHE_PREFIX = "icm-static-shell-";

export interface StaleBuildRecoverySurfaces {
  readonly caches?: CacheStorage;
  readonly serviceWorker?: ServiceWorkerContainer;
  reload(): void;
}

/** Whether a failure looks like a chunk this build can no longer fetch. */
export function isStaleBuildFailure(message: string): boolean {
  const text = message.toLowerCase();
  return (
    text.includes("dynamically imported module") ||
    text.includes("failed to fetch dynamically") ||
    text.includes("importing a module script failed") ||
    text.includes("has been updated since this tab opened")
  );
}

export async function recoverFromStaleBuild(
  surfaces: StaleBuildRecoverySurfaces,
): Promise<void> {
  try {
    const keys = (await surfaces.caches?.keys()) ?? [];
    await Promise.all(
      keys
        .filter((key) => key.startsWith(SHELL_CACHE_PREFIX))
        .map((key) => surfaces.caches!.delete(key)),
    );
  } catch (error) {
    // A browser that refuses cache access still deserves the reload.
    console.error("Could not clear the stale shell cache:", error);
  }
  try {
    const registrations =
      (await surfaces.serviceWorker?.getRegistrations()) ?? [];
    await Promise.all(
      registrations.map((registration) => registration.unregister()),
    );
  } catch (error) {
    console.error("Could not unregister the stale service worker:", error);
  }
  surfaces.reload();
}

/** The browser-backed surfaces, for callers that have no reason to inject. */
export function browserStaleBuildRecovery(): StaleBuildRecoverySurfaces {
  return {
    ...(typeof caches !== "undefined" ? { caches } : {}),
    ...(typeof navigator !== "undefined" && "serviceWorker" in navigator
      ? { serviceWorker: navigator.serviceWorker }
      : {}),
    reload: () => window.location.reload(),
  };
}
