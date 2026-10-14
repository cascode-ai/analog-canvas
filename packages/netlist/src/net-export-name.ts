import { resolveCommittedDocumentLogicalNets } from "@icm/derived";
import type { CircuitProject } from "@icm/model";

import {
  analyzeDesignNetlist,
  analyzeDesignNetlistForAuthoring,
  type DesignNetlistAnalysisOptions,
} from "./extract.js";
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
