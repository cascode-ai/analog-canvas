import { planProjectCellImport } from "@icm/edit-engine";
import type { CircuitProject } from "@icm/model";
import { builtInSymbols, findUnsupportedProjectSymbolIds } from "@icm/symbols";

import { stageProjectFile } from "../../document/project-file-service";
import { openCloudProject } from "../editor-shell/cloud-projects";

export type CloudCellImportLoadResult =
  { ok: true; project: CircuitProject } | { ok: false; message: string };

export async function loadCloudProjectForCellImport(
  cloudProjectId: string,
): Promise<CloudCellImportLoadResult> {
  const fetched = await openCloudProject(cloudProjectId);
  if (fetched.status !== "opened") {
    return {
      ok: false,
      message:
        fetched.status === "signed-out"
          ? "Sign in again to import Cloud Project Cells"
          : fetched.status === "not-found"
            ? "That Cloud Project no longer exists"
            : `Could not reach Cloud Projects (${fetched.message})`,
    };
  }
  const staged = await stageProjectFile(
    {
      name: `${fetched.project.name}.icproj.json`,
      text: () => Promise.resolve(fetched.project.projectText),
    },
    (candidate) => findUnsupportedProjectSymbolIds(candidate, builtInSymbols),
  );
  if (staged.status === "rejected") {
    return {
      ok: false,
      message: staged.diagnostics[0]?.message ?? "Cloud Project is invalid",
    };
  }
  return { ok: true, project: staged.project };
}

export function planLoadedCloudCellImport(
  destination: CircuitProject,
  source: CircuitProject,
  sourceDocumentId: string,
) {
  return planProjectCellImport(destination, source, sourceDocumentId);
}
