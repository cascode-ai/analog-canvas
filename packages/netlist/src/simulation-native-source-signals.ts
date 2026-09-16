import type { SimulationSourceInput } from "@icm/model";
import { inspectVacaskSourceGraph } from "./vacask-source.js";
import { vacaskAuthoredCircuitEvents } from "./vacask-source-scopes.js";
import { vacaskIdentifier } from "./vacask-printer.js";

/** Exact literal top-level acquisitions, without pretending to know runtime
 * elaboration, unknown OSDI model outputs or subcircuit internals. */
export function nativeSourceAcquisitions(input: SimulationSourceInput) {
  const events = vacaskAuthoredCircuitEvents(inspectVacaskSourceGraph(input));
  const nodes = new Set<string>();
  const models = new Map<string, (string | undefined)[]>();
  const calls: Extract<(typeof events)[number], { kind: "call" }>[] = [];
  let depth = 0;
  for (const event of events) {
    if (event.kind === "definition") {
      if (!depth)
        models.set(event.name, [...(models.get(event.name) ?? []), undefined]);
      depth++;
    } else if (event.kind === "end") depth = Math.max(0, depth - 1);
    else if (!depth && event.kind === "opaque-master")
      models.set(event.name, [...(models.get(event.name) ?? []), event.module]);
    else if (!depth && event.kind === "call" && !event.conditional) {
      calls.push(event);
      // Incomplete/invalid source remains editable. Don't throw from rendering
      // Helper when the native compiler will diagnose an invalid identifier.
      for (const node of event.nodes)
        if (node && !/\s/u.test(node)) nodes.add(node);
    }
  }
  const result = [...nodes].map((vector) => ({
    quantity: "voltage" as "voltage" | "current",
    vector,
    save: `v(${vacaskIdentifier(vector)})`,
  }));
  const counts = new Map<string, number>();
  for (const call of calls)
    counts.set(call.name, (counts.get(call.name) ?? 0) + 1);
  for (const call of calls) {
    const modules = call.master && models.get(call.master);
    // Branch identity follows the declared module, never the first letter of
    // the instance name. Unknown/redefined masters don't get guessed currents.
    if (
      !call.name ||
      /\s/u.test(call.name) ||
      counts.get(call.name) !== 1 ||
      !modules ||
      modules.length !== 1 ||
      !["vsource", "inductor"].includes(modules[0] ?? "")
    )
      continue;
    result.push({
      quantity: "current",
      vector: `${call.name}:flow(br)`,
      save: `i(${vacaskIdentifier(call.name)})`,
    });
  }
  return result;
}
