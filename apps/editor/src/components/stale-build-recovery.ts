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

export type ModuleLoadDiagnosis =
  | {
      kind: "stale-build";
      assetUrl: string;
      status: 404;
    }
  | {
      kind: "temporary";
      assetUrl: string | null;
      status?: number;
    };

export interface ModuleLoadProbeSurfaces {
  readonly currentUrl: string;
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export class ConfirmedStaleBuildError extends Error {
  override readonly name = "ConfirmedStaleBuildError";

  constructor(
    readonly assetUrl: string,
    override readonly cause: unknown,
  ) {
    super(`This build can no longer load ${new URL(assetUrl).pathname}`);
  }
}

export class TemporaryModuleLoadError extends Error {
  override readonly name = "TemporaryModuleLoadError";

  constructor(
    readonly assetUrl: string | null,
    override readonly cause: unknown,
  ) {
    super(
      assetUrl === null
        ? "A required editor file was temporarily unavailable"
        : `A required editor file was temporarily unavailable: ${new URL(assetUrl).pathname}`,
    );
  }
}

export interface StaleBuildRecoverySurfaces {
  readonly caches?: CacheStorage;
  readonly serviceWorker?: ServiceWorkerContainer;
  reload(): void;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function moduleAssetUrl(error: unknown, currentUrl: string): string | null {
  const match = messageOf(error).match(
    /(?:https?:\/\/[^\s"'<>]+|\/assets\/[^\s"'<>]+\.js(?:\?[^\s"'<>]*)?)/u,
  );
  if (!match) return null;
  try {
    const current = new URL(currentUrl);
    const asset = new URL(match[0], current);
    if (
      asset.origin !== current.origin ||
      !asset.pathname.startsWith("/assets/") ||
      !asset.pathname.endsWith(".js")
    ) {
      return null;
    }
    return asset.toString();
  } catch {
    return null;
  }
}

/**
 * Probe the file named by a dynamic-import failure before blaming a deploy.
 * The browser uses the same error text for a retired chunk, a network outage,
 * and a temporarily unavailable current chunk. Only an observed 404 proves
 * that this document names a file the active deployment no longer has.
 */
export async function diagnoseModuleLoadFailure(
  error: unknown,
  surfaces: ModuleLoadProbeSurfaces,
): Promise<ModuleLoadDiagnosis> {
  const assetUrl = moduleAssetUrl(error, surfaces.currentUrl);
  if (assetUrl === null) return { kind: "temporary", assetUrl: null };
  try {
    const response = await surfaces.fetch(assetUrl, {
      method: "HEAD",
      cache: "no-store",
      credentials: "same-origin",
    });
    if (response.status === 404) {
      return { kind: "stale-build", assetUrl, status: 404 };
    }
    return {
      kind: "temporary",
      assetUrl,
      status: response.status,
    };
  } catch {
    return { kind: "temporary", assetUrl };
  }
}

/** Whether a failure has been confirmed as a missing chunk, not guessed. */
export function isStaleBuildFailure(error: unknown): boolean {
  return error instanceof ConfirmedStaleBuildError;
}

export function isTemporaryModuleLoadFailure(error: unknown): boolean {
  return error instanceof TemporaryModuleLoadError;
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
