import { CircuitProjectSchema, type CircuitProject } from "@icm/model";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";

import { materializeDefaultInstanceDisplays } from "./default-instance-display";

/** Give imported SPICE the same visible Pin and device names as manual import. */
export function withImportedInstanceDisplays(
  project: CircuitProject,
): CircuitProject {
  const candidate = structuredClone(project);
  const resolver = createProjectSymbolResolver(candidate, builtInSymbols);
  let added = 0;
  for (const document of candidate.documents) {
    added += materializeDefaultInstanceDisplays(
      document,
      document.instances,
      resolver,
    );
  }
  return added === 0 ? project : CircuitProjectSchema.parse(candidate);
}
