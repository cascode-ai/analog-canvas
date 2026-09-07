import type {
  CircuitProject,
  Instance,
  SchematicDocument,
  SimulationExpression,
  SimulationDeviceOperatingPointSpec,
  SimulationVoltageProbeAnchor,
} from "@icm/model";
import {
  mosBulkKind,
  resolveDocumentLogicalNets,
  type HierarchyFrame,
} from "@icm/derived";
import { deviceDescriptor } from "@icm/devices";

import { logicalNetChoices } from "../logical-net-choices";

export type VoltageProbeTarget = Extract<
  SimulationExpression,
  { kind: "voltage" }
>;
export type TerminalCurrentProbeTarget = Extract<
  SimulationExpression,
  { kind: "current" }
>;
type ProbeTarget = VoltageProbeTarget | TerminalCurrentProbeTarget;

export interface SimulationProbeOption<
  Target extends ProbeTarget = ProbeTarget,
> {
  readonly key: string;
  readonly label: string;
  readonly target: Target;
}

export interface SimulationProbeOptions {
  readonly voltage: readonly SimulationProbeOption<VoltageProbeTarget>[];
  readonly terminalCurrent: readonly SimulationProbeOption<TerminalCurrentProbeTarget>[];
  readonly deviceOperatingPoint: readonly SimulationDeviceOperatingPointOption[];
}

export interface SimulationDeviceOperatingPointOption {
  readonly key: string;
  readonly label: string;
  readonly target: Omit<SimulationDeviceOperatingPointSpec, "id">;
}

export function simulationDeviceOperatingPointTargetKey(
  target: Omit<SimulationDeviceOperatingPointSpec, "id">,
): string {
  return `${target.occurrence.join("/")}:${target.documentId}:${target.instanceId}`;
}

export interface PickedSimulationNet {
  readonly documentId: string;
  readonly netId: string;
  readonly occurrence?: readonly string[];
}

export interface PickedSimulationTerminal {
  readonly documentId: string;
  readonly instanceId: string;
  readonly pinName: string;
  readonly occurrence?: readonly string[];
}

export function simulationProbeTargetKey(target: ProbeTarget): string {
  const occurrence = target.occurrence.join("/");
  if (target.kind === "current")
    return `current:${occurrence}:${target.documentId}:${target.instanceId}:${target.pinName}`;
  const anchor = target.anchor;
  const anchorKey =
    anchor.kind === "terminal"
      ? `terminal:${anchor.instanceId}:${anchor.pinName}`
      : anchor.kind === "junction"
        ? `junction:${anchor.junctionId}`
        : anchor.kind === "route"
          ? `route:${anchor.routeId}`
          : `base-net:${anchor.netId}`;
  return `voltage:${occurrence}:${target.documentId}:${anchorKey}`;
}

/**
 * UI identity for a probe target. A voltage probe is a measurement of one
 * Logical Net, not of whichever terminal/route happened to supply its durable
 * anchor, so repeated Ground markers and alternate anchors share one choice.
 */
export function simulationProbeSelectionKey(
  project: CircuitProject,
  target: ProbeTarget,
): string {
  if (target.kind === "current") return simulationProbeTargetKey(target);
  const occurrence = target.occurrence.join("/");
  const document = project.documents.find(
    (candidate) => candidate.id === target.documentId,
  );
  const baseNetId = resolveSimulationVoltageProbeNetId(project, target);
  const logicalNetId =
    document && baseNetId
      ? resolveDocumentLogicalNets(document).byBaseNetId.get(baseNetId)?.id
      : undefined;
  return logicalNetId
    ? `voltage:${occurrence}:${target.documentId}:logical:${logicalNetId}`
    : simulationProbeTargetKey(target);
}

