import {
  foldNetName,
  projectCellInterface,
  scalarCellTerminals,
  type ProjectedFormalCellPort,
  type SchematicDocument,
} from "@icm/model";
import { resolveCommittedDocumentLogicalNets } from "@icm/derived";

import type { ResolvedDesignNetlistAnalysisOptions } from "./extract-common.js";
import {
  pinsGround,
  sortsSupplyPorts,
  supplyPortRank,
} from "./extract-ground-pin.js";
import { withNetlistPowerMarkerClaims } from "./extract-nets.js";
import { phaseNetId } from "./extract-switch.js";
import type { DesignNetlistAnalysisResult, DesignNetlistCell } from "./ir.js";

type Port = DesignNetlistCell["ports"][number];
type PortSource =
  | { kind: "pin"; port: ProjectedFormalCellPort; rowId: string | undefined }
  | { kind: "ground"; pinName: string }
  | { kind: "phase" };

export function prepareCellInterface(
  document: SchematicDocument,
  source: SchematicDocument,
) {
  const netlist = document.netlist;
  const terminals = scalarCellTerminals(netlist);
  const scalarByName = new Map<string, (typeof terminals)[number]>();
  for (const terminal of terminals) {
    const key = foldNetName(terminal.name);
    if (!scalarByName.has(key)) scalarByName.set(key, terminal);
  }
  const rowByName = new Map(
    projectCellInterface(source.netlist).ports.map(({ key, id }) => [key, id]),
  );
  return {
    authored: projectCellInterface(netlist && { ...netlist, terminals }),
    scalarByName,
    rowByName,
    sources: new Map<Port, PortSource>(),
    childByCaller: new Map<string, string>(),
    groundNode: "0",
  };
}

export type CellInterface = ReturnType<typeof prepareCellInterface>;

// Properties uses formal positions while the printable IR retains its Net IDs.
export const analysisPortRows = new WeakMap<
  DesignNetlistAnalysisResult,
  ReturnType<typeof finalizeCellInterfaces>
>();

/** A declaration owns the positions its callers pass. Until the child
 * interface is ready, callers hold the resolved arguments by formal identity. */
export function finalizeCellInterfaces(
  cells: readonly DesignNetlistCell[],
  documentsById: ReadonlyMap<string, SchematicDocument>,
  interfaces: ReadonlyMap<string, CellInterface>,
  options: ResolvedDesignNetlistAnalysisOptions,
) {
  const cellsById = new Map(cells.map((cell) => [cell.id, cell]));
  const rowsByCellId = new Map<string, readonly (string | undefined)[]>();
  const visited = new Set<string>();
  const visit = (cell: DesignNetlistCell) => {
    if (visited.has(cell.id)) return;
    visited.add(cell.id);
    const draft = interfaces.get(cell.id)!;
    const atTop = options.rootAsTopLevel && cell.id === options.rootDocumentId;
    for (const instance of cell.instances) {
      const childId = draft.childByCaller.get(instance.id);
      const child = childId && cellsById.get(childId);
      if (!child) continue;
      const childDraft = interfaces.get(child.id)!;
      visit(child);
      // Formal IDs can repeat across owners (a scalar and a bus member).
      // Both sides refer to the same port in the canonical scalar projection.
      const byPort = new Map(
        childDraft.authored.ports.map((port, index) => [
          port,
          instance.nodes[index],
        ]),
      );

      // An undriven phase propagates in discovery order, independent of
      // supply ordering. A deck's top gives it a node but no formal pin.
      const phases = new Map<string, string>();
      for (const [port, source] of childDraft.sources) {
        if (source.kind !== "phase") continue;
        const folded = port.name.toLowerCase();
        let net = cell.nets.find(
          (candidate) => candidate.name.toLowerCase() === folded,
        );
        if (!net) {
          net = {
            id: phaseNetId(cell.id, port.name),
            name: port.name,
            scope: "local",
          };
          cell.nets.push(net);
          if (!atTop) {
            const phase = { id: net.id, name: port.name, netName: net.name };
            cell.ports.push(phase);
            draft.sources.set(phase, { kind: "phase" });
          }
        }
        phases.set(port.name, net.name);
      }

      instance.nodes = child.ports.map((port) => {
        const source = childDraft.sources.get(port)!;
        switch (source.kind) {
          case "pin":
            return (
              byPort.get(source.port) ?? {
                pinName: port.name,
                netName: `<unconnected:${port.name}>`,
              }
            );
          case "ground":
            return { pinName: source.pinName, netName: draft.groundNode };
          case "phase":
            return { pinName: port.name, netName: phases.get(port.name)! };
        }
      });
    }
    if (!atTop && pinsGround(options.groundPin)) {
      const document = documentsById.get(cell.id)!;
      const logical = resolveCommittedDocumentLogicalNets(
        withNetlistPowerMarkerClaims(document),
      );
      const rank = (port: Port) => supplyPortRank(logical, port);
      for (const port of cell.ports) {
        if (rank(port) === 2) continue;
        const net = cell.nets.find(
          (candidate) => candidate.name === port.netName,
        );
        if (net) net.scope = "local";
      }
      if (sortsSupplyPorts(document))
        cell.ports.sort((left, right) => rank(left) - rank(right));
    }
    rowsByCellId.set(
      cell.id,
      cell.ports.map((port) => {
        const source = draft.sources.get(port);
        return source?.kind === "pin" ? source.rowId : undefined;
      }),
    );
  };
  for (const cell of cells) visit(cell);
  return rowsByCellId;
}
