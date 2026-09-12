import {
  readSimulationExperimentConfig,
  type ProjectSimulationFolder,
} from "@icm/model";

/** Hide only valid machine metadata, never a legacy setting or a repair draft. */
export function isVisibleSimulationSource(
  folder: ProjectSimulationFolder,
  path: string,
  hasDraft = false,
): boolean {
  if (
    path !== folder.input.configPath ||
    path === folder.input.entry ||
    hasDraft ||
    folder.input.drafts?.some((draft) => draft.path === path)
  )
    return true;
  const config = readSimulationExperimentConfig(folder);
  return !config.ok || config.authority !== "code";
}
