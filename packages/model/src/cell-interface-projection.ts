import { foldNetName } from "./net-name.js";
import type { CellNetlistInterface, CellNetlistTerminal } from "./schema.js";

export type CellPortDirection = "input" | "output" | "inout" | "passive";

/** Scalar interface view for electrical consumers; symbols keep the aggregate declarations. */
export function scalarCellTerminals(
  netlist: CellNetlistInterface | undefined,
): Array<
  CellNetlistTerminal & { aggregateName: string; memberId: string | undefined }
> {
  return (netlist?.terminals ?? []).flatMap<
    CellNetlistTerminal & {
      aggregateName: string;
      memberId: string | undefined;
    }
  >((terminal) =>
    terminal.signal && terminal.signal.members.length > 1
      ? terminal.signal.members.map((member) => ({
          ...terminal,
          id: member.id,
          name: member.name,
          netId: member.netId,
          signal: undefined,
          aggregateName: terminal.name,
          memberId: member.id,
        }))
      : [{ ...terminal, aggregateName: terminal.name, memberId: undefined }],
  );
}

export function projectScalarCellInterface(
  netlist: CellNetlistInterface | undefined,
) {
  return projectCellInterface(
    netlist
      ? { ...netlist, terminals: scalarCellTerminals(netlist) }
      : undefined,
  );
}

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

export interface CellInterfaceProjection {
  readonly ports: readonly ProjectedFormalCellPort[];
}

interface MutablePortGroup {
  id: string;
  key: string;
  name: string;
  direction: CellPortDirection;
  terminalIds: string[];
  netIds: string[];
  interfaceInstanceIds: string[];
}

/**
 * Project independently authored Cell Pins into the formal interface consumed
 * by hierarchy symbols and netlist export. Equal folded names share one
 * transient formal port. The source declarations and their Base Nets are never
 * rewritten or physically merged; the Logical-Net resolver interprets their
 * shared Port name as electrical identity.
 *
 * A Port's direction is a drawing hint (which side of the block symbol its pin
 * takes); an analog Pin has no electrical direction and no netlist writes one.
 * Declarations of one name may state different directions, as a VDD Power
 * marker (inout) and a plain Port (passive) do by default: the shared Port then
 * reads passive, and nothing reports it.
 */
export function projectCellInterface(
  netlist: CellNetlistInterface | undefined,
): CellInterfaceProjection {
  if (!netlist) return { ports: [] };

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
      };
      groups.push(group);
      groupByKey.set(key, group);
      continue;
    }

    existing.terminalIds.push(terminal.id);
    existing.netIds.push(terminal.netId);
    existing.interfaceInstanceIds.push(...terminal.interfaceInstanceIds);
    if (existing.direction !== terminal.direction)
      existing.direction = "passive";
  }

  return { ports: groups };
}
