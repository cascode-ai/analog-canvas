import { resolveCommittedDocumentLogicalNets } from "@icm/derived";
import type { CircuitProject } from "@icm/model";

import {
  analyzeDesignNetlist,
  analyzeDesignNetlistForAuthoring,
  type DesignNetlistAnalysisOptions,
} from "./extract.js";
import { supplyPortRank } from "./extract-ground-pin.js";
import { withNetlistPowerMarkerClaims } from "./extract-nets.js";

/**
 * The name a design netlist writes one Net under, such as `net12` for an
 * unnamed one (2026-10-14): what the editor calls a clicked wire, so it reads
 * as the Netlist panel does. A drawing that does not extract yet answers with
 * its draft's names, as the panel's draft shows them; a Net the netlist
 * leaves out answers null.
 */
export function designNetlistNetName(
  project: CircuitProject,
  documentId: string,
  netId: string,
  options: Pick<DesignNetlistAnalysisOptions, "format" | "namingProfile"> = {},
): string | null {
  const source = project.documents.find(
    (document) => document.id === documentId,
  );
  if (!source) return null;
  // The netlist joins supply markers by name before it names Nets, so the
  // Net it writes is the group that joining makes.
  const logicalId = resolveCommittedDocumentLogicalNets(
    withNetlistPowerMarkerClaims(source, project),
  ).byBaseNetId.get(netId)?.id;
  if (!logicalId) return null;
  const analysisOptions = {
    groundPin: "pin" as const,
    ...options,
    rootDocumentId: documentId,
  };
  for (const analyze of [
    analyzeDesignNetlist,
    analyzeDesignNetlistForAuthoring,
  ]) {
    const name = analyze(project, analysisOptions)
      .ir?.cells.find((cell) => cell.id === documentId)
      ?.nets.find((net) => net.id === logicalId)?.name;
    if (name) return name;
  }
  return null;
}

/**
 * The pins a design netlist writes for one Cell printed as a subcircuit, in
 * order: the Cell's own Pins, each by its first Net, and those the export
 * adds, such as ground's pin or a default supply; `supply` marks the ones
 * the export puts before the signals (#2177). A drawing that does not
 * extract yet answers with its draft's pins; one with no draft, null.
 */
export function designNetlistCellPorts(
  project: CircuitProject,
  documentId: string,
): readonly { id: string; name: string; supply: boolean }[] | null {
  const source = project.documents.find(
    (document) => document.id === documentId,
  );
  if (!source) return null;
  // Read as the export ranks the ports it sorts.
  const logical = resolveCommittedDocumentLogicalNets(
    withNetlistPowerMarkerClaims(source),
  );
  const analysisOptions = {
    groundPin: "pin" as const,
    rootDocumentId: documentId,
  };
  for (const analyze of [
    analyzeDesignNetlist,
    analyzeDesignNetlistForAuthoring,
  ]) {
    const cell = analyze(project, analysisOptions).ir?.cells.find(
      (candidate) => candidate.id === documentId,
    );
    if (cell)
      return cell.ports.map(({ id, name }) => ({
        id,
        name,
        supply: supplyPortRank(logical, { id, name }) < 2,
      }));
  }
  return null;
}
