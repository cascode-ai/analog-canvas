import type {
  CircuitProject,
  ProjectSimulationFolder,
  SimulationRunVariant,
} from "@icm/model";
import { reviewedExternalBindingForMaster } from "@icm/devices";
import type { InstanceStatement } from "@icm/spice";
import {
  compileNgspiceSourceSimulation,
  ngspiceSignals as simulationSignals,
  inspectSimulationSourceGraph,
  insertSimulationText,
  locateSimulationText,
  replaceSimulationText,
  type SimulationSourceDiagnostic,
} from "@icm/netlist";
import {
  deckNeedsModelLibrary,
  formatModelLibrarySelection,
} from "@icm/spice-run";
import { problem, type Capabilities } from "./contract.js";
import type { ExecutionInput } from "./executor.js";
import { sha256 } from "./content-digest.js";
import { sourceCompilationProblem } from "./source-compilation-problem.js";
import { netlistRunWarnings } from "./netlist-warnings.js";
import { sourceInputRevision } from "./input-identity.js";
import {
  literalSourceAnalyses,
  sourceOutputVolumeWarning,
} from "./source-analysis.js";

function librarySectionRange(
  text: string,
  startOffset: number,
  endOffset: number,
  section: string | undefined,
): { start: number; end: number } | null {
  const line = text.slice(startOffset, endOffset);
  const match =
    /^[ \t]*\.lib[ \t]+(?:"[^"\r\n]+"|'[^'\r\n]+'|[^\s\r\n]+)[ \t]+([^\s\r\n;]+)/iu.exec(
      line,
    );
  if (!match || match[1]!.toLowerCase() !== section?.toLowerCase()) return null;
  const start = startOffset + match[0].length - match[1]!.length;
  return { start, end: start + match[1]!.length };
}

