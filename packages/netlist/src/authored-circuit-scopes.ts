import type {
  SimulationCircuitBinding,
  SimulationCircuitScope,
} from "@icm/model";
import type { DesignNetlistIR } from "./ir.js";

/** Transient topology facts, not a saved project protocol or full language AST. */
export type AuthoredCircuitEvent =
  | { kind: "definition"; name: string; ports: string[] }
  | { kind: "end" }
  | { kind: "opaque-master"; name: string; module?: string }
  | { kind: "globals"; names: string[] }
  | {
      kind: "call";
      name: string;
      nodes: string[];
      master?: string;
      conditional?: boolean;
    };

type Call = Extract<AuthoredCircuitEvent, { kind: "call" }>;
interface Definition {
  name: string;
  ports: string[];
  calls: Call[];
  definitions: Map<string, Definition[]>;
  opaque: Set<string>;
}
export type ResolvedAuthoredScope =
  | {
      ok: true;
      prefix: string[];
      node(name: string): string;
      instance(name: string): string;
    }
  | { ok: false; message: string };

/** One resolver owns enumeration and explicit resolution, including formal-port
 * substitution. Adapters own lexical identity and simulator path spelling. */
export function authoredCircuitScopes(
  events: readonly AuthoredCircuitEvent[],
  binding: SimulationCircuitBinding,
  circuit: DesignNetlistIR,
  syntax: {
    key(name: string): string;
    separator: string;
    flatDefinitions?: boolean;
  },
) {
  const make = (name: string, ports: string[] = []): Definition => ({
    name,
    ports,
    calls: [],
    definitions: new Map(),
    opaque: new Set(),
  });
  const top = make("");
  const parents = [top];
  const key = syntax.key;
  const globals = new Set(["0", ...circuit.globals.map(key)]);
  for (const event of events) {
    const parent = parents.at(-1)!;
    if (event.kind === "definition") {
      const definition = make(event.name, event.ports);
      const owner = syntax.flatDefinitions ? top : parent;
      const name = key(event.name);
      owner.definitions.set(name, [
        ...(owner.definitions.get(name) ?? []),
        definition,
      ]);
      parents.push(definition);
    } else if (event.kind === "end") {
      if (parents.length > 1) parents.pop();
    } else if (event.kind === "globals") {
      for (const name of event.names) globals.add(key(name));
    } else if (event.kind === "opaque-master")
      parent.opaque.add(key(event.name));
    else parent.calls.push(event);
  }
  const root = circuit.cells.find((cell) => cell.id === circuit.topCellId);
  const generated = root
    ? make(
        root.name,
        root.ports.map((p) => p.netName),
      )
    : undefined;
  // Generated definitions are top-level, but never win over a local master.
  function lookup(parent: Definition, name: string): Definition | undefined {
    const normalized = key(name);
    for (const owner of parent === top ? [top] : [parent, top]) {
      if (owner.opaque.has(normalized)) return undefined;
      const definitions = owner.definitions.get(normalized);
      if (definitions)
        return definitions.length === 1 ? definitions[0] : undefined;
    }
    return generated && key(generated.name) === normalized
      ? generated
      : undefined;
  }
  const fail = (message: string): ResolvedAuthoredScope => ({
    ok: false,
    message,
  });
  function resolve(scope: SimulationCircuitScope): ResolvedAuthoredScope {
    if (scope.bindingId !== binding.id)
      return fail(`Scope does not belong to binding ${binding.id}`);
    if (!generated)
      return fail(`Binding ${binding.id} has no generated root Cell`);
    if (binding.emission === "top-level" && scope.callPath.length)
      return fail("Top-level bindings use an empty authored callPath");
    if (binding.emission === "subcircuit" && !scope.callPath.length)
      return fail(`Binding ${binding.id} needs an authored instance call path`);
    let parent = top;
    let prefix: string[] = [];
    let ports = new Map<string, string>();
    const qualify = (name: string): string => {
      const normalized = key(name);
      return globals.has(normalized)
        ? normalized
        : (ports.get(normalized) ??
            [...prefix, normalized].join(syntax.separator));
    };
    for (let i = 0; i < scope.callPath.length; i++) {
      const name = scope.callPath[i]!;
      const matches = parent.calls.filter(
        (call) => key(call.name) === key(name),
      );
      if (matches.length !== 1)
        return fail(
          `Call ${name} must identify exactly one instance in ${parent.name || "the top level"}`,
        );
      const call = matches[0]!;
      if (call.conditional)
        return fail(
          `Canvas acquisition through conditional call ${name} cannot be statically proven; use a native vector for this experiment`,
        );
      const child = call.master ? lookup(parent, call.master) : undefined;
      if (!child)
        return fail(
          `Call ${name} needs one unambiguous visible subcircuit definition`,
        );
      if (i === scope.callPath.length - 1 && child !== generated)
        return fail(
          `Call ${name} does not target generated Cell ${generated.name}`,
        );
      if (child.ports.length !== call.nodes.length)
        return fail(
          `Call ${name} has ${call.nodes.length} nodes; ${child.name} requires ${child.ports.length}`,
        );
      const nextPorts = new Map(
        child.ports.map((port, index) => [
          key(port),
          qualify(call.nodes[index]!),
        ]),
      );
      prefix = [...prefix, key(call.name)];
      ports = nextPorts;
      parent = child;
    }
    return {
      ok: true,
      prefix,
      node: qualify,
      instance: (name) => [...prefix, key(name)].join(syntax.separator),
    };
  }
  function list(): SimulationCircuitScope[] {
    if (!generated) return [];
    if (binding.emission === "top-level")
      return [{ bindingId: binding.id, callPath: [] }];
    const result: SimulationCircuitScope[] = [];
    let visits = 0;
    function visit(
      parent: Definition,
      path: string[],
      ancestors: Set<Definition>,
    ) {
      if (path.length >= 64 || ++visits > 4096) return;
      for (const call of parent.calls) {
        if (!call.master || call.conditional) continue;
        const child = lookup(parent, call.master);
        const callPath = [...path, call.name];
        if (child === generated) {
          const scope = { bindingId: binding.id, callPath };
          if (resolve(scope).ok) result.push(scope);
        } else if (child && !ancestors.has(child))
          visit(child, callPath, new Set([...ancestors, child]));
      }
    }
    visit(top, [], new Set([top]));
    return result;
  }
  return { resolve, list };
}
