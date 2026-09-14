import type {
  CircuitProject,
  SimulationSourceInput,
  SimulationSourceExpression,
} from "@icm/model";
import {
  analyzeDesignNetlist,
  inspectVacaskSourceGraph,
  vacaskCircuitScopes,
  nativeSourceAcquisitions,
  simulationSignalNames,
  nativeSimulationDevices,
  nativeDeviceOpVectors,
  vacaskIdentifier,
} from "@icm/netlist";
import { deriveSimulationProbeOptions } from "./simulation-probe-options";

export interface SourceProbeChoice {
  label: string;
  kind: "voltage" | "current" | "device-op";
  expression: SimulationSourceExpression;
}
export function sourceProbeChoices(
  project: CircuitProject,
  input: SimulationSourceInput,
): SourceProbeChoice[] {
  const graph = inspectVacaskSourceGraph(input);
  const choices: SourceProbeChoice[] = [];
  for (const device of nativeSimulationDevices(project, input))
    for (const vector of nativeDeviceOpVectors(device))
      choices.push({
        kind: "device-op",
        label: `${device.reference} · ${vector.slice(vector.lastIndexOf("[") + 1, -1).toUpperCase()} — ${vector}`,
        expression: { kind: "vector", vector },
      });
  for (const binding of input.circuitBindings) {
    if (!graph.paths.includes(binding.path)) continue;
    const analysis = analyzeDesignNetlist(project, {
      format: "spice",
      rootDocumentId: binding.documentId,
    });
    if (!analysis.ir) continue;
    const scopes = vacaskCircuitScopes(graph, binding, analysis.ir).list();
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
  const names = simulationSignalNames(project, input);
  const mappedSelectors = new Set<string>();
  for (const [vector, name] of Object.entries(names)) {
    const selector = `v(${vacaskIdentifier(vector)})`;
    choices.push({
      kind: "voltage",
      label: `${name.replaceAll("/", " · ")} — ${vector}`,
      expression: { kind: "vector", vector: selector },
    });
    mappedSelectors.add(selector);
  }
  for (const acquisition of nativeSourceAcquisitions(input))
    if (!mappedSelectors.has(acquisition.save))
      choices.push({
        kind: acquisition.quantity,
        label: acquisition.save,
        expression: { kind: "vector", vector: acquisition.save },
      });
  return choices;
}
