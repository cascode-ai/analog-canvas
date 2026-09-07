import type { CircuitProject } from "@icm/model";
import { compileStructuredSimulation } from "@icm/netlist";
import { buildSimulationDeck, deckNeedsModelLibrary } from "@icm/spice-run";
import {
  problem,
  type Prepared,
  type SimulationOperation,
  type Capabilities,
  type Problem,
} from "./contract.js";
import {
  outputVolumeWarning,
  type ResultVolumeAnalysis,
} from "./result-volume.js";
import { SimulationFiles, sha256 } from "./files.js";
import type { ExecutionInput } from "./executor.js";
import { rawInputRevision } from "./input-identity.js";
type RawSimulationInput = Extract<
  CircuitProject["simulationSetups"][number]["input"],
  { kind: "raw" }
>;

function unresolvedDependencyProblem(input: RawSimulationInput): {
  ok: false;
  error: Problem;
} {
  return {
    ok: false,
    error: {
      code: "SIMULATION_DEPENDENCY_UNAVAILABLE",
      message:
        "One or more Project simulation dependencies are unavailable in this session",
      stage: "prepare",
      recovery: "fix-input",
      diagnostics: input.dependencies.map((dependency, index) => ({
        code: "SIMULATION_DEPENDENCY_UNAVAILABLE",
        message: `Dependency ${dependency.id} (${dependency.mountPath}) is not resolved`,
        severity: "error",
        field: `input.dependencies[${index}]`,
      })),
    },
  };
}

export async function prepareExecutionInput(
  op: Extract<SimulationOperation, { operation: "prepare" }>,
  caps: Capabilities,
  getProject: () => CircuitProject,
  files: SimulationFiles,
): Promise<
  | {
      ok: true;
      input: ExecutionInput & { preparedDeck: string };
      vectors: Prepared["vectors"];
      outputs: Prepared["outputs"];
      deviceOperatingPoints: Prepared["deviceOperatingPoints"];
      measurements: NonNullable<Prepared["measurements"]>;
      warnings: string[];
      digest: string;
    }
  | { ok: false; error: Problem }
