import type {
  CircuitProject,
  SimulationSourceInput,
  SimulationSourceExpression,
} from "@icm/model";
import {
  analyzeDesignNetlist,
  inspectSimulationSourceGraph,
  listAuthoredCircuitScopes,
} from "@icm/netlist";
import { deriveSimulationProbeOptions } from "./simulation-probe-options";

export interface SourceProbeChoice {
  label: string;
  kind: "voltage" | "current";
  expression: SimulationSourceExpression;
}
export function sourceProbeChoices(
  project: CircuitProject,
  input: SimulationSourceInput,
): SourceProbeChoice[] {
  const graph = inspectSimulationSourceGraph(input);
  const choices: SourceProbeChoice[] = [];
  for (const binding of input.circuitBindings) {
    const analysis = analyzeDesignNetlist(project, {
      format: "spice",
      rootDocumentId: binding.documentId,
    });
    if (!analysis.ir) continue;
    const scopes = listAuthoredCircuitScopes(graph, binding, analysis.ir);
    const options = deriveSimulationProbeOptions(project, binding.documentId);
    for (const scope of scopes) {
      const prefix = scope.callPath.length
        ? `${scope.callPath.join("/")} · `
        : "";
      for (const option of options.voltage)
        choices.push({
          kind: "voltage",
          label: prefix + option.label,
          expression: { ...option.target, circuit: scope },
        });
      for (const option of options.terminalCurrent)
        choices.push({
          kind: "current",
          label: prefix + option.label,
          expression: { ...option.target, circuit: scope },
        });
    }
  }
  // Native top-level nodes and independent voltage-source currents need no Canvas mapping.
  const vectors = new Set<string>();
  let depth = 0;
  for (const { statement } of graph.statements) {
    if (statement.kind === "subckt_start") depth++;
    else if (statement.kind === "subckt_end") depth = Math.max(0, depth - 1);
    if (depth || statement.kind !== "instance") continue;
    for (const node of statement.nodes) vectors.add(`v(${node})`);
    if (statement.family === "voltage-source")
      vectors.add(`i(${statement.name})`);
  }
  for (const vector of vectors)
    choices.push({
      kind: vector.startsWith("v(") ? "voltage" : "current",
      label: vector,
      expression: { kind: "vector", vector },
    });
  return choices;
}
