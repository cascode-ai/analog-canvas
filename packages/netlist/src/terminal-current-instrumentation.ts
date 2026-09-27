import type { StableId } from "@icm/model";
import type { DesignNetlistIR, DesignNetlistCell } from "./ir.js";

export interface TerminalCurrentInstrumentation {
  readonly cellId: StableId;
  readonly instanceId: StableId;
  readonly pinName: string;
  readonly senseReference: string;
  readonly senseNode: string;
}

export function instrumentationKey(
  instrumentation: Pick<
    TerminalCurrentInstrumentation,
    "cellId" | "instanceId" | "pinName"
  >,
): string {
  return `${instrumentation.cellId}\u0000${instrumentation.instanceId}\u0000${instrumentation.pinName}`;
}

/** Series zero-volt source: positive branch flow enters the selected terminal.
 * Applies to derived IR only; source selection and name allocation are callers. */
export function instrumentTerminalCurrents(
  ir: DesignNetlistIR,
  instrumentations: ReadonlyMap<string, TerminalCurrentInstrumentation>,
): DesignNetlistIR {
  if (instrumentations.size === 0) return ir;
  return {
    ...ir,
    cells: ir.cells.map((cell) =>
      instrumentCellTerminalCurrents(cell, instrumentations),
    ),
  };
}

export function instrumentCellTerminalCurrents(
  cell: DesignNetlistCell,
  instrumentations: ReadonlyMap<string, TerminalCurrentInstrumentation>,
): DesignNetlistCell {
  if (instrumentations.size === 0) return cell;
  return {
    ...cell,
    instances: cell.instances.flatMap((instance) => {
      const selected = instance.nodes.flatMap((node) => {
        const instrumentation = instrumentations.get(
          instrumentationKey({
            cellId: cell.id,
            instanceId: instance.id,
            pinName: node.pinName,
          }),
        );
        const existing =
          instrumentation &&
          cell.instances.some(
            (probe) =>
              probe.terminalCurrentSense?.instanceId === instance.id &&
              probe.terminalCurrentSense.pinName === node.pinName,
          );
        return instrumentation && !existing ? [{ node, instrumentation }] : [];
      });
      if (selected.length === 0) return [instance];
      return [
        {
          ...instance,
          nodes: instance.nodes.map((node) => {
            const selectedNode = selected.find(
              (item) => item.node.pinName === node.pinName,
            );
            return selectedNode
              ? { ...node, netName: selectedNode.instrumentation.senseNode }
              : node;
          }),
        },
        ...selected.map(({ node, instrumentation }) => ({
          id: `${instance.id}:simulation-current-sense:${instrumentation.senseReference}`,
          reference: instrumentation.senseReference,
          invocationKind: "primitive" as const,
          deviceClass: "voltage-source" as const,
          target: null,
          terminalCurrentSense: {
            instanceId: instance.id,
            pinName: node.pinName,
          },
          nodes: [
            { pinName: "+", netName: node.netName },
            { pinName: "-", netName: instrumentation.senseNode },
          ],
          parameters: [{ name: "dc", rawValue: "0" }],
        })),
      ];
    }),
  };
}
