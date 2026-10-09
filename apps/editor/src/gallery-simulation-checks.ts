/**
 * The Owner's simulation checks (#1545): queue an entry, or every entry with
 * a testbench, for the server to run again on the hosted simulator, and read
 * how the queue stands. The Owner's accounts only; the server refuses the
 * rest.
 */

export interface GallerySimulationCheckQueued {
  queued: string[];
  noTestbench: string[];
  waiting: number;
}

export interface GallerySimulationCheckProgress {
  waiting: number;
  current: { id: string; name: string; folderIndex: number } | null;
  counts: { pass: number; fail: number; error: number; noTestbench: number };
}

/** Queue checks; null when the server refused or could not be reached. */
export async function queueGallerySimulationChecks(
  fetchLike: typeof fetch,
  request: { ids: string[] } | { all: true },
): Promise<GallerySimulationCheckQueued | null> {
  try {
    const response = await fetchLike("/api/gallery/simulation-checks", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    return response.ok
      ? ((await response.json()) as GallerySimulationCheckQueued)
      : null;
  } catch {
    return null;
  }
}

/** How the queue stands; null when it cannot be read. */
export async function loadGallerySimulationChecks(
  fetchLike: typeof fetch,
): Promise<GallerySimulationCheckProgress | null> {
  try {
    const response = await fetchLike("/api/gallery/simulation-checks", {
      credentials: "same-origin",
    });
    return response.ok
      ? ((await response.json()) as GallerySimulationCheckProgress)
      : null;
  } catch {
    return null;
  }
}

/** The queue in one line, for the Owner's sidebar. */
export function gallerySimulationCheckSummary(
  progress: GallerySimulationCheckProgress,
): string {
  const { counts } = progress;
  const checked = `${counts.pass} pass · ${counts.fail} fail · ${counts.error} error · ${counts.noTestbench} without testbench`;
  if (!progress.waiting) return checked;
  return `${progress.waiting} waiting${
    progress.current ? `, checking “${progress.current.name}”` : ""
  } · ${checked}`;
}