> {
  let input: ExecutionInput;
  let vectors: Prepared["vectors"] = [];
  let outputs: Prepared["outputs"] = [];
  let deviceOperatingPoints: Prepared["deviceOperatingPoints"] = [];
  let measurements: NonNullable<Prepared["measurements"]> = [];
  let warnings: string[] = [];
  let structuredAnalyses: ResultVolumeAnalysis[] | null = null;
  if (op.source.kind === "project-setup") {
    const setupId = op.source.setupId;
    const project = structuredClone(getProject());
    if (project.structureRevision !== op.source.expectedStructureRevision)
      return problem(
        "PROJECT_STRUCTURE_REVISION_CONFLICT",
        `Expected Project structure revision ${op.source.expectedStructureRevision}, received ${project.structureRevision}`,
        "prepare",
        "reprepare",
      );
    const setup = project.simulationSetups.find(
      (candidate) => candidate.id === setupId,
    );
    if (!setup)
      return problem(
        "SIMULATION_SETUP_MISSING",
        `Simulation setup does not exist: ${setupId}`,
        "prepare",
      );
    if (setup.input.kind === "structured") {
      const compiled = await compileStructuredSimulation(project, setup);
      if (!compiled.ok)
        return {
          ok: false,
          error: {
            code: "SIMULATION_COMPILE_REFUSED",
            message: "Correct the located input and prepare again",
            stage: "prepare",
            recovery: "fix-input",
            diagnostics: compiled.diagnostics.map((d) => {
              const { sourceRef: _source, ...primary } = d.primary;
              return {
                code: d.code,
                message: d.message,
                severity: d.severity,
                primary: {
                  ...primary,
                  hierarchyPath: [...d.primary.hierarchyPath],
                },
              };
            }),
          },
        };
      input = {
        mode: "structured",
        netlist: compiled.request.netlist,
        testbench: compiled.request.testbench,
        inputRevision: compiled.request.inputRevision!,
        environment: setup.input.environment,
        files: [],
        dependencies: [],
      };
      vectors = [...compiled.vectors];
      outputs = structuredClone([...compiled.outputs]);
      deviceOperatingPoints = structuredClone([
        ...compiled.deviceOperatingPoints,
      ]);
      measurements = structuredClone([...compiled.measurements]);
      warnings = compiled.warnings.map((w) => w.message);
      structuredAnalyses = setup.input.analyses.map((analysis) =>
        analysis.kind === "tran"
          ? {
              kind: analysis.kind,
              stepSeconds: analysis.stepSeconds,
              stopSeconds: analysis.stopSeconds,
              ...(analysis.startSeconds === undefined
                ? {}
                : { startSeconds: analysis.startSeconds }),
            }
          : { ...analysis },
      );
    } else {
      const rawInput = setup.input;
      const entry = rawInput.files.find((file) => file.path === rawInput.entry);
      if (!entry)
        return problem(
          "SIMULATION_ENTRY_UNAVAILABLE",
          "The Project simulation entry is not present in its authored files",
          "prepare",
        );
      input = {
        mode: "raw",
        netlist: "",
        testbench: entry.text,
        inputRevision: await rawInputRevision(rawInput),
        environment: rawInput.environment,
        files: rawInput.files.map((file) => ({ ...file })),
        dependencies: rawInput.dependencies.map((dependency) => ({
          ...dependency,
        })),
        entryPath: rawInput.entry,
      };
    }
  } else {
    const read = files.snapshot(
      op.source.workspaceId,
      op.source.expectedRevision,
    );
    if (!read.ok) return read;
    const { workspace } = read;
    input = {
      mode: "raw",
      netlist: "",
      testbench: workspace.files.find((f) => f.path === workspace.entry)!.text,
      inputRevision: await sha256(
        JSON.stringify({
          entry: workspace.entry,
          files: workspace.files,
          environment: op.source.environment,
        }),
      ),
      environment: op.source.environment,
      files: workspace.files.map((f) => ({ ...f })),
      dependencies: [],
    };
    // Preserve entry-relative includes by running the actual entry path.
    input.entryPath = workspace.entry!;
  }
  const profile = caps.profiles.find(
    (p) => p.id === input.environment.profileId,
  );
  if (!profile)
    return problem(
      "SIMULATION_PROFILE_UNKNOWN",
      "Select a Profile advertised by capabilities",
      "prepare",
    );
  if (input.mode === "raw" && input.dependencies.length > 0) {
    const available = new Map(
      (profile.dependencies ?? []).map((dependency) => [
        dependency.id,
        dependency.sha256,
      ]),
    );
    if (
      input.dependencies.some(
        (dependency) => available.get(dependency.id) !== dependency.sha256,
      )
    )
      return unresolvedDependencyProblem({
        kind: "raw",
        entry: input.entryPath!,
        files: input.files,
        dependencies: input.dependencies,
        environment: input.environment,
      });
  }
  if (
    input.environment.corner &&
    !profile.corners.includes(input.environment.corner)
  )
    return problem(
      "SIMULATION_CORNER_UNSUPPORTED",
      "The selected Profile does not support this corner",
      "prepare",
    );
  if (structuredAnalyses) {
    const unsupported = structuredAnalyses.find(
      (analysis) => !caps.analyses.includes(analysis.kind),
    );
    if (unsupported)
      return problem(
        "SIMULATION_ANALYSIS_UNQUALIFIED",
        `Analysis ${unsupported.kind} is not qualified by the selected Profile`,
        "prepare",
      );
    const volumeWarning = outputVolumeWarning(
      structuredAnalyses,
      vectors.length,
      caps.maxOutputBytes,
    );
    if (volumeWarning) warnings.push(volumeWarning);
  }
  input.preparedDeck =
    input.mode === "raw"
      ? input.testbench
      : buildSimulationDeck(
          input,
          caps.modelLibrary &&
            deckNeedsModelLibrary(input.netlist + "\n" + input.testbench)
            ? {
                directive: "lib",
                path: caps.modelLibrary.path,
                section: input.environment.corner ?? caps.modelLibrary.section,
              }
            : null,
        );
  const digest = await sha256(JSON.stringify(input));

  return {
    ok: true,
    input: { ...input, preparedDeck: input.preparedDeck },
    vectors,
    outputs,
    deviceOperatingPoints,
    measurements,
    warnings,
    digest,
  };
}
