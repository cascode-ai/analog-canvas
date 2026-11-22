// Drawn switches: the S card a switch means, and the clock phases it reads,
// taken as pins where nothing in the Cell drives them.
import { deriveStableId, foldNetName } from "@icm/model";
import { drawnSwitchPhase } from "@icm/derived";
import type { CircuitProject, Instance, SchematicDocument } from "@icm/model";
import {
  callsClockedSwitchBody,
  deviceDescriptor,
  drawnSwitchControl,
  type DeviceDescriptor,
  type DrawnSwitchControl,
} from "@icm/devices";
import type { DesignNetlistInstance, NetlistDiagnostic } from "./ir.js";
import {
  clockedSwitchTarget,
  IDEAL_SWITCH_MODEL,
} from "./ideal-switch-model.js";
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

export const phaseNetId = (cellId: string, name: string) =>
  deriveStableId("netlist", "switch-phase", cellId, name);

/** Whether a Symbol is a drawn switch, whose control is read against ground. */
export function isDrawnSwitch(
  symbolId: string,
  project?: CircuitProject,
): boolean {
  const definition = deviceDescriptor(symbolId, project);
  return definition ? drawnSwitchControl(definition) !== null : false;
}

/**
 * The node of the clock a switch's, chopper's or SPDT's label names, or null, with a
 * diagnostic, for a label no node can be named after.
 * A phase names its node the way a Net Label would, so the switch meets the
 * clock drawn on a Net of that name, or a Cell Pin of that name. A phase
 * nothing in the Cell drives becomes a pin of a Cell printed as a subcircuit
 * (see finalizeCellInterfaces); at a deck's top, it is a node its text
 * drives.
 */
export function switchPhaseNode(
  document: SchematicDocument,
  instance: Instance,
  context: CellNetContext,
  options: ResolvedDesignNetlistAnalysisOptions,
  diagnostics: NetlistDiagnostic[],
): string | null {
  const reference = instance.reference!;
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
  const node = existingNode(phase);
  if (node) return node;
  added.add(token);
  context.nets.push({
    id: phaseNetId(document.id, token),
    name: token,
    scope: "local",
  });
  return token;
}

/**
 * A drawn switch as the SPICE `S` card it means: its two switched nodes, then
 * its control against the Cell's ground, closing through the ideal switch. A
 * chopper or SPDT is the call of its switches' body on its pins and the clock
 * its label names.
 */
export function extractDrawnSwitch(
  document: SchematicDocument,
  instance: Instance,
  definition: DeviceDescriptor,
  control: DrawnSwitchControl,
  context: CellNetContext,
  options: ResolvedDesignNetlistAnalysisOptions,
  diagnostics: NetlistDiagnostic[],
): DesignNetlistInstance | null {
  const reference = instance.reference!;
  let controlNode: string | null;
  if (control !== "pin") {
    controlNode = switchPhaseNode(
      document,
      instance,
      context,
      options,
      diagnostics,
    );
    if (!controlNode) return null;
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
  // A chopper or SPDT calls its switches' body with its clock last (#1641,
  // #2440).
  if (callsClockedSwitchBody(control))
    return {
      id: instance.id,
      reference,
      invocationKind: "subcircuit",
      deviceClass: "hierarchical",
      target: clockedSwitchTarget(control),
      nodes: [...nodes, { pinName: "CK", netName: controlNode }],
      parameters: [],
    };
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
