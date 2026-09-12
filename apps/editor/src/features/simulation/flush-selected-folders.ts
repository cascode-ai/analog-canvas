import type { ProjectSimulationFolder } from "@icm/model";

export type FolderFlush =
  | { ok: true; folder: ProjectSimulationFolder; revision: number }
  | { ok: false };

/** Capture every selected source before preparing any jobs, carrying the shared revision. */
export async function flushSelectedFolders(
  ids: readonly string[],
  revision: number,
  flush: (id: string, revision: number) => Promise<FolderFlush>,
): Promise<
  | { ok: true; folders: ProjectSimulationFolder[]; revision: number }
  | { ok: false }
> {
  const folders: ProjectSimulationFolder[] = [];
  for (const id of new Set(ids)) {
    const result = await flush(id, revision);
    if (!result.ok) return result;
    folders.push(result.folder);
    revision = result.revision;
  }
  return { ok: true, folders, revision };
}
