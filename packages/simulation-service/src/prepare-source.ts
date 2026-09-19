import type {
  CircuitProject,
  ProjectSimulationFolder,
  SimulationRunVariant,
} from "@icm/model";
import {
  nativeSimulationDevices,
  compileNativeDeviceOperatingPoints,
  type SimulationSourceDiagnostic,
} from "@icm/netlist";
import { resolveSourceSimulationContext } from "./source-context.js";
import { problem, type Capabilities, type Problem } from "./contract.js";
import type { ExecutionInput } from "./executor.js";
import { sha256 } from "./content-digest.js";
import { sourceInputRevision } from "./input-identity.js";
import { inspectNativeAnalyses } from "./native-source-analysis.js";
import { outputVolumeWarning } from "./result-volume.js";
import { prepareNgspiceExecutionInput } from "./prepare-ngspice.js";
import { resolveSimulationEngine } from "./profile-engine.js";

async function sourceCompilationProblem(
  diagnostics: SimulationSourceDiagnostic[],
  folder: ProjectSimulationFolder,
): Promise<{ ok: false; error: Problem }> {
  return {
    ok: false,
    error: {
      code: "SIMULATION_COMPILE_REFUSED",
      message: "Correct the located input and prepare again",
      stage: "prepare",
      recovery: "fix-input",
      diagnostics: await Promise.all(
        diagnostics.map(async (diagnostic) => {
          const file = folder.input.files.find(
            (file) =>
              file.path === (diagnostic.sourceRef?.fileId ?? diagnostic.path),
          );
          if (!file) return diagnostic;
          const start = diagnostic.sourceRef?.start;
          return {
            ...diagnostic,
            source: {
              scope: "authored" as const,
              path: file.path,
              textDigest: await sha256(file.text),
              startOffset: start?.offset ?? 0,
              endOffset: diagnostic.sourceRef?.end.offset ?? 0,
              line: start?.line ?? 1,
              column: start?.column ?? 1,
            },
          };
        }),
      ),
    },
  };
}

/** Public native Prepare: same source authority for GUI, MCP and session folders. */
export async function prepareSourceExecutionInput(
  project: CircuitProject,
  folder: ProjectSimulationFolder,
  caps: Capabilities,
  variant?: SimulationRunVariant,
) {
  const selected = resolveSimulationEngine(folder, caps);
  if (!selected.ok) return selected;
  if (selected.engine === "ngspice")
    return prepareNgspiceExecutionInput(project, folder, caps, variant);
  const context = resolveSourceSimulationContext(
    project,
    folder,
    caps.profiles,
    variant,
  );
  if (!context.ok) {
    if ("diagnostics" in context)
      return sourceCompilationProblem(context.diagnostics, folder);
    return context;
  }
  if (caps.rawfileCollection !== "native-multi-ascii")
    return problem(
      "SIMULATION_NATIVE_RUNTIME_UNAVAILABLE",
      "This executor has not registered native VACASK multi-file execution. Source editing, inspection and saving remain available.",
      "prepare",
      "retry-after",
    );
  const {
    compiled,
    profile,
    environment,
    dependencies,
    files,
    sourceMaps,
    entryIndex,
  } = context;
  if (caps.maxInputFiles !== undefined && files.length > caps.maxInputFiles)
    return problem(
      "SIMULATION_INPUT_FILE_LIMIT",
      `This executor accepts ${caps.maxInputFiles} input files; this source input has ${files.length}. The Project can still be saved.`,
      "prepare",
    );
  const bytes = files.reduce(
    (n, f) => n + new TextEncoder().encode(f.text).length,
    0,
  );
  if (bytes > caps.maxInputBytes)
    return problem(
      "SIMULATION_INPUT_BYTE_LIMIT",
      `Prepared input is ${bytes} bytes; this executor accepts ${caps.maxInputBytes}. The Project can still be saved.`,
      "prepare",
    );
  const inputRevision = await sourceInputRevision(folder, compiled);
  const native = inspectNativeAnalyses({
    ...folder.input,
    files,
    dependencies,
    circuitBindings: [],
  });
  const signals = compiled.signals;
  // Environment-owned includes are now resolved, including the exact corner.
  // This enriches the captured result mapping, not the authored input identity.
  const deviceOp = compileNativeDeviceOperatingPoints(
    nativeSimulationDevices(
      project,
      {
        ...folder.input,
        files,
        dependencies,
      },
      profile.modelSymbols,
    ),
  );
  const volume = outputVolumeWarning(
    native.analyses,
    Math.max(1, Object.keys(signals).length),
    caps.maxOutputBytes,
  );
  const unqualified = [
    ...new Set(native.projections.map((p) => p.analysis)),
  ].filter((kind) => !caps.analyses.includes(kind));
  const preparedDeck = files[entryIndex]!.text;
  const input: ExecutionInput & { preparedDeck: string } = {
    language: "vacask",
    mode: "raw",
    netlist: "",
    testbench: preparedDeck,
    preparedDeck,
    inputRevision,
    environment,
    entryPath: compiled.entry,
    files,
    dependencies,
    collection: { kind: "native-multi-ascii" },
  };
  return {
    ok: true as const,
    input,
    digest: await sha256(JSON.stringify(input)),
    vectors: [
      ...deviceOp.vectors,
      ...compiled.vectors.filter((v) => v.quantity === "current"),
    ],
    signalNames: Object.fromEntries(
      Object.entries(signals).map(([key, s]) => [key, s.label]),
    ),
    signalTargets: Object.fromEntries(
      Object.entries(signals).map(([key, s]) => [key, s.targets]),
    ),
    outputs: compiled.outputs,
    deviceOperatingPoints: deviceOp.deviceOperatingPoints,
    measurements: compiled.config.measurements,
    warnings: [
      ...compiled.warnings
        .filter((w) => w.code !== "GENERATED_NET_NAME")
        .map((w) => w.message),
      ...native.warnings,
      ...(volume ? [volume] : []),
      ...(unqualified.length
        ? [
            `Native analyses ${unqualified.join(", ")} are outside this Profile's qualified scope; the run remains allowed.`,
          ]
        : []),
    ],
    authoredFiles: compiled.authoredFiles,
    generated: compiled.generated,
    sourceMaps,
  };
}
