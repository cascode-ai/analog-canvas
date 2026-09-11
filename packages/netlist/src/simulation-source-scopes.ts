import type {
  SimulationCircuitBinding,
  SimulationCircuitScope,
} from "@icm/model";
import type { InstanceStatement } from "@icm/spice";
import type { DesignNetlistIR } from "./ir.js";
import type { SimulationSourceGraph } from "./simulation-source-graph.js";

interface AuthoredCell {
  name: string;
  ports: string[];
  instances: InstanceStatement[];
}

/** Enumerate only call paths that the canonical scope resolver can prove. */
export function listAuthoredCircuitScopes(
  graph: SimulationSourceGraph,
  binding: SimulationCircuitBinding,
  circuit: DesignNetlistIR,
): SimulationCircuitScope[] {
  if (binding.emission === "top-level")
    return [{ bindingId: binding.id, callPath: [] }];
  const root = circuit.cells.find((cell) => cell.id === circuit.topCellId);
  if (!root) return [];
  const top: AuthoredCell = { name: "", ports: [], instances: [] };
  const definitions = new Map<string, AuthoredCell[]>();
  const stack = [top];
  for (const { statement } of graph.statements) {
    if (statement.kind === "subckt_start") {
      const cell = {
        name: statement.name,
        ports: statement.ports,
        instances: [] as InstanceStatement[],
      };
      const key = cell.name.toLowerCase();
      definitions.set(key, [...(definitions.get(key) ?? []), cell]);
      stack.push(cell);
    } else if (statement.kind === "subckt_end") {
      if (stack.length > 1) stack.pop();
    } else if (statement.kind === "instance")
      stack.at(-1)!.instances.push(statement);
  }
  const result: SimulationCircuitScope[] = [];
  let visits = 0;
  function visit(cell: AuthoredCell, path: string[], ancestors: Set<string>) {
    if (path.length >= 64 || ++visits > 4096) return;
    for (const call of cell.instances) {
      if (call.family !== "subcircuit") continue;
      const callPath = [...path, call.name];
      const master = call.master?.toLowerCase() ?? "";
      if (master === root!.name.toLowerCase()) {
        const scope = { bindingId: binding.id, callPath };
        if (resolveAuthoredCircuitScope(graph, binding, circuit, scope).ok)
          result.push(scope);
      } else if (!ancestors.has(master)) {
        const children = definitions.get(master);
        if (children?.length === 1)
          visit(children[0]!, callPath, new Set([...ancestors, master]));
      }
    }
  }
  visit(top, [], new Set());
  return result;
}
export type AuthoredScope =
  | {
      ok: true;
      prefix: string[];
      node(name: string): string;
      vector(vector: string): string;
    }
  | { ok: false; message: string };

/** Resolve actual X-call interfaces, not textual prefix guesses for formal/global nodes. */
export function resolveAuthoredCircuitScope(
  graph: SimulationSourceGraph,
  binding: SimulationCircuitBinding,
  circuit: DesignNetlistIR,
  scope: SimulationCircuitScope,
): AuthoredScope {
  const root = circuit.cells.find((cell) => cell.id === circuit.topCellId)!;
  const globals = new Set([
    "0",
    ...circuit.globals.map((name) => name.toLowerCase()),
  ]);
  const top: AuthoredCell = { name: "", ports: [], instances: [] };
  const definitions = new Map<string, AuthoredCell[]>();
  const parents: AuthoredCell[] = [top];
  let conditionalDepth = 0;
  const conditionalCalls = new Set<InstanceStatement>();
  for (const { statement } of graph.statements) {
    if (statement.kind === "global")
      for (const name of statement.names) globals.add(name.toLowerCase());
    if (statement.kind === "conditional") {
      if (statement.form === "if") conditionalDepth++;
      else if (statement.form === "endif") conditionalDepth--;
    }
    if (statement.kind === "subckt_start") {
      const cell: AuthoredCell = {
        name: statement.name,
        ports: statement.ports,
        instances: [],
      };
      const key = cell.name.toLowerCase();
      definitions.set(key, [...(definitions.get(key) ?? []), cell]);
      parents.push(cell);
    } else if (statement.kind === "subckt_end") {
      if (parents.length > 1) parents.pop();
    } else if (statement.kind === "instance") {
      parents.at(-1)!.instances.push(statement);
      if (conditionalDepth) conditionalCalls.add(statement);
    }
  }
  const fail = (message: string): AuthoredScope => ({ ok: false, message });
  if (binding.emission === "top-level" && scope.callPath.length)
    return fail("Top-level bindings use an empty authored callPath");
  if (binding.emission === "subcircuit" && !scope.callPath.length)
    return fail(`Binding ${binding.id} needs an authored X-call path`);
  let parent = top;
  let prefix: string[] = [];
  let ports = new Map<string, string>();
  const qualify = (name: string): string => {
    const key = name.toLowerCase();
    return globals.has(key)
      ? key
      : (ports.get(key) ?? [...prefix, key].join("."));
  };
  for (let index = 0; index < scope.callPath.length; index++) {
    const name = scope.callPath[index]!;
    const matches = parent.instances.filter(
      (instance) => instance.name.toLowerCase() === name.toLowerCase(),
    );
    if (matches.length !== 1 || matches[0]!.family !== "subcircuit")
      return fail(
        `Call ${name} must identify exactly one X instance in ${parent.name || "the top level"}`,
      );
    const call = matches[0]!;
    if (conditionalCalls.has(call))
      return fail(
        `Canvas acquisition through conditional call ${name} cannot be statically proven; use a native vector for this experiment`,
      );
    const last = index === scope.callPath.length - 1;
    let child: AuthoredCell;
    if (last) {
      if (call.master?.toLowerCase() !== root.name.toLowerCase())
        return fail(
          `Call ${name} targets ${call.master}, not generated Cell ${root.name}`,
        );
      child = {
        name: root.name,
        ports: root.ports.map((port) => port.netName),
        instances: [],
      };
    } else {
      const candidates =
        definitions.get(call.master?.toLowerCase() ?? "") ?? [];
      if (candidates.length !== 1)
        return fail(
          `Call ${name} needs one unambiguous authored subcircuit definition`,
        );
      child = candidates[0]!;
    }
    if (child.ports.length !== call.nodes.length)
      return fail(
        `Call ${name} has ${call.nodes.length} nodes; ${child.name} requires ${child.ports.length}`,
      );
    const nextPorts = new Map(
      child.ports.map((port, i) => [
        port.toLowerCase(),
        qualify(call.nodes[i]!),
      ]),
    );
    prefix = [...prefix, call.name.toLowerCase()];
    ports = nextPorts;
    parent = child;
  }
  return {
    ok: true,
    prefix,
    node: qualify,
    vector(vector) {
      const voltage = /^v\((.+)\)$/iu.exec(vector);
      if (voltage) return `v(${qualify(voltage[1]!)})`;
      const current = /^i\((.+)\)$/iu.exec(vector);
      if (current && prefix.length) {
        const branch = current[1]!.toLowerCase();
        return `i(v.${prefix.join(".")}.${branch.startsWith("v.") ? branch.slice(2) : branch})`;
      }
      return vector;
    },
  };
}