/** Resolve a saved voltage anchor to the Base Net it currently belongs to. */
export function resolveSimulationVoltageProbeNetId(
  project: CircuitProject,
  target: VoltageProbeTarget,
): string | undefined {
  const document = project.documents.find(
    (candidate) => candidate.id === target.documentId,
  );
  if (!document) return undefined;
  const anchor = target.anchor;
  if (anchor.kind === "terminal")
    return document.nets.find((net) =>
      net.terminals.some(
        (terminal) =>
          terminal.instanceId === anchor.instanceId &&
          terminal.pinName === anchor.pinName,
      ),
    )?.id;
  if (anchor.kind === "junction")
    return document.junctions.find(
      (junction) => junction.id === anchor.junctionId,
    )?.netId;
  if (anchor.kind === "route")
    return document.routes.find((route) => route.id === anchor.routeId)?.netId;
  return document.nets.find((net) => net.id === anchor.netId)?.id;
}

/** Match a canvas Base Net against the Logical Net selected by one probe. */
export function simulationVoltageProbeTargetsNet(
  project: CircuitProject,
  target: VoltageProbeTarget,
  netId: string,
): boolean {
  const document = project.documents.find(
    (candidate) => candidate.id === target.documentId,
  );
  if (!document) return false;
  const anchoredNetId = resolveSimulationVoltageProbeNetId(project, target);
  if (!anchoredNetId) return false;
  return (
    resolveDocumentLogicalNets(document)
      .byBaseNetId.get(anchoredNetId)
      ?.baseNetIds.includes(netId) ?? false
  );
}

/**
 * Resolve a canvas pick without collapsing repeated Cell occurrences. A
 * definition-only pick intentionally returns every matching occurrence so the
 * caller can ask instead of silently choosing X1 over X2.
 */
export function matchSimulationVoltageProbeOptions(
  project: CircuitProject,
  options: readonly SimulationProbeOption<VoltageProbeTarget>[],
  picked: PickedSimulationNet,
): readonly SimulationProbeOption<VoltageProbeTarget>[] {
  return options.filter(
    (candidate) =>
      candidate.target.documentId === picked.documentId &&
      (picked.occurrence === undefined ||
        (candidate.target.occurrence.length === picked.occurrence.length &&
          candidate.target.occurrence.every(
            (id, index) => id === picked.occurrence?.[index],
          ))) &&
      simulationVoltageProbeTargetsNet(project, candidate.target, picked.netId),
  );
}

/**
 * Match a visible terminal against the concrete current targets below the
 * selected Testbench root. Definition-only picks deliberately retain every
 * occurrence so the setup editor can ask which call the author meant.
 */
export function matchSimulationTerminalCurrentProbeOptions(
  options: readonly SimulationProbeOption<TerminalCurrentProbeTarget>[],
  picked: PickedSimulationTerminal,
): readonly SimulationProbeOption<TerminalCurrentProbeTarget>[] {
  return options.filter(
    (candidate) =>
      candidate.target.documentId === picked.documentId &&
      candidate.target.instanceId === picked.instanceId &&
      candidate.target.pinName === picked.pinName &&
      (picked.occurrence === undefined ||
        (candidate.target.occurrence.length === picked.occurrence.length &&
          candidate.target.occurrence.every(
            (id, index) => id === picked.occurrence?.[index],
          ))),
  );
}

function voltageAnchor(
  document: SchematicDocument,
  baseNetIds: readonly string[],
): SimulationVoltageProbeAnchor | undefined {
  const ids = new Set(baseNetIds);
  for (const net of document.nets) {
    if (!ids.has(net.id)) continue;
    const terminal = net.terminals[0];
    if (terminal) return { kind: "terminal", ...terminal };
  }
  const junction = document.junctions.find((item) => ids.has(item.netId));
  if (junction) return { kind: "junction", junctionId: junction.id };
  const route = document.routes.find((item) => ids.has(item.netId));
  return route ? { kind: "route", routeId: route.id } : undefined;
}

