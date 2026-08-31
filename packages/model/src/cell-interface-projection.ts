import { foldNetName } from "./net-name.js";
import type { CellNetlistInterface } from "./schema.js";

export type CellPortDirection = "input" | "output" | "inout" | "passive";

/**
 * One consumer-facing Cell port derived from independently authored canvas
 * Pin declarations. The first declaration supplies stable ordering, spelling,
 * and the representative ID for this projection; all member identities remain
 * available to consumers that need to inspect the underlying authored facts.
 */
export interface ProjectedFormalCellPort {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly direction: CellPortDirection;
  readonly terminalIds: readonly string[];
  readonly netIds: readonly string[];
  readonly interfaceInstanceIds: readonly string[];
}

export interface CellPortDirectionConflict {
  readonly code: "CELL_PORT_DIRECTION_CONFLICT";
  readonly portKey: string;
  readonly portName: string;
  readonly terminalIds: readonly string[];
  readonly directions: readonly CellPortDirection[];
}

export type CellInterfaceProjectionIssue = CellPortDirectionConflict;

export interface CellInterfaceProjection {
  readonly ports: readonly ProjectedFormalCellPort[];
  readonly issues: readonly CellInterfaceProjectionIssue[];
}

interface MutablePortGroup {
  id: string;
  key: string;
  name: string;
  direction: CellPortDirection;
  terminalIds: string[];
  netIds: string[];
  interfaceInstanceIds: string[];
  directions: CellPortDirection[];
}

/**
 * Project independently authored Cell Pins into the formal interface consumed
 * by hierarchy symbols and netlist export. Equal folded names share one
 * transient formal port. The source declarations and their Base Nets are never
 * rewritten or physically merged; the Logical-Net resolver interprets their
 * shared Port name as electrical identity.
 */
export function projectCellInterface(
  netlist: CellNetlistInterface | undefined,
): CellInterfaceProjection {
  if (!netlist) return { ports: [], issues: [] };

  const groups: MutablePortGroup[] = [];
  const groupByKey = new Map<string, MutablePortGroup>();
  for (const terminal of netlist.terminals) {
    const key = foldNetName(terminal.name);
    const existing = groupByKey.get(key);
    if (!existing) {
      const group: MutablePortGroup = {
        id: terminal.id,
        key,
        name: terminal.name,
        direction: terminal.direction,
        terminalIds: [terminal.id],
        netIds: [terminal.netId],
        interfaceInstanceIds: [...terminal.interfaceInstanceIds],
        directions: [terminal.direction],
      };
      groups.push(group);
      groupByKey.set(key, group);
      continue;
    }

    existing.terminalIds.push(terminal.id);
    existing.netIds.push(terminal.netId);
    existing.interfaceInstanceIds.push(...terminal.interfaceInstanceIds);
    if (!existing.directions.includes(terminal.direction)) {
      existing.directions.push(terminal.direction);
      existing.direction = "passive";
    }
  }

  return {
    ports: groups.map(({ directions: _directions, ...port }) => port),
    issues: groups.flatMap((group) =>
      group.directions.length > 1
        ? [
            {
              code: "CELL_PORT_DIRECTION_CONFLICT" as const,
              portKey: group.key,
              portName: group.name,
              terminalIds: [...group.terminalIds],
              directions: [...group.directions],
            },
          ]
        : [],
    ),
  };
}
