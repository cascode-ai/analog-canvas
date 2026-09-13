import {
  normalizeRedundantDirectContactRoutes,
  normalizeSameNetConductorTopology,
  missingPowerMarkerClaims,
} from "@icm/edit-engine";
import { CircuitProjectSchema } from "@icm/model";
import type { CircuitProject } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

export interface ImportedConductorNormalization {
  project: CircuitProject;
  changedDocumentIds: readonly string[];
}

/**
 * Canonicalize legacy conductors and supply-marker ownership in an imported copy.
 *
 * Project parsing remains byte-preserving and Cloud/recovery opens remain
 * exact. The local File import boundary is the intentional equivalent of an
 * EDA check-and-save repair: changed Documents advance once and advertise a
 * source delta. Marker repair preserves Base-Net membership; proven legacy
 * split Ground markers regain logical node 0 without drawing or merging wires.
 */
export function normalizeImportedProjectConductors(
  project: CircuitProject,
  resolver: SymbolResolver,
): ImportedConductorNormalization {
  const candidate = structuredClone(project);
  const changedDocumentIds: string[] = [];
  for (const document of candidate.documents) {
    const markerClaims = missingPowerMarkerClaims(document, {
      recoverImportedGround: true,
    });
    document.connectivityEvidence.push(...markerClaims);
    const directContacts = normalizeRedundantDirectContactRoutes(
      document,
      resolver,
    );
    const topology = normalizeSameNetConductorTopology(document, resolver);
    if (
      !directContacts.changed &&
      !topology.changed &&
      markerClaims.length === 0
    )
      continue;
    document.revision += 1;
    if (markerClaims.length > 0) {
      document.sourceStatus = "connectivity-modified";
    } else if (document.sourceStatus === "in-sync") {
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