/** Shared source adapter. No execution, Project mutation or private GUI deck path. */
export async function prepareNgspiceExecutionInput(
  project: CircuitProject,
  folder: ProjectSimulationFolder,
  caps: Capabilities,
  variant?: SimulationRunVariant,
) {
  const compilationProblem = (diagnostics: SimulationSourceDiagnostic[]) =>
    sourceCompilationProblem(diagnostics, folder, project);
  const compiled = compileNgspiceSourceSimulation(project, folder, variant);
  if (!compiled.ok) return compilationProblem(compiled.diagnostics);
  // Profile resolution belongs to the execution receipt, not authored input
  // identity. Keep compilation immutable so read compares the same inputs.
  const config = structuredClone(compiled.config);
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
  const dependencies = structuredClone(folder.input.dependencies);
  for (const model of compiled.modelDependencies ?? []) {
    const prior = dependencies.find(
      (d) => d.id === model.id || d.mountPath === model.mountPath,
    );
    if (prior && JSON.stringify(prior) !== JSON.stringify(model))
      return compilationProblem([
        {
          code: "MODEL_DEPENDENCY_CONFLICT",
          severity: "error",
          message: `Conflicting model dependency ${model.id}`,
          path: model.mountPath,
        },
      ]);
    if (compiled.files.some((f) => f.path === model.mountPath))
      return compilationProblem([
        {
          code: "MODEL_DEPENDENCY_CONFLICT",
          severity: "error",
          message: `Model dependency collides with authored file ${model.mountPath}`,
          path: model.mountPath,
        },
      ]);
    if (!prior) dependencies.push(structuredClone(model));
  }
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
  const projectedGraph = () =>
    inspectSimulationSourceGraph({
      ...folder.input,
      files,
      dependencies,
      circuitBindings: [],
    });
  const entryIndex = files.findIndex((file) => file.path === compiled.entry);
  const entry = files[entryIndex]!;
  const initialGraph = projectedGraph();
  const callableMasters = new Set(
    initialGraph.statements
      .filter((s) => s.statement.kind === "subckt_start")
      .map((s) => (s.statement as { name: string }).name.toLowerCase()),
  );
  // X calls require a callable subcircuit. Primitive models retain their
  // lexical scope and cannot satisfy an unrelated or subcircuit call.
  const primitiveModels = new Map<string, Set<string>>();
  const callScopes = new Map<object, string>();
  const scopes: string[] = [];
  for (const { statement } of initialGraph.statements) {
    if (statement.kind === "subckt_start")
      scopes.push(statement.name.toLowerCase());
    else if (statement.kind === "subckt_end") scopes.pop();
    else {
      const scope = JSON.stringify(scopes);
      if (statement.kind === "model") {
        const names = primitiveModels.get(scope) ?? new Set<string>();
        names.add(statement.name.toLowerCase());
        primitiveModels.set(scope, names);
      } else if (statement.kind === "instance")
        callScopes.set(statement, scope);
    }
  }
  const locallyResolved = (statement: InstanceStatement) =>
    statement.master &&
    (statement.family === "subcircuit"
      ? callableMasters.has(statement.master.toLowerCase())
      : primitiveModels.get("[]")?.has(statement.master.toLowerCase()) ||
        primitiveModels
          .get(callScopes.get(statement) ?? "[]")
          ?.has(statement.master.toLowerCase()));
  const reviewedCalls = initialGraph.statements.flatMap(
    ({ path, statement }) => {
      if (
        statement.kind !== "instance" ||
        !statement.master ||
        locallyResolved(statement)
      )
        return [];
      const map = sourceMaps.find((m) => m.path === path);
      const origin = map
        ? locateSimulationText(map, statement.sourceRef.start.offset)
        : null;
      if (
        origin?.kind !== "model-source" &&
        !reviewedExternalBindingForMaster(statement.master)
      )
        return [];
      return [{ path, statement, origin }];
    },
  );
  const supported = new Set(profile.devices?.map((name) => name.toLowerCase()));
  const conflicts = reviewedCalls.filter(
    (call) =>
      call.origin?.kind === "model-source" &&
      (profile.devices
        ? !supported.has(call.statement.master!.toLowerCase())
        : true),
  );
  if (conflicts.length)
    return compilationProblem(
      conflicts.map(({ path, statement, origin }) => {
        const model =
          origin?.kind === "model-source"
            ? project.modelSources?.find((s) => s.id === origin.sourceId)
            : undefined;
        const ownerPath = origin?.kind === "model-source" ? origin.path : path;
        const ownerFile = model?.files.find((f) => f.path === ownerPath);
        const start =
          origin?.kind === "model-source"
            ? origin.startOffset
            : statement.sourceRef.start.offset;
        const before = ownerFile?.text.slice(0, start).split("\n");
        const point = {
          offset: start,
          line: before?.length ?? statement.sourceRef.start.line,
          column: (before?.at(-1)?.length ?? 0) + 1,
        };
        return {
          code: "MODEL_SOURCE_PROFILE_CONFLICT",
          severity: "error" as const,
          message: `The selected Profile does not qualify ${statement.master}; edit the model or select a qualified Profile.`,
          path: ownerPath,
          sourceRef: { fileId: ownerPath, start: point, end: point },
          ...(model
            ? { modelSource: { sourceId: model.id, revision: model.revision } }
            : {}),
        };
      }),
    );
  const declaredProfileLibraries = dependencies.filter(
    (d) => available.get(d.id) === d.sha256,
  );
  const allLibrariesLoaded =
    declaredProfileLibraries.length > 0 &&
    declaredProfileLibraries.every((d) =>
      initialGraph.includes.some((load) => load.target === d.mountPath),
    );
  for (const dependency of declaredProfileLibraries) {
    const loads = initialGraph.includes.filter(
      (load) => load.target === dependency.mountPath,
    );
    const invalid = loads.filter(
      (load) =>
        load.section !== undefined && !profile.corners.includes(load.section),
    );
    if (invalid.length)
      return compilationProblem(
        invalid.map((load) => ({
          code: "SIMULATION_MODEL_CORNER_CONFLICT",
          severity: "error",
          message:
            "The selected Profile does not qualify this library section; edit the model reference.",
          path: load.path,
          sourceRef: load.sourceRef,
        })),
      );
    if (new Set(loads.map((load) => load.section?.toLowerCase())).size > 1)
      return compilationProblem(
        loads.map((load) => ({
          code: "SIMULATION_MODEL_CORNER_CONFLICT",
          severity: "error",
          message:
            "The same library is loaded with conflicting sections; edit its references.",
          path: load.path,
          sourceRef: load.sourceRef,
        })),
      );
  }
  const generatedPaths = new Set(compiled.generated.map((file) => file.path));
  const needsCanvasModels =
    (initialGraph.statements.some(
      ({ path, statement }) =>
        generatedPaths.has(path) &&
        statement.kind === "instance" &&
        !locallyResolved(statement) &&
        deckNeedsModelLibrary(statement.rawText),
    ) ||
      reviewedCalls.length > 0) &&
    !allLibrariesLoaded;
  const requestedCorner = variant?.environment?.corner;
  if (
    needsCanvasModels ||
    requestedCorner !== undefined ||
    (reviewedCalls.length > 0 && profile.dependencies?.length === 1)
  ) {
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
    if (!dependency && needsCanvasModels) {
      const occupied = new Set([
        ...files.map((file) => file.path),
        ...dependencies.map((item) => item.mountPath),
        folder.input.configPath,
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
    if (!dependency)
      return problem(
        "SIMULATION_CORNER_TARGET_MISSING",
        "This run has no declared Profile model library to receive the requested corner",
        "prepare",
      );
    const existingLoads = projectedGraph().includes.filter(
      (include) => include.target === dependency.mountPath,
    );
    const selectedCorner =
      requestedCorner ??
      (compiled.authority === "code" && existingLoads.length
        ? existingLoads[0]!.section
        : (config.environment.corner ?? caps.modelLibrary?.section));
    if (!selectedCorner || !profile.corners.includes(selectedCorner))
      return problem(
        "SIMULATION_CORNER_UNSUPPORTED",
        "Select a qualified model corner before preparation",
        "prepare",
      );
    const nominalSection = existingLoads[0]?.section;
    if (existingLoads.some((load) => load.section === undefined))
      return compilationProblem(
        existingLoads
          .filter((load) => load.section === undefined)
          .map((load) => ({
            code: "SIMULATION_MODEL_CORNER_CONFLICT",
            severity: "error",
            message:
              "A Profile model corner requires a section-selected .lib; plain .include cannot receive a corner point",
            path: load.path,
            sourceRef: load.sourceRef,
          })),
      );
    if (
      existingLoads.some(
        (load) => load.section?.toLowerCase() !== nominalSection?.toLowerCase(),
      )
    )
      return compilationProblem(
        existingLoads.map((load) => ({
          code: "SIMULATION_MODEL_CORNER_CONFLICT",
          severity: "error",
          message:
            "The same Profile model library is loaded with conflicting sections",
          path: load.path,
          sourceRef: load.sourceRef,
        })),
      );
    if (requestedCorner !== undefined && existingLoads.length) {
      // A repeated include can reach one physical .lib card more than once.
      // Rewrite each card in the prepared copy exactly once, retaining its
      // authored neighbours and their source-map offsets.
      const projectedLoads = inspectSimulationSourceGraph({
        ...folder.input,
        files,
        dependencies,
        circuitBindings: [],
      }).includes.filter((load) => load.target === dependency.mountPath);
      const uniqueLoads = new Map(
        projectedLoads.map((load) => [
          JSON.stringify([load.path, load.sourceRef.start.offset]),
          load,
        ]),
      );
      for (const load of [...uniqueLoads.values()].sort(
        (left, right) =>
          right.sourceRef.start.offset - left.sourceRef.start.offset,
      )) {
        const index = files.findIndex((file) => file.path === load.path);
        const file = files[index];
        const map = sourceMaps[index];
        const range =
          file &&
          librarySectionRange(
            file.text,
            load.sourceRef.start.offset,
            load.sourceRef.end.offset,
            load.section,
          );
        if (!file || !map || !range)
          return problem(
            "SIMULATION_CORNER_SOURCE_RANGE",
            "Cannot locate the Profile .lib section in the prepared source",
            "prepare",
          );
        const origin = locateSimulationText(map, range.start);
        const modelLoad =
          origin?.kind === "generated" &&
          origin.purpose === "canvas-circuit" &&
          compiled.modelDependencies?.some((d) => d.mountPath === load.target);
        if (origin?.kind !== "authored" && !modelLoad)
          return problem(
            "SIMULATION_CORNER_SOURCE_RANGE",
            "The Profile .lib section is not an authored or declared model dependency token",
            "prepare",
          );
        const mapped = replaceSimulationText(
          { ...file, ...map },
          range.start,
          range.end,
          selectedCorner,
          {
            kind: "generated",
            purpose: "run-variant",
            nominal: {
              path: file.path,
              startOffset:
                origin?.kind === "authored" ? origin.startOffset : range.start,
              endOffset:
                (origin?.kind === "authored"
                  ? origin.startOffset
                  : range.start) +
                range.end -
                range.start,
            },
          },
        );
        files[index] = { path: mapped.path, text: mapped.text };
        sourceMaps[index] = { path: mapped.path, segments: mapped.segments };
      }
    }
    if (!existingLoads.length) {
      if (!needsCanvasModels)
        return problem(
          "SIMULATION_CORNER_TARGET_MISSING",
          "The requested corner has no Profile model-library load in this source",
          "prepare",
        );
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
    // Record the actual native model selection in the execution receipt only.
    if (compiled.authority === "code")
      config.environment.corner = selectedCorner;
  }
  const output = config.collection.rawfile;
  if (
    output !== null &&
    [
      folder.input.configPath,
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
        path: folder.input.configPath,
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
  const inputRevision = await sourceInputRevision(folder, compiled);
  const graph = inspectSimulationSourceGraph({
    ...folder.input,
    files: compiled.files,
  });
  const analyses = literalSourceAnalyses(graph);
  const volume = sourceOutputVolumeWarning(graph, caps.maxOutputBytes);
  const unqualified = [...new Set(analyses.map((a) => a.kind))].filter(
    (kind) => !caps.analyses.includes(kind),
  );
  const preparedDeck = files[entryIndex]!.text;
  const signals = simulationSignals(project, folder.input);
  const input: ExecutionInput & { preparedDeck: string } = {
    mode: "raw",
    netlist: "",
    testbench: preparedDeck,
    preparedDeck,
    inputRevision,
    environment: {
      ...config.environment,
      ...(variant?.environment?.temperatureC === undefined
        ? {}
        : { temperatureC: variant.environment.temperatureC }),
    },
    entryPath: compiled.entry,
    files,
    dependencies,
    collection: config.collection,
  };
  // The drawn circuit as sent is what the run's netlist digest names (#1243).
  // A raw run executes the deck and its files alone, so this copy feeds only
  // the run's digests (input metadata and the prepared digest). It is sent
  // only while the whole input, serialized, stays within the input budget.
  const drawnCircuit = files
    .filter((file) => generatedPaths.has(file.path))
    .map((file) => file.text)
    .join("\n");
  if (
    new TextEncoder().encode(
      JSON.stringify({ ...input, netlist: drawnCircuit }),
    ).length <= caps.maxInputBytes
  )
    input.netlist = drawnCircuit;
  return {
    ok: true as const,
    input,
    digest: await sha256(JSON.stringify(input)),
    vectors: compiled.vectors,
    signalNames: Object.fromEntries(
      Object.entries(signals).map(([key, signal]) => [key, signal.label]),
    ),
    signalTargets: Object.fromEntries(
      Object.entries(signals).map(([key, signal]) => [key, signal.targets]),
    ),
    outputs: compiled.outputs,
    deviceOperatingPoints: compiled.deviceOperatingPoints,
    measurements: config.measurements,
    warnings: [
      ...netlistRunWarnings(compiled.warnings),
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
    ...(compiled.modelSources?.length
      ? { modelSources: compiled.modelSources }
      : {}),
  };
}
