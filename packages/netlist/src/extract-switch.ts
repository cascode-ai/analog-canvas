// Drawn switches: the S card a switch means, and the clock phases it reads,
// taken as pins where nothing in the Cell drives them.
import { deriveStableId, foldNetName } from "@icm/model";
import { drawnSwitchControl, drawnSwitchPhase } from "@icm/derived";
import type { CircuitProject, Instance, SchematicDocument } from "@icm/model";
import { deviceDescriptor, type DeviceDescriptor } from "@icm/devices";
import type {
  DesignNetlistCell,
  DesignNetlistInstance,
  NetlistDiagnostic,
} from "./ir.js";
import { IDEAL_SWITCH_MODEL } from "./ideal-switch-model.js";
import {
  type ResolvedDesignNetlistAnalysisOptions,
  diagnostic,
} from "./extract-common.js";
import {
  type CellNetContext,
  encodeCandidate,
  terminalNetName,
} from "./extract-nets.js";

/** Phase nodes no drawn Net supplies, per Cell: its pins as a subcircuit. */
export const undrivenPhaseNodes = new WeakMap<CellNetContext, Set<string>>();

/**
 * A clock phase a Cell took as a pin because nothing in it drives the phase
 * (extractDrawnSwitch) reaches its callers by name, as a clock tree does: each
 * call passes the caller's Net of that name, or, where it has none, the caller
 * takes the phase as a pin of its own. A deck's top is the testbench: there
 * the phase is a node of its name, for the testbench's own text to drive
 * (#1475, #1489).
 */
export function bubblePhasePins(
  cells: DesignNetlistCell[],
  documentsById: ReadonlyMap<string, SchematicDocument>,
  options: ResolvedDesignNetlistAnalysisOptions,
): void {
  const cellsById = new Map(cells.map((cell) => [cell.id, cell]));
  const phaseNetId = (cellId: string, name: string) =>
    deriveStableId("netlist", "switch-phase", cellId, name);
  const visited = new Set<string>();
  const visit = (cell: DesignNetlistCell) => {
    if (visited.has(cell.id)) return;
    visited.add(cell.id);
    const document = documentsById.get(cell.id);
    const atTop = options.rootAsTopLevel && cell.id === options.rootDocumentId;
    for (const instance of cell.instances) {
      const binding = document?.instances.find(
        (candidate) => candidate.id === instance.id,
      )?.netlist?.binding;
      if (binding?.kind !== "subcircuit") continue;
      const child = cellsById.get(binding.childDocumentId);
      if (!child) continue;
      visit(child);
      for (const port of child.ports) {
        if (port.id !== phaseNetId(child.id, port.name)) continue;
        let net = cell.nets.find(
          (candidate) =>
            candidate.name.toLowerCase() === port.name.toLowerCase(),
        );
        if (!net) {
          net = {
            id: phaseNetId(cell.id, port.name),
            name: port.name,
            scope: "local",
          };
          cell.nets.push(net);
          if (!atTop)
            cell.ports.push({ id: net.id, name: port.name, netName: net.name });
        }
        instance.nodes.push({ pinName: port.name, netName: net.name });
      }
    }
  };
  for (const cell of cells) visit(cell);
}

/** Whether a Symbol is a drawn switch, whose control is read against ground. */
export function isDrawnSwitch(
  symbolId: string,
  project?: CircuitProject,
): boolean {
  const definition = deviceDescriptor(symbolId, project);
  return definition ? drawnSwitchControl(definition) !== null : false;
}

/**
 * A drawn switch as the SPICE `S` card it means: its two switched nodes, then
 * its control against the Cell's ground, closing through the ideal switch.
 * A phase names its node the way a Net Label would, so the switch meets the
 * clock drawn on a Net of that name, or a Cell Pin of that name. A phase
 * nothing in the Cell drives becomes a pin of a Cell printed as a subcircuit
 * (see bubblePhasePins); at a deck's top, the testbench, it is a node its text
 * drives.
 */
export function extractDrawnSwitch(
  document: SchematicDocument,
  instance: Instance,
  definition: DeviceDescriptor,
  control: "phase" | "pin",
  context: CellNetContext,
  options: ResolvedDesignNetlistAnalysisOptions,
  diagnostics: NetlistDiagnostic[],
): DesignNetlistInstance | null {
  const reference = instance.reference!;
  let controlNode: string | null;
  if (control === "phase") {
    // A switch whose label still shows its own name is clocked by a phase of
    // that name, so a freshly placed switch netlists at once. Writing Φ1 on
    // the label moves it onto a shared clock, and E̅N̅ is the signal EN_bar,
    // never an inverted switch: a complement is drawn, or the testbench's.
    // The phase is a Net named as typed, or as a Net Label drawn the same
    // way is named (Φ_1 for Φ₁).
    const drawnPhase = drawnSwitchPhase(document, instance);
    const existingNode = (name: string) => {
      const encoded = encodeCandidate(name, "local", options);
      return (
        context.nameByAuthoredName.get(foldNetName(name)) ??
        (encoded.ok
          ? context.nets.find(
              (net) => net.name.toLowerCase() === encoded.token.toLowerCase(),
            )?.name
          : undefined)
      );
    };
    const phase = drawnPhase
      ? ([drawnPhase.drawnName, drawnPhase.name].find(
          (name) => name !== undefined && existingNode(name) !== undefined,
        ) ?? drawnPhase.name)
      : reference;
    const encoded = encodeCandidate(phase, "local", options);
    if (!encoded.ok) {
      diagnostic(
        diagnostics,
        document.id,
        "SWITCH_PHASE_UNREADABLE",
        `Switch ${reference}'s label ${phase} cannot name a netlist node; write a phase such as Φ1`,
        [instance.id],
      );
      return null;
    }
    const token = encoded.token;
    const added = undrivenPhaseNodes.get(context) ?? new Set<string>();
    undrivenPhaseNodes.set(context, added);
    controlNode = existingNode(phase) ?? null;
    if (!controlNode) {
      controlNode = token;
      added.add(token);
      context.nets.push({
        id: deriveStableId("netlist", "switch-phase", document.id, token),
        name: token,
        scope: "local",
      });
    }
  } else {
    controlNode = terminalNetName(
      document,
      instance,
      "CTRL",
      context,
      diagnostics,
    );
    if (!controlNode) return null;
  }
  const switched = definition.pinOrder.filter((pinName) => pinName !== "CTRL");
  const nodes = switched.map((pinName) => ({
    pinName,
    netName:
      terminalNetName(document, instance, pinName, context, diagnostics) ??
      `<unconnected:${pinName}>`,
  }));
  return {
    id: instance.id,
    reference,
    invocationKind: "primitive",
    deviceClass: "switch",
    target: IDEAL_SWITCH_MODEL.name,
    nodes: [
      ...nodes,
      { pinName: control === "pin" ? "CTRL" : "CP", netName: controlNode },
      {
        pinName: "CN",
        netName: context.nameByAuthoredName.get(foldNetName("0")) ?? "0",
      },
    ],
    parameters: [],
  };
}
