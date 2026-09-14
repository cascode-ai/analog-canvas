import type {
  SimulationCircuitBinding,
  SimulationCircuitScope,
} from "@icm/model";
import type { DesignNetlistIR } from "./ir.js";
import type { SimulationSourceGraph } from "./simulation-source-graph.js";
import {
  authoredCircuitScopes,
  type AuthoredCircuitEvent,
  type ResolvedAuthoredScope,
} from "./authored-circuit-scopes.js";

function scopes(
  graph: SimulationSourceGraph,
  binding: SimulationCircuitBinding,
  circuit: DesignNetlistIR,
) {
  const events: AuthoredCircuitEvent[] = [];
  let conditionalDepth = 0;
  for (const { statement } of graph.statements) {
    if (statement.kind === "conditional") {
      if (statement.form === "if") conditionalDepth++;
      else if (statement.form === "endif")
        conditionalDepth = Math.max(0, conditionalDepth - 1);
    } else if (statement.kind === "subckt_start")
      events.push({
        kind: "definition",
        name: statement.name,
        ports: statement.ports,
      });
    else if (statement.kind === "subckt_end") events.push({ kind: "end" });
    else if (statement.kind === "global")
      events.push({ kind: "globals", names: statement.names });
    else if (statement.kind === "instance")
      events.push({
        kind: "call",
        name: statement.name,
        nodes: statement.nodes,
        ...(statement.family === "subcircuit" && statement.master
          ? { master: statement.master }
          : {}),
        conditional: conditionalDepth > 0,
      });
  }
  return authoredCircuitScopes(events, binding, circuit, {
    key: (name) => name.toLowerCase(),
    separator: ".",
    flatDefinitions: true,
  });
}

/** Existing source adapter; traversal is shared with native VACASK. */
export function listAuthoredCircuitScopes(
  graph: SimulationSourceGraph,
  binding: SimulationCircuitBinding,
  circuit: DesignNetlistIR,
): SimulationCircuitScope[] {
  return scopes(graph, binding, circuit).list();
}
export type AuthoredScope =
  | Exclude<ResolvedAuthoredScope, { ok: true }>
  | (Extract<ResolvedAuthoredScope, { ok: true }> & {
      vector(name: string): string;
    });

export function resolveAuthoredCircuitScope(
  graph: SimulationSourceGraph,
  binding: SimulationCircuitBinding,
  circuit: DesignNetlistIR,
  scope: SimulationCircuitScope,
): AuthoredScope {
  const resolved = scopes(graph, binding, circuit).resolve(scope);
  if (!resolved.ok) return resolved;
  return {
    ...resolved,
    vector(vector) {
      const voltage = /^v\((.+)\)$/iu.exec(vector);
      if (voltage) return `v(${resolved.node(voltage[1]!)})`;
      const current = /^i\((.+)\)$/iu.exec(vector);
      if (current && resolved.prefix.length) {
        const branch = current[1]!.toLowerCase();
        return `i(v.${resolved.prefix.join(".")}.${branch.startsWith("v.") ? branch.slice(2) : branch})`;
      }
      return vector;
    },
  };
}
