import type { SimulationSourceInput } from "@icm/model";
import {
  authoredModelSymbols,
  type ModelPrimitive,
} from "./authored-circuit-scopes.js";
import { inspectVacaskSourceGraph } from "./vacask-source.js";
import { vacaskAuthoredCircuitEvents } from "./vacask-source-scopes.js";

export interface NativeMasterSymbol {
  name: string;
  primitives: ModelPrimitive[];
}

/** Read-only Profile evidence derived from a specific dependency and section.
 * Never Project data, executable text, or a claim of electrical qualification. */
export interface NativeModelLibrarySymbols {
  dependencyId: string;
  sha256: string;
  section?: string | undefined;
  masters: NativeMasterSymbol[];
}

export interface ResolvedNativeModelLibrarySymbols {
  mountPath: string;
  section?: string | undefined;
  masters: NativeMasterSymbol[];
}

/**
 * @internal Test helper for VACASK model-library fixture inspection until the
 * VACASK engine removal follow-up deletes this module.
 */
export function inspectNativeModelLibrarySymbols(
  input: SimulationSourceInput,
  names: readonly string[],
) {
  const graph = inspectVacaskSourceGraph(input);
  return {
    masters: graph.diagnostics.some((d) => d.severity === "error")
      ? []
      : authoredModelSymbols(vacaskAuthoredCircuitEvents(graph), names, {
          key: (name) => name,
        }),
    diagnostics: graph.diagnostics,
  };
}

/** A summary without a matching declared content digest is not evidence. */
export function resolveNativeModelLibraries(
  input: SimulationSourceInput,
  libraries: readonly NativeModelLibrarySymbols[],
): ResolvedNativeModelLibrarySymbols[] {
  return libraries.flatMap((library) =>
    input.dependencies
      .filter(
        (d) => d.id === library.dependencyId && d.sha256 === library.sha256,
      )
      .map((d) => ({
        mountPath: d.mountPath,
        section: library.section,
        masters: library.masters,
      })),
  );
}
