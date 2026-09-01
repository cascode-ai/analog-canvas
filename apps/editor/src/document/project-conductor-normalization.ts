import {
  normalizeRedundantDirectContactRoutes,
  normalizeSameNetConductorTopology,
} from "@icm/edit-engine";
import { CircuitProjectSchema } from "@icm/model";
import type { CircuitProject } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

export interface ImportedConductorNormalization {
  project: CircuitProject;
  changedDocumentIds: readonly string[];
}

/**
 * Canonicalize legacy ordinary-Wire geometry in one explicitly imported copy.
 *
 * Project parsing remains byte-preserving and Cloud/recovery opens remain
 * exact. The local File import boundary is the intentional equivalent of an
 * EDA check-and-save repair: changed Documents advance once and advertise a
 * geometry-only source delta without changing electrical Net membership.
 */
export function normalizeImportedProjectConductors(
  project: CircuitProject,
  resolver: SymbolResolver,
): ImportedConductorNormalization {
  const candidate = structuredClone(project);
  const changedDocumentIds: string[] = [];
  for (const document of candidate.documents) {
    const directContacts = normalizeRedundantDirectContactRoutes(
      document,
      resolver,
    );
    const topology = normalizeSameNetConductorTopology(document, resolver);
    if (!directContacts.changed && !topology.changed) continue;
    document.revision += 1;
    if (document.sourceStatus === "in-sync") {
      document.sourceStatus = "geometry-only-changed";
    }
    changedDocumentIds.push(document.id);
  }
  return changedDocumentIds.length === 0
    ? { project, changedDocumentIds }
    : {
        project: CircuitProjectSchema.parse(candidate),
        changedDocumentIds,
      };
}
