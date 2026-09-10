import type {
  CircuitProject,
  ProjectSourceSimulationSetup,
  SimulationRunVariant,
} from "@icm/model";
import {
  compileSourceSimulation,
  insertSimulationText,
  type SimulationSourceDiagnostic,
} from "@icm/netlist";
import {
  deckNeedsModelLibrary,
  formatModelLibrarySelection,
} from "@icm/spice-run";
import { problem, type Capabilities, type Problem } from "./contract.js";
import type { ExecutionInput } from "./executor.js";
import { sha256 } from "./content-digest.js";

function compilationProblem(diagnostics: SimulationSourceDiagnostic[]): {
  ok: false;
  error: Problem;
} {
  return {
    ok: false,
    error: {
      code: "SIMULATION_COMPILE_REFUSED",
      message: "Correct the located input and prepare again",
      stage: "prepare",
      recovery: "fix-input",
      diagnostics,
    },
  };
}

/** Shared source adapter. No execution, Project mutation or private GUI deck path. */
export async function prepareSourceExecutionInput(
  project: CircuitProject,
  setup: ProjectSourceSimulationSetup,
  caps: Capabilities,
  variant?: SimulationRunVariant,
) {
  const compiled = compileSourceSimulation(project, setup, variant);
  if (!compiled.ok) return compilationProblem(compiled.diagnostics);
  const { config } = compiled;
  const profile = caps.profiles.find(
    (item) => item.id === config.environment.profileId,
  );
  if (!profile)
    return problem(
      "SIMULATION_PROFILE_UNKNOWN",
      "Select a Profile advertised by capabilities",
      "prepare",
    );
  if (
    config.environment.corner &&
    !profile.corners.includes(config.environment.corner)
  )
    return problem(
      "SIMULATION_CORNER_UNSUPPORTED",
      "The selected Profile does not support this corner",
      "prepare",
    );
  if (caps.rawfileCollection !== "declared-single-ascii")
    return problem(
      "SIMULATION_COLLECTION_UNAVAILABLE",
      "This executor does not yet support declared source output collection; editing and saving remain available",
      "prepare",
      "retry-after",
    );
  const dependencies = structuredClone(setup.input.dependencies);
  const available = new Map(
    (profile.dependencies ?? []).map((item) => [item.id, item.sha256]),
  );
  const unavailable = dependencies.filter(
    (item) => available.get(item.id) !== item.sha256,
  );
  if (unavailable.length)
    return compilationProblem(
      unavailable.map((item) => ({
        code: "SIMULATION_DEPENDENCY_UNAVAILABLE",
        severity: "error",
        message: `Dependency ${item.id} (${item.mountPath}) is not available in the selected Profile`,
        path: item.mountPath,
      })),
    );
  const files = structuredClone(compiled.files);
  const sourceMaps = structuredClone(compiled.sourceMaps);
  const entryIndex = files.findIndex((file) => file.path === compiled.entry);
  const entry = files[entryIndex]!;
  if (compiled.generated.some((file) => deckNeedsModelLibrary(file.text))) {
    // Profile-owned models are mounted by identity/digest. Neither the client
    // nor the author needs to know the host's absolute model-library path.
    const libraries = profile.dependencies ?? [];
    if (libraries.length !== 1)
      return problem(
        "SIMULATION_MODEL_LIBRARY_UNAVAILABLE",
        "Canvas model generation requires one qualified model-library dependency from this Profile",
        "prepare",
      );
    const library = libraries[0]!;
    let dependency = dependencies.find((item) => item.id === library.id);
    if (!dependency) {
      const occupied = new Set([
        ...files.map((file) => file.path),
        ...dependencies.map((item) => item.mountPath),
        setup.input.configPath,
      ]);
      let mountPath = "icm-models.lib";
      for (
        let index = 1;
        occupied.has(mountPath) ||
        [...occupied].some((path) => path.startsWith(`${mountPath}/`));
        index++
      )
        mountPath = `icm-models-${index}.lib`;
      dependency = { ...library, mountPath };
      dependencies.push(dependency);
    }
    const selectedCorner =
      config.environment.corner ?? caps.modelLibrary?.section;
    if (!selectedCorner || !profile.corners.includes(selectedCorner))
      return problem(
        "SIMULATION_CORNER_UNSUPPORTED",
        "Select a qualified model corner before preparation",
        "prepare",
      );
    const existingLoads = compiled.includes.filter(
      (include) => include.target === dependency.mountPath,
    );
    if (
      existingLoads.some(
        (load) => load.section?.toLowerCase() !== selectedCorner.toLowerCase(),
      )
    )
      return compilationProblem(
        existingLoads.map((load) => ({
          code: "SIMULATION_MODEL_CORNER_CONFLICT",
          severity: "error",
          message: `Canvas models require .lib section ${selectedCorner}; this authored load selects a different model contract`,
          path: load.path,
          sourceRef: load.sourceRef,
        })),
      );
    if (!existingLoads.length) {
      // Entry includes resolve relative to the entry's directory in ngspice 46.
      const relative =
        "../".repeat(compiled.entry.split("/").length - 1) +
        dependency.mountPath;
      const end = entry.text.indexOf("\n");
      let directive: string;
      try {
        directive = formatModelLibrarySelection({
          directive: "lib",
          path: relative,
          section: selectedCorner,
        });
      } catch {
        return problem(
          "SIMULATION_MODEL_PATH_INVALID",
          "The model mount cannot be represented as a literal SPICE include path",
          "prepare",
        );
      }
      const preamble = `* Profile models (generated)\n${directive}\n`;
      const mapped = insertSimulationText(
        { ...entry, ...sourceMaps[entryIndex]! },
        end < 0 ? entry.text.length : end + 1,
        (end < 0 ? "\n" : "") + preamble,
        { kind: "generated", purpose: "environment" },
      );
      files[entryIndex] = { path: mapped.path, text: mapped.text };
      sourceMaps[entryIndex] = { path: mapped.path, segments: mapped.segments };
    }
  }
  const output = config.collection.rawfile;
  if (
    output !== null &&
    [
      setup.input.configPath,
      ...files.map((file) => file.path),
      ...dependencies.map((dep) => dep.mountPath),
    ].some(
      (path) =>
        path === output ||
        path.startsWith(`${output}/`) ||
        output.startsWith(`${path}/`),
    )
  )
    return compilationProblem([
      {
        code: "SIMULATION_COLLECTION_INPUT_COLLISION",
        severity: "error",
        message:
          "The collected rawfile must not overwrite an input or dependency",
        path: setup.input.configPath,
        field: "collection.rawfile",
      },
    ]);
  if (caps.maxInputFiles !== undefined && files.length > caps.maxInputFiles)
    return problem(
      "SIMULATION_INPUT_FILE_LIMIT",
      `This executor accepts ${caps.maxInputFiles} input files; this source input has ${files.length}. The Project can still be saved.`,
      "prepare",
    );
  const bytes = files.reduce(
    (count, file) => count + new TextEncoder().encode(file.text).length,
    0,
  );
  if (bytes > caps.maxInputBytes)
    return problem(
      "SIMULATION_INPUT_BYTE_LIMIT",
      `Prepared input is ${bytes} bytes; this executor accepts ${caps.maxInputBytes}. The Project can still be saved.`,
      "prepare",
    );
  const inputRevision = await sha256(
    JSON.stringify({
      source: setup.input,
      electricalHash: compiled.electricalHash,
      profile,
      files,
      dependencies,
      outputs: compiled.outputs,
      deviceOperatingPoints: compiled.deviceOperatingPoints,
    }),
  );
  const preparedDeck = files[entryIndex]!.text;
  const input: ExecutionInput & { preparedDeck: string } = {
    mode: "raw",
    netlist: "",
    testbench: preparedDeck,
    preparedDeck,
    inputRevision,
    environment: config.environment,
    entryPath: compiled.entry,
    files,
    dependencies,
    collection: config.collection,
  };
  return {
    ok: true as const,
    input,
    digest: await sha256(JSON.stringify(input)),
    vectors: compiled.vectors,
    outputs: compiled.outputs,
    deviceOperatingPoints: compiled.deviceOperatingPoints,
    measurements: config.measurements,
    warnings: compiled.warnings.map((item) => item.message),
    authoredFiles: compiled.authoredFiles,
    generated: compiled.generated,
    sourceMaps,
  };
}
