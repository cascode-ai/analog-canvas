import type {
  CircuitProject,
  SimulationSourceExpression,
  SimulationSourceInput,
} from "@icm/model";
import { resolveDocumentLogicalNets } from "@icm/derived";
import { analyzeDesignNetlist, SIMULATION_DECK_GROUND } from "./extract.js";
import type { DesignNetlistCell } from "./ir.js";
import { inspectSimulationSourceGraph } from "./simulation-source-graph.js";
import {
  ngspiceCircuitScopes,
  ngspiceScopeKey,
} from "./simulation-source-scopes.js";

export interface NgspiceSignalTarget {
  rootDocumentId: string;
  documentId: string;
  netId: string;
  occurrence: string[];
}

/** Run-local display metadata. Native vector spelling and electrical identity never change. */
export function ngspiceSignalNames(
  project: CircuitProject,
  input: SimulationSourceInput,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(ngspiceSignals(project, input)).map(([vector, signal]) => [
      vector,
      signal.label,
    ]),
  );
}

/** Native vectors and Canvas addresses share the same resolved traversal. */
export function ngspiceSignals(
  project: CircuitProject,
  input: SimulationSourceInput,
  selectedScope?: import("@icm/model").SimulationCircuitScope,
): Record<string, { label: string; targets: NgspiceSignalTarget[] }> {
  const requested = selectedScope && ngspiceScopeKey(selectedScope);
  const graph = inspectSimulationSourceGraph(input);
  const authoredNetIds = new Map(
    project.documents.map((document) => [
      document.id,
      new Set(document.nets.map((net) => net.id)),
    ]),
  );
  const labels = new Map<string, Set<string>>();
  const targets = new Map<string, NgspiceSignalTarget[]>();
  for (const binding of input.circuitBindings) {
    if (!graph.paths.includes(binding.path)) continue;
    const ir = analyzeDesignNetlist(project, {
      format: "spice",
      rootDocumentId: binding.documentId,
      ...SIMULATION_DECK_GROUND,
      rootAsTopLevel: binding.emission === "top-level",
    }).ir;
    if (!ir) continue;
    const root = ir.cells.find((cell) => cell.id === ir.topCellId);
    if (!root) continue;
    const scopes = ngspiceCircuitScopes(graph, binding, ir);
    for (const scope of scopes.list()) {
      if (requested && requested !== ngspiceScopeKey(scope)) continue;
      const resolved = scopes.resolve(scope);
      if (!resolved.ok) continue;
      const qualify = resolved.node;
      let visits = 0;
      function visit(
        cell: DesignNetlistCell,
        nodes: Map<string, string>,
        path: string[],
        ancestors: Set<string>,
        occurrence: string[],
      ) {
        if (++visits > 4096 || ancestors.has(cell.id)) return;
        const local = new Map(nodes);
        for (const net of cell.nets) {
          const key = net.name.toLowerCase();
          const node =
            local.get(key) ??
            qualify(
              net.scope === "global" ? net.name : [...path, net.name].join("."),
            );
          local.set(key, node);
          if (!authoredNetIds.get(cell.id)?.has(net.id)) continue;
          const vector = `v(${node})`.toLowerCase();
          const name = [...scope.callPath, ...path, net.name].join("/");
          const names = labels.get(vector) ?? new Set<string>();
          names.add(name);
          labels.set(vector, names);
          targets.set(vector, [
            ...(targets.get(vector) ?? []),
            {
              rootDocumentId: binding.documentId,
              documentId: cell.id,
              netId: net.id,
              occurrence,
            },
          ]);
        }
        for (const instance of cell.instances) {
          if (instance.deviceClass !== "hierarchical") continue;
          const child = ir!.cells.find(
            (candidate) => candidate.name === instance.target,
          );
          if (!child) continue;
          const ports = new Map<string, string>();
          for (const port of child.ports) {
            const connection = instance.nodes.find(
              (node) => node.pinName === port.name,
            );
            const node =
              connection && local.get(connection.netName.toLowerCase());
            if (node) ports.set(port.netName.toLowerCase(), node);
          }
          visit(
            child,
            ports,
            [...path, instance.reference],
            new Set([...ancestors, cell.id]),
            [...occurrence, instance.id],
          );
        }
      }
      visit(root, new Map(), [], new Set(), []);
    }
  }
  return Object.fromEntries(
    [...labels].map(([vector, names]) => [
      vector,
      {
        label: [...names].join(" · "),
        targets: targets.get(vector) ?? [],
      },
    ]),
  );
}

/** Resolve the existing durable anchor; no new persisted acquisition identity. */
export function resolveSimulationVoltageProbeNetId(
  project: CircuitProject,
  target: Pick<
    Extract<SimulationSourceExpression, { kind: "voltage" }>,
    "kind" | "documentId" | "anchor" | "occurrence"
  >,
): string | undefined {
  const document = project.documents.find((d) => d.id === target.documentId);
  if (!document) return undefined;
  const anchor = target.anchor;
  if (anchor.kind === "terminal")
    return document.nets.find((net) =>
      net.terminals.some(
        (t) =>
          t.instanceId === anchor.instanceId && t.pinName === anchor.pinName,
      ),
    )?.id;
  if (anchor.kind === "junction")
    return document.junctions.find((j) => j.id === anchor.junctionId)?.netId;
  if (anchor.kind === "route")
    return document.routes.find((r) => r.id === anchor.routeId)?.netId;
  return document.nets.find((net) => net.id === anchor.netId)?.id;
}

/** GUI and API resolve the same scoped electrical target for ngspice voltage acquisitions. */
export function ngspiceVoltageAcquisition(
  project: CircuitProject,
  input: SimulationSourceInput,
  target: Extract<SimulationSourceExpression, { kind: "voltage" }>,
) {
  const document = project.documents.find((d) => d.id === target.documentId);
  const netId = resolveSimulationVoltageProbeNetId(project, target);
  if (!document || !netId)
    return {
      ok: false as const,
      message: "The selected voltage anchor no longer belongs to a Net",
    };
  const logical = resolveDocumentLogicalNets(document).byBaseNetId;
  const net = logical.get(netId)?.id;
  const candidates = Object.entries(
    ngspiceSignals(project, input, target.circuit),
  ).filter(([, signal]) =>
    signal.targets.some(
      (t) =>
        t.documentId === target.documentId &&
        JSON.stringify(t.occurrence) === JSON.stringify(target.occurrence) &&
        (net === undefined
          ? t.netId === netId
          : logical.get(t.netId)?.id === net),
    ),
  );
  if (candidates.length !== 1)
    return {
      ok: false as const,
      message:
        "The selected Net has no unique reachable circuit occurrence; choose its exact DUT call path",
    };
  const vector = candidates[0]![0];
  return {
    ok: true as const,
    vector,
    save: vector,
  };
}
