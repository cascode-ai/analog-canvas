import { resolveCommittedDocumentLogicalNets } from "@icm/derived";
import type { CircuitProject } from "@icm/model";

import {
  analyzeDesignNetlist,
  analyzeDesignNetlistForAuthoring,
  type DesignNetlistAnalysisOptions,
} from "./extract.js";
import { analysisPortRows } from "./extract-interface.js";
import { sortsSupplyPorts, supplyPortRank } from "./extract-ground-pin.js";
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
  return (
    designNetlistNetNames(project, documentId, [netId], options).get(netId) ??
    null
  );
}

/** Read the selected Nets' names with one analysis of the Cell per mode. */
export function designNetlistNetNames(
  project: CircuitProject,
  documentId: string,
  netIds: readonly string[],
  options: Pick<DesignNetlistAnalysisOptions, "format" | "namingProfile"> = {},
): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  if (netIds.length === 0) return names;
  const source = project.documents.find(
    (document) => document.id === documentId,
  );
  if (!source) return names;
  // The netlist joins supply markers by name before it names Nets, so the
  // Net it writes is the group that joining makes.
  const logical = resolveCommittedDocumentLogicalNets(
    withNetlistPowerMarkerClaims(source, project),
  );
  const pending = new Map<string, string>();
  for (const netId of netIds) {
    const logicalId = logical.byBaseNetId.get(netId)?.id;
    if (logicalId) pending.set(netId, logicalId);
  }
  const analysisOptions = {
    groundPin: "pin" as const,
    ...options,
    rootDocumentId: documentId,
  };
  for (const analyze of [
    analyzeDesignNetlist,
    analyzeDesignNetlistForAuthoring,
  ]) {
    if (pending.size === 0) break;
    const cell = analyze(project, analysisOptions).ir?.cells.find(
      ({ id }) => id === documentId,
    );
    if (!cell) continue;
    const namesById = new Map(cell.nets.map(({ id, name }) => [id, name]));
    for (const [netId, logicalId] of pending) {
      const name = namesById.get(logicalId);
      if (!name) continue;
      names.set(netId, name);
      pending.delete(netId);
    }
  }
  return names;
}

/**
 * The pins a design netlist writes for one Cell printed as a subcircuit, in
 * order: the Cell's own Pins, each by its first Net, and those the export
 * adds, such as ground's pin or a default supply; `supply` marks the ones
 * the export puts before the signals (#2177). A drawing that does not
 * extract yet answers with its draft's pins; one with no draft, null.
 */
export interface DesignNetlistCellPort {
  /** Representative Net ID used by existing callers. */
  readonly id: string;
  readonly name: string;
  readonly supply: boolean;
  /** The authored Port row, shared by all printed members of a bus. */
  readonly portId?: string;
}

export function designNetlistCellPorts(
  project: CircuitProject,
  documentId: string,
): readonly DesignNetlistCellPort[] | null {
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
  // A Cell read from a file keeps its own Pins where the file has them; the
  // supplies the export adds still take their places.
  for (const analyze of [
    analyzeDesignNetlist,
    analyzeDesignNetlistForAuthoring,
  ]) {
    const analysis = analyze(project, analysisOptions);
    const cell = analysis.ir?.cells.find(
      (candidate) => candidate.id === documentId,
    );
    if (cell) {
      const rows = analysisPortRows.get(analysis)?.get(cell.id);
      return cell.ports.map((port, index) => {
        const portId = rows?.[index];
        return {
          id: port.id,
          name: port.name,
          supply:
            supplyPortRank(logical, port) < 2 &&
            (sortsSupplyPorts(source) || portId === undefined),
          ...(portId === undefined ? {} : { portId }),
        };
      });
    }
  }
  return null;
}
