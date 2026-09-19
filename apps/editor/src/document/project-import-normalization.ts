import {
  normalizeRedundantDirectContactRoutes,
  normalizeSameNetConductorTopology,
  missingPowerMarkerClaims,
  planUndrawnInstancePlacements,
} from "@icm/edit-engine";
import { CircuitProjectSchema } from "@icm/model";
import type { CircuitProject, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import { materializeDefaultInstanceDisplays } from "../features/instance-display/default-instance-display";

export interface ImportedConductorNormalization {
  project: CircuitProject;
  changedDocumentIds: readonly string[];
  /** Instances that reached the canvas because the Document had hidden them. */
  drawnInstanceCount: number;
}

/**
 * Canonicalize legacy conductors, supply-marker ownership, and off-sheet
 * Instances in an imported copy.
 *
 * Project parsing remains byte-preserving and Cloud/recovery opens remain
 * exact. The local File import boundary is the intentional equivalent of an
 * EDA check-and-save repair: changed Documents advance once and advertise a
 * source delta. Marker repair preserves Base-Net membership; proven legacy
 * split Ground markers regain logical node 0 without drawing or merging wires.
 * A Document that still holds an Instance no symbol draws gets that Instance
 * back on the sheet, because a schematic is what it shows.
 */
export function normalizeImportedProject(
  project: CircuitProject,
  resolver: SymbolResolver,
): ImportedConductorNormalization {
  const candidate = structuredClone(project);
  const changedDocumentIds: string[] = [];
  let drawnInstanceCount = 0;
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
    const drawn = drawUndrawnInstances(document, resolver);
    drawnInstanceCount += drawn;
    if (
      !directContacts.changed &&
      !topology.changed &&
      markerClaims.length === 0 &&
      drawn === 0
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
    ? { project, changedDocumentIds, drawnInstanceCount }
    : {
        project: CircuitProjectSchema.parse(candidate),
        changedDocumentIds,
        drawnInstanceCount,
      };
}

/**
 * Places every off-sheet Instance and gives it the same default designator and
 * value projections an ordinary placement writes, so a repaired device is
 * indistinguishable from one drawn by hand.
 */
function drawUndrawnInstances(
  document: SchematicDocument,
  resolver: SymbolResolver,
): number {
  const placements = planUndrawnInstancePlacements(document);
  if (placements.length === 0) return 0;
  const drawn = placements.flatMap(({ instanceId, placement }) => {
    const instance = document.instances.find(
      (candidate) => candidate.id === instanceId,
    );
    if (!instance) return [];
    instance.placement = placement;
    return [instance];
  });
  materializeDefaultInstanceDisplays(document, drawn, resolver);
  return drawn.length;
}
