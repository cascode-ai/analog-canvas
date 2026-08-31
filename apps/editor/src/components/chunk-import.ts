/**
 * Guarded dynamic import for on-demand feature chunks.
 *
 * Chunk file names carry content hashes and every deploy replaces the whole
 * asset manifest, so a tab that survived a redeploy asks for names that no
 * longer exist — and the single-page-application fallback answers with
 * index.html, which the browser reports as
 * "Failed to fetch dynamically imported module: …". That string must never
 * be the user's answer; callers catch {@link ChunkLoadError} and show the
 * refresh remedy instead. React.lazy surfaces use `lazyChunk` in
 * app/lazy-editor-dialogs.ts; this is the same contract for plain
 * `await import()` call sites.
 */
export class ChunkLoadError extends Error {
  constructor(
    readonly feature: string,
    override readonly cause: unknown,
  ) {
    super(
      `${feature} could not load — the app has been updated since this tab opened`,
    );
    this.name = "ChunkLoadError";
  }
}

/** One status-bar line: what failed, why, and the remedy. */
export function chunkLoadStatus(feature: string): string {
  return `${feature} could not load — the app has been updated since this tab opened. Refresh to load the new version; your circuit is restored automatically.`;
}

export async function importChunk<T>(
  feature: string,
  load: () => Promise<T>,
): Promise<T> {
  try {
    return await load();
  } catch (error) {
    // The raw failure keeps its stack for diagnosis, off the user's screen.
    console.error(`Chunk for ${feature} failed to load:`, error);
    throw new ChunkLoadError(feature, error);
  }
}
