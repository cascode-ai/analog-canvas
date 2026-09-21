import { createId, type CircuitProject } from "@icm/model";
import { parseProject } from "@icm/project-protocol";

export async function loadGalleryVersionProject(
  entryId: string,
  versionId?: string,
  fetchLike: typeof fetch = fetch,
): Promise<CircuitProject> {
  const path = `/api/gallery/${encodeURIComponent(entryId)}${versionId ? `/versions/${encodeURIComponent(versionId)}/project` : ""}`;
  const response = await fetchLike(path, {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok)
    throw new Error(
      "This snapshot is unavailable. It may have expired, or you may need to sign in as its owner.",
    );
  const payload = (await response.json()) as { projectText?: unknown };
  if (typeof payload.projectText !== "string")
    throw new Error("This snapshot does not contain a Project.");
  return parseProject(payload.projectText);
}

/** New persistence identity; all authored circuit/source/definition data stays intact. */
export function branchGalleryVersion(
  project: CircuitProject,
  versionNo: number,
): CircuitProject {
  return {
    ...structuredClone(project),
    id: createId("project"),
    name: `${project.name} · branch v${versionNo}`,
    structureRevision: 0,
  };
}

export function galleryVersionBranchUrl(
  entryId: string,
  versionId: string,
  versionNo: number,
): string {
  return `/editor?${new URLSearchParams({ history: entryId, version: versionId, versionNo: String(versionNo) })}`;
}
