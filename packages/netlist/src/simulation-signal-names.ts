import type {
  CircuitProject,
  SimulationSourceInput,
  SimulationCircuitScope,
} from "@icm/model";
import { analyzeDesignNetlist, SIMULATION_DECK_GROUND } from "./extract.js";
import type { DesignNetlistCell } from "./ir.js";
import { inspectVacaskSourceGraph } from "./vacask-source.js";
import { vacaskCircuitScopes } from "./vacask-source-scopes.js";

export interface SimulationSignalTarget {
  rootDocumentId: string;
  documentId: string;
  netId: string;
  occurrence: string[];
  /** Present for a terminal-current vector; the Net address is still available. */
  terminal?: { instanceId: string; pinName: string };
}

/** Run-local display metadata. Native vector spelling and electrical identity never change. */
export function simulationSignalNames(
  project: CircuitProject,
  input: SimulationSourceInput,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(simulationSignals(project, input)).map(
      ([vector, signal]) => [vector, signal.label],
    ),
  );
}

/** Native vectors and Canvas addresses share the same resolved traversal. */
export function simulationSignals(
  project: CircuitProject,
  input: SimulationSourceInput,
  requestedScope?: SimulationCircuitScope,
): Record<string, { label: string; targets: SimulationSignalTarget[] }> {
  const graph = inspectVacaskSourceGraph(input);
  const authoredNetIds = new Map(
    project.documents.map((document) => [
      document.id,
      new Set(document.nets.map((net) => net.id)),
    ]),
  );
  const labels = new Map<string, Set<string>>();
  const targets = new Map<string, SimulationSignalTarget[]>();
  for (const binding of input.circuitBindings) {
    if (requestedScope && requestedScope.bindingId !== binding.id) continue;
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
    const scopes = vacaskCircuitScopes(graph, binding, ir);
    for (const scope of scopes.list()) {
      if (
        requestedScope &&
        JSON.stringify(scope.callPath) !==
          JSON.stringify(requestedScope.callPath)
      )
        continue;
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
          const key = net.name;
          const node =
            net.scope === "global"
              ? net.name
              : (local.get(key) ?? qualify([...path, net.name].join(":")));
          local.set(key, node);
          // Export may synthesize default module supply ports. They are needed
          // to print and traverse the netlist, but do not name a selectable
          // Canvas Net until the author actually wires one in this Document.
          if (!authoredNetIds.get(cell.id)?.has(net.id)) continue;
          const vector = node;
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
            const node = connection && local.get(connection.netName);
            if (node) ports.set(port.netName, node);
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