/**
 * A lone formal Cell Pin is an interface declaration, not a solved circuit
 * node. It cannot produce a useful ngspice vector until the Net also contains
 * another electrical member. Keep this simulation-only eligibility rule out
 * of the persisted Net and Cell contracts.
 */
function hasMeasurableVoltageMember(
  document: SchematicDocument,
  baseNetIds: readonly string[],
): boolean {
  const ids = new Set(baseNetIds);
  const interfaceInstanceIds = new Set(
    (document.netlist?.terminals ?? []).flatMap(
      (terminal) => terminal.interfaceInstanceIds,
    ),
  );
  const terminals = document.nets.flatMap((net) =>
    ids.has(net.id) ? net.terminals : [],
  );
  const globalSupply = document.connectivityEvidence.some(
    (evidence) =>
      ids.has(evidence.netId) &&
      evidence.kind === "name-claim" &&
      evidence.scope === "global" &&
      (evidence.powerDomain === "vdd" || evidence.powerDomain === "ground"),
  );
  return (
    globalSupply ||
    terminals.length > 1 ||
    terminals.some((terminal) => !interfaceInstanceIds.has(terminal.instanceId))
  );
}

function logicalNetDisplayLabel(
  document: SchematicDocument,
  choice: {
    readonly label: string;
    readonly netId: string;
    readonly baseNetIds: readonly string[];
  },
): string {
  if (choice.label !== choice.netId) return choice.label;
  const ids = new Set(choice.baseNetIds);
  const formalTerminal = document.netlist?.terminals.find((terminal) =>
    ids.has(terminal.netId),
  );
  if (formalTerminal) return formalTerminal.name;
  const instances = new Map(
    document.instances.map((instance) => [instance.id, instance]),
  );
  const aliases: string[] = [];
  for (const net of document.nets) {
    if (!ids.has(net.id)) continue;
    for (const terminal of net.terminals) {
      const alias = `${instances.get(terminal.instanceId)?.reference ?? terminal.instanceId}.${terminal.pinName}`;
      if (!aliases.includes(alias)) aliases.push(alias);
    }
  }
  return aliases.length > 0 ? aliases.join(" / ") : choice.label;
}

function terminalCurrentPinNames(
  project: CircuitProject,
  document: SchematicDocument,
  instance: Instance,
): readonly string[] {
  const connected = new Set(
    document.nets.flatMap((net) =>
      net.terminals.flatMap((terminal) =>
        terminal.instanceId === instance.id ? [terminal.pinName] : [],
      ),
    ),
  );
  const binding = instance.netlist?.binding;
  if (
    !binding ||
    binding.kind === "unresolved-subcircuit" ||
    ((binding.kind === "primitive" || binding.kind === "model") &&
      binding.deviceClass === "net-marker")
  )
    return [];
  let ordered: readonly string[] = [];
  if (binding?.kind === "primitive" || binding?.kind === "model")
    ordered = deviceDescriptor(instance.symbolId)?.pinOrder ?? [];
  else if (binding?.kind === "subcircuit")
    ordered =
      project.documents
        .find((candidate) => candidate.id === binding.childDocumentId)
        ?.netlist?.terminals.map((terminal) => terminal.name) ?? [];
  else if (binding?.kind === "external-subcircuit")
    ordered =
      project.externalSubcircuitDefinitions
        .find((definition) => definition.id === binding.definitionId)
        ?.terminals.map((terminal) => terminal.name) ?? [];
  return [...ordered, ...connected].filter(
    (pinName, index, all) =>
      connected.has(pinName) && all.indexOf(pinName) === index,
  );
}

/**
 * Resolve the persisted occurrence ids into the same hierarchy frames used by
 * canvas navigation. This is presentation-only: probe identity remains the
 * authored document/object/occurrence tuple.
 */
