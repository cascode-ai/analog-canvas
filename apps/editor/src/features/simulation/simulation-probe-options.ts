import type {
  CircuitProject,
  SchematicDocument,
  SimulationProbeSpec,
  SimulationVoltageProbeAnchor,
} from "@icm/model";
import { resolveDocumentLogicalNets, type HierarchyFrame } from "@icm/derived";

type VoltageProbeTarget = Omit<
  Extract<SimulationProbeSpec, { kind: "net-voltage" }>,
  "id"
>;
type SourceCurrentProbeTarget = Omit<
  Extract<SimulationProbeSpec, { kind: "source-current" }>,
  "id"
>;
type ProbeTarget = VoltageProbeTarget | SourceCurrentProbeTarget;

export interface SimulationProbeOption<
  Target extends ProbeTarget = ProbeTarget,
> {
  readonly key: string;
  readonly label: string;
  readonly target: Target;
}

export interface SimulationProbeOptions {
  readonly voltage: readonly SimulationProbeOption<VoltageProbeTarget>[];
  readonly sourceCurrent: readonly SimulationProbeOption<SourceCurrentProbeTarget>[];
}

export interface PickedSimulationNet {
  readonly documentId: string;
  readonly netId: string;
  readonly occurrence?: readonly string[];
}

export function simulationProbeTargetKey(target: ProbeTarget): string {
  const occurrence = target.occurrence.join("/");
  if (target.kind === "source-current")
    return `current:${occurrence}:${target.documentId}:${target.instanceId}`;
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
  const sourceCurrent: SimulationProbeOption<SourceCurrentProbeTarget>[] = [];
  if (!root) return { voltage, sourceCurrent };

  const visit = (
    document: SchematicDocument,
    occurrence: readonly string[],
    displayPath: readonly string[],
    ancestry: ReadonlySet<string>,
  ) => {
    const logicalNets = resolveDocumentLogicalNets(document);
    const prefix = displayPath.length
      ? `${displayPath.join("/")} · ${document.name}`
      : document.name;
    // One visible choice per electrical Logical Net. Several Base Nets may be
    // joined by the same scoped label (notably repeated Ground markers); the
    // user should not have to choose among indistinguishable aliases.
    for (const net of logicalNets.groups) {
      const anchor = voltageAnchor(document, net.baseNetIds);
      if (!anchor) continue;
      const target: VoltageProbeTarget = {
        kind: "net-voltage",
        documentId: document.id,
        anchor,
        occurrence: [...occurrence],
      };
      voltage.push({
        key: simulationProbeTargetKey(target),
        label: `${prefix} · ${net.name ?? net.id}`,
        target,
      });
    }
    for (const instance of document.instances) {
      const binding = instance.netlist?.binding;
      if (
        (binding?.kind === "primitive" || binding?.kind === "model") &&
        binding.deviceClass === "voltage-source"
      ) {
        const target: SourceCurrentProbeTarget = {
          kind: "source-current",
          documentId: document.id,
          instanceId: instance.id,
          occurrence: [...occurrence],
        };
        sourceCurrent.push({
          key: simulationProbeTargetKey(target),
          label: `${prefix} · ${instance.reference ?? instance.id} current`,
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
  return { voltage, sourceCurrent };
}
