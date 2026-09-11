import type {
  CircuitProject,
  SimulationSourceInput,
  SimulationSourceExpression,
} from "@icm/model";
import {
  analyzeDesignNetlist,
  inspectSimulationSourceGraph,
  listAuthoredCircuitScopes,
  simulationSignalNames,
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
    if (!graph.paths.includes(binding.path)) continue;
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
      for (const option of options.terminalCurrent)
        choices.push({
          kind: "current",
          label: prefix + option.label,
          expression: { ...option.target, circuit: scope },
        });
    }
  }
  // Native top-level nodes and independent voltage-source currents need no Canvas mapping.
  const vectors = new Map<string, string>();
  const addVector = (vector: string) => {
    const key = vector.toLowerCase();
    if (!vectors.has(key)) vectors.set(key, vector);
  };
  const names = simulationSignalNames(project, input);
  for (const [vector, name] of Object.entries(names)) {
    choices.push({
      kind: "voltage",
      label: `${name.replaceAll("/", " · ")} — ${vector}`,
      expression: { kind: "vector", vector },
    });
    addVector(vector);
  }
  let depth = 0;
  for (const { statement } of graph.statements) {
    if (statement.kind === "subckt_start") depth++;
    else if (statement.kind === "subckt_end") depth = Math.max(0, depth - 1);
    if (depth || statement.kind !== "instance") continue;
    for (const node of statement.nodes) addVector(`v(${node})`);
    if (statement.family === "voltage-source")
      addVector(`i(${statement.name})`);
  }
  for (const vector of vectors.values())
    if (!names[vector.toLowerCase()])
      choices.push({
        kind: vector.startsWith("v(") ? "voltage" : "current",
        label: vector,
        expression: { kind: "vector", vector },
      });
  return choices;
}