export function simulationProbeHierarchyPath(
  project: CircuitProject,
  rootDocumentId: string,
  occurrence: readonly string[],
): readonly HierarchyFrame[] | null {
  const documents = new Map(
    project.documents.map((document) => [document.id, document]),
  );
  let parent = documents.get(rootDocumentId);
  if (!parent) return null;
  const frames: HierarchyFrame[] = [];
  for (const instanceId of occurrence) {
    const instance = parent.instances.find(
      (candidate) => candidate.id === instanceId,
    );
    const binding = instance?.netlist?.binding;
    if (binding?.kind !== "subcircuit") return null;
    const child = documents.get(binding.childDocumentId);
    if (!child) return null;
    frames.push({
      parentDocumentId: parent.id,
      instanceId,
      childDocumentId: child.id,
    });
    parent = child;
  }
  return frames;
}

/**
 * Enumerate concrete probe targets below one simulation root. An occurrence
 * is kept for every hierarchy call, so two instances of one Cell remain two
 * different choices. This is an editor projection of the persisted probe
 * contract; it does not invent a second measurement object.
 */
export function deriveSimulationProbeOptions(
  project: CircuitProject,
  rootDocumentId: string,
): SimulationProbeOptions {
  const documents = new Map(
    project.documents.map((document) => [document.id, document]),
  );
  const root = documents.get(rootDocumentId);
  const voltage: SimulationProbeOption<VoltageProbeTarget>[] = [];
  const terminalCurrent: SimulationProbeOption<TerminalCurrentProbeTarget>[] =
    [];
  const deviceOperatingPoint: SimulationDeviceOperatingPointOption[] = [];
  if (!root) return { voltage, terminalCurrent, deviceOperatingPoint };

  const visit = (
    document: SchematicDocument,
    occurrence: readonly string[],
    displayPath: readonly string[],
    ancestry: ReadonlySet<string>,
  ) => {
    const prefix = displayPath.length
      ? `${displayPath.join("/")} · ${document.name}`
      : document.name;
    // One visible choice per electrical Logical Net. Several Base Nets may be
    // joined by the same scoped label (notably repeated Ground markers); the
    // user should not have to choose among indistinguishable aliases.
    for (const net of logicalNetChoices(document)) {
      if (!hasMeasurableVoltageMember(document, net.baseNetIds)) continue;
      const anchor = voltageAnchor(document, net.baseNetIds);
      if (!anchor) continue;
      const target: VoltageProbeTarget = {
        kind: "voltage",
        documentId: document.id,
        anchor,
        occurrence: [...occurrence],
      };
      voltage.push({
        key: simulationProbeSelectionKey(project, target),
        label: `${prefix} · ${logicalNetDisplayLabel(document, net)}`,
        target,
      });
    }
    for (const instance of document.instances) {
      const binding = instance.netlist?.binding;
      if (mosBulkKind(instance)) {
        const target = {
          documentId: document.id,
          instanceId: instance.id,
          occurrence: [...occurrence],
        };
        deviceOperatingPoint.push({
          key: simulationDeviceOperatingPointTargetKey(target),
          label: `${prefix} · ${instance.reference ?? instance.id}`,
          target,
        });
      }
      for (const pinName of terminalCurrentPinNames(
        project,
        document,
        instance,
      )) {
        const target: TerminalCurrentProbeTarget = {
          kind: "current",
          documentId: document.id,
          instanceId: instance.id,
          pinName,
          occurrence: [...occurrence],
        };
        terminalCurrent.push({
          key: simulationProbeTargetKey(target),
          label: `${prefix} · ${instance.reference ?? instance.id}.${pinName} current`,
          target,
        });
      }
      if (binding?.kind !== "subcircuit") continue;
      const child = documents.get(binding.childDocumentId);
      if (!child || ancestry.has(child.id) || occurrence.length >= 64) continue;
      visit(
        child,
        [...occurrence, instance.id],
        [...displayPath, instance.reference ?? instance.id],
        new Set([...ancestry, child.id]),
      );
    }
  };
  visit(root, [], [], new Set([root.id]));
  return { voltage, terminalCurrent, deviceOperatingPoint };
}
