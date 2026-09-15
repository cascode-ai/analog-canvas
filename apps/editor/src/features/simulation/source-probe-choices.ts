import type {
  CircuitProject,
  SimulationSourceInput,
  SimulationSourceExpression,
  ProjectSimulationFolder,
} from "@icm/model";
import {
  resolveSourceSimulationContext,
  type Capabilities,
} from "@icm/simulation-service";
import {
  analyzeDesignNetlist,
  inspectVacaskSourceGraph,
  vacaskCircuitScopes,
  nativeSourceAcquisitions,
  simulationSignalNames,
  nativeSimulationDevices,
  nativeDeviceOpAcquisitions,
  vacaskIdentifier,
  type NativeModelLibrarySymbols,
} from "@icm/netlist";
import { deriveSimulationProbeOptions } from "./simulation-probe-options";

export interface SourceProbeChoice {
  label: string;
  kind: "voltage" | "current" | "device-op";
  expression: SimulationSourceExpression;
}

/** Offline authoring stays available. Invalid Profile context must not lend its
 * model evidence to a picker; explain the omission without blocking text edits. */
export function sourceProbeEnvironment(
  project: CircuitProject,
  folder: ProjectSimulationFolder,
  profiles?: Capabilities["profiles"],
): {
  input: SimulationSourceInput;
  libraries: readonly NativeModelLibrarySymbols[];
  notice?: string;
} {
  if (!profiles) return { input: folder.input, libraries: [] };
  const context = resolveSourceSimulationContext(project, folder, profiles);
  if (!context.ok)
    return {
      input: folder.input,
      libraries: [],
      notice:
        "Profile model choices unavailable: " +
        ("diagnostics" in context
          ? context.diagnostics.map((d) => d.message).join("; ")
          : context.error.message),
    };
  return {
    input: {
      ...folder.input,
      files: context.files,
      dependencies: context.dependencies,
    },
    libraries: context.profile.modelSymbols ?? [],
  };
}
export function sourceProbeChoices(
  project: CircuitProject,
  input: SimulationSourceInput,
  libraries: readonly NativeModelLibrarySymbols[] = [],
): SourceProbeChoice[] {
  const graph = inspectVacaskSourceGraph(input);
  const choices: SourceProbeChoice[] = [];
  for (const device of nativeSimulationDevices(project, input, libraries))
    for (const acquisition of nativeDeviceOpAcquisitions(device))
      choices.push({
        kind: "device-op",
        label: `${acquisition.reference} · ${acquisition.parameter} (model-native) — ${acquisition.save}`,
        expression: { kind: "vector", vector: acquisition.save },
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
