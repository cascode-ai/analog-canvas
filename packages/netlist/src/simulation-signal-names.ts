import type { CircuitProject, SimulationSourceInput } from "@icm/model";
import { analyzeDesignNetlist } from "./extract.js";
import type { DesignNetlistCell } from "./ir.js";
import { inspectSimulationSourceGraph } from "./simulation-source-graph.js";
import {
  listAuthoredCircuitScopes,
  resolveAuthoredCircuitScope,
} from "./simulation-source-scopes.js";

/** Run-local display metadata. Native vector spelling and electrical identity never change. */
export function simulationSignalNames(
  project: CircuitProject,
  input: SimulationSourceInput,
): Record<string, string> {
  const graph = inspectSimulationSourceGraph(input);
  const labels = new Map<string, Set<string>>();
  for (const binding of input.circuitBindings) {
    if (!graph.paths.includes(binding.path)) continue;
    const ir = analyzeDesignNetlist(project, {
      format: "spice",
      rootDocumentId: binding.documentId,
    }).ir;
    if (!ir) continue;
    const root = ir.cells.find((cell) => cell.id === ir.topCellId);
    if (!root) continue;
    for (const scope of listAuthoredCircuitScopes(graph, binding, ir)) {
      const resolved = resolveAuthoredCircuitScope(graph, binding, ir, scope);
      if (!resolved.ok) continue;
      const qualify = resolved.node;
      let visits = 0;
      function visit(
        cell: DesignNetlistCell,
        nodes: Map<string, string>,
        path: string[],
        ancestors: Set<string>,
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
          const vector = `v(${node})`.toLowerCase();
          const name = [...scope.callPath, ...path, net.name].join("/");
          const names = labels.get(vector) ?? new Set<string>();
          names.add(name);
          labels.set(vector, names);
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
          );
        }
      }
      visit(root, new Map(), [], new Set());
    }
  }
  return Object.fromEntries(
    [...labels].map(([vector, names]) => [vector, [...names].join(" · ")]),
  );
}
