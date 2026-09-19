import {
  readSimulationExperimentConfig,
  SimulationRunVariantSchema,
  type CircuitProject,
  type ProjectSimulationFolder,
  type SimulationExperimentConfig,
  type SimulationRunVariant,
} from "@icm/model";
import { sha256Hex } from "@icm/derived";
import { simulationNetlistDiagnostic } from "./simulation-diagnostic.js";
import { analyzeDesignNetlist, SIMULATION_DECK_GROUND } from "./extract.js";
import type { DesignNetlistCell, DesignNetlistIR } from "./ir.js";
import {
  mapSimulationFile,
  type SimulationFileSourceMap,
} from "./simulation-source-map.js";
import type {
  CompiledSimulationDeviceOperatingPoint,
  CompiledSimulationOutput,
  CompiledSimulationVector,
} from "./simulation-compile.js";
import { printVacaskWithLocations } from "./vacask-printer.js";
import {
  nativeCurrentInstrumentation,
  nativeTerminalSignals,
} from "./simulation-native-current.js";
import { simulationSignals } from "./simulation-signal-names.js";
import { normalizeIndependentSource } from "./source-waveform.js";
import { instrumentTerminalCurrents } from "./terminal-current-instrumentation.js";
import type {
  PrintedNetlistParameter,
  PrintedNetlistInstance,
} from "./printed-netlist.js";
import { inspectVacaskSourceGraph } from "./vacask-source.js";
import type { SimulationSourceDiagnostic } from "./source-file-graph.js";
import { applySimulationParameter } from "./simulation-parameter-target.js";
import { projectVacaskRunVariables } from "./vacask-run-variables.js";
import { projectVacaskRunTemperature } from "./vacask-run-temperature.js";
import {
  compileNativeDeviceOperatingPoints,
  nativeSimulationDevices,
} from "./simulation-native-devices.js";

export interface GeneratedSimulationFile {
  bindingId: string;
  path: string;
  text: string;
  parameters: PrintedNetlistParameter[];
  instances: PrintedNetlistInstance[];
}
export type SourceSimulationCompilation =
  | { ok: false; diagnostics: SimulationSourceDiagnostic[] }
  | {
      ok: true;
      language: "vacask";
      config: SimulationExperimentConfig;
      authority: "code";
      authoredFiles: { path: string; text: string }[];
      files: { path: string; text: string }[];
      entry: string;
      generated: GeneratedSimulationFile[];
      /** External model/master names required by the generated electrical IR. */
      requiredModels: string[];
      vectors: CompiledSimulationVector[];
      signals: ReturnType<typeof simulationSignals>;
      outputs: CompiledSimulationOutput[];
      deviceOperatingPoints: CompiledSimulationDeviceOperatingPoint[];
      warnings: SimulationSourceDiagnostic[];
      reachedDocumentIds: string[];
      electricalHash: string;
      sourceMaps: SimulationFileSourceMap[];
      includes: ReturnType<typeof inspectVacaskSourceGraph>["includes"];
    };

/** Public native compilation. Source owns analysis/control; Canvas owns the
 * generated electrical IR. No old executable compiler or syntax fallback. */
export function compileSourceSimulation(
  project: CircuitProject,
  folder: ProjectSimulationFolder,
  variant?: SimulationRunVariant,
): SourceSimulationCompilation {
  const diagnostics: SimulationSourceDiagnostic[] = [];
  const fail = (code: string, message: string, path?: string) =>
    diagnostics.push({
      code,
      severity: "error",
      message,
      ...(path ? { path } : {}),
    });
  if (folder.input.drafts?.length)
    return {
      ok: false,
      diagnostics: folder.input.drafts.map((draft) => ({
        code: "SIMULATION_SOURCE_DRAFT_PENDING",
        severity: "error",
        path: draft.path,
        message:
          "Apply or discard the saved draft before preparing; saving remains available.",
      })),
    };
  const parsed = readSimulationExperimentConfig(folder);
  if (!parsed.ok)
    return {
      ok: false,
      diagnostics: (parsed.fields.length
        ? parsed.fields
        : [{ field: "", message: parsed.message }]
      ).map((issue) => ({
        code: parsed.fields.length
          ? "SIMULATION_CONFIG_INVALID"
          : "SIMULATION_CONFIG_JSON",
        severity: "error",
        message: issue.message,
        path: parsed.path,
        ...(issue.field ? { field: issue.field } : {}),
      })),
    };
  if (parsed.authority !== "code") {
    fail(
      "SIMULATION_LEGACY_SOURCE",
      "This experiment still contains legacy executable settings. Preserve its source and explicitly translate its analysis, outputs and model loading to native VACASK before running.",
      folder.input.configPath,
    );
    return { ok: false, diagnostics };
  }
  const parsedVariant = SimulationRunVariantSchema.safeParse(variant ?? {});
  if (!parsedVariant.success) {
    fail("SIMULATION_VARIANT_INVALID", parsedVariant.error.issues[0]!.message);
    return { ok: false, diagnostics };
  }
  variant = parsedVariant.data;
  const graph = inspectVacaskSourceGraph(folder.input);
  diagnostics.push(...graph.diagnostics);
  if (diagnostics.some((d) => d.severity === "error"))
    return { ok: false, diagnostics };
  const authored = projectVacaskRunVariables(
    folder.input,
    graph,
    variant.variables ?? [],
  );
  diagnostics.push(...authored.diagnostics);
  if (diagnostics.some((d) => d.severity === "error"))
    return { ok: false, diagnostics };
  const temperature = projectVacaskRunTemperature(
    folder.input,
    authored.files,
    variant.environment?.temperatureC,
  );
  diagnostics.push(...temperature.diagnostics);
  if (diagnostics.some((d) => d.severity === "error"))
    return { ok: false, diagnostics };
  const reachable = new Set(graph.paths);
  const bindings = folder.input.circuitBindings.filter((b) =>
    reachable.has(b.path),
  );
  // A point owns only this preparation. Never edit nominal Canvas values or
  // introduce another persisted electrical configuration for native source.
  const points = variant.parameters ?? [];
  const effective = points.length ? structuredClone(project) : project;
  const parameterKey = (p: {
    documentId: string;
    instanceId: string;
    parameter: string;
  }) => JSON.stringify([p.documentId, p.instanceId, p.parameter]);
  const targets = new Set<string>();
  for (const point of points) {
    const key = parameterKey(point);
    if (targets.has(key)) {
      fail(
        "SIMULATION_VARIANT_DUPLICATE",
        "More than one override for the same instance parameter",
      );
      continue;
    }
    targets.add(key);
    const result = applySimulationParameter(
      effective,
      point,
      point.value,
      "Variant",
      "SIMULATION_VARIANT",
      true,
    );
    if (!result.ok) fail(result.code, result.message);
  }
  if (diagnostics.some((d) => d.severity === "error"))
    return { ok: false, diagnostics };
  const plans = new Map<string, DesignNetlistIR>();
  const currentInput = {
    ...folder.input,
    files: temperature.files.map(({ path, text }) => ({ path, text })),
  };
  const currentDevices = nativeSimulationDevices(effective, currentInput);
  const notedSources = new Set<string>();
  for (const device of currentDevices) {
    if (!["voltage-source", "current-source"].includes(device.card.deviceClass))
      continue;
    const source = normalizeIndependentSource(device.card.parameters);
    const key = JSON.stringify([device.documentId, device.instanceId]);
    if (
      source.dc === undefined ||
      source.transient.kind === "dc" ||
      notedSources.has(key)
    )
      continue;
    notedSources.add(key);
    diagnostics.push({
      code: "SIMULATION_NATIVE_SOURCE_DC_MODE",
      severity: "info",
      path:
        currentInput.circuitBindings.find(
          (b) => b.id === device.circuit.bindingId,
        )?.path ?? currentInput.entry,
      field: `${device.documentId}.${device.instanceId}.dc`,
      message: `${device.reference}: native ${source.transient.kind.toUpperCase()} uses its waveform value for bias; dc is used only with type="dc". For a separate DC bias, explicitly alter instance(${JSON.stringify(device.reference)}) type="dc" before the bias analysis and restore the waveform type before transient. Source and analysis text are not changed automatically.`,
    });
  }
  const currents = nativeCurrentInstrumentation(currentInput, currentDevices);
  diagnostics.push(...currents.diagnostics);
  for (const binding of bindings) {
    const result = analyzeDesignNetlist(effective, {
      format: "spice",
      rootDocumentId: binding.documentId,
      ...SIMULATION_DECK_GROUND,
      rootAsTopLevel: binding.emission === "top-level",
    });
    diagnostics.push(...result.diagnostics.map(simulationNetlistDiagnostic));
    if (result.ir)
      plans.set(
        binding.id,
        instrumentTerminalCurrents(result.ir, currents.instrumentations),
      );
  }
  if (diagnostics.some((d) => d.severity === "error"))
    return { ok: false, diagnostics };

  // Allocate native primitive model names against the whole compilation once.
  // Every generated file uses that same namespace; shared Cells emit once.
  const cells = new Map<string, DesignNetlistCell>();
  const names = new Map<string, string>();
  const owners = new Map<string, string>();
  const masters = new Map<
    string,
    NonNullable<DesignNetlistIR["externalMasters"]>[number]
  >();
  const globals = new Set<string>();
  for (const binding of bindings) {
    const ir = plans.get(binding.id)!;
    for (const name of ir.globals) globals.add(name);
    for (const master of ir.externalMasters ?? [])
      masters.set(master.id, master);
    for (const cell of ir.cells) {
      const prior = cells.get(cell.id);
      if (prior && JSON.stringify(prior) !== JSON.stringify(cell))
        fail(
          "SIMULATION_GENERATED_DEFINITION_CONFLICT",
          `Cell ${cell.name} has conflicting generated definitions`,
          binding.path,
        );
      if (names.has(cell.name) && names.get(cell.name) !== cell.id)
        fail(
          "SIMULATION_GENERATED_NAME_COLLISION",
          `Generated Cells share the exact name ${cell.name}`,
          binding.path,
        );
      cells.set(cell.id, cell);
      names.set(cell.name, cell.id);
      if (
        !(binding.emission === "top-level" && cell.id === ir.topCellId) &&
        !owners.has(cell.id)
      )
        owners.set(cell.id, binding.id);
    }
  }
  let depth = 0;
  const authoredMasters = new Set<string>();
  for (const { path, statement } of graph.statements) {
    const [head, name] = statement.tokens;
    const keyword =
      head?.kind === "word" &&
      statement.rawText.slice(0, head.end - head.start) === head.value
        ? head.value
        : undefined;
    if (keyword === "subckt") {
      if (depth === 0 && name) authoredMasters.add(name.value);
      if (depth === 0 && name && names.has(name.value))
        diagnostics.push({
          code: "SIMULATION_GENERATED_DEFINITION_SHADOWED",
          severity: "error",
          message: `Authored definition shadows generated Cell ${name.value}`,
          path,
          sourceRef: statement.sourceRef,
        });
      depth++;
    } else if (keyword === "ends") depth = Math.max(0, depth - 1);
    else if (
      keyword === "model" &&
      depth === 0 &&
      name &&
      names.has(name.value)
    )
      diagnostics.push({
        code: "SIMULATION_GENERATED_DEFINITION_SHADOWED",
        severity: "error",
        message: `Authored model shadows generated Cell ${name.value}`,
        path,
        sourceRef: statement.sourceRef,
      });
    if (keyword === "model" && depth === 0 && name)
      authoredMasters.add(name.value);
  }
  if (diagnostics.some((d) => d.severity === "error"))
    return { ok: false, diagnostics };
  const generated: GeneratedSimulationFile[] = [];
  for (const [index, binding] of bindings.entries()) {
    const ir = plans.get(binding.id)!;
    const cellIds = new Set(
      [...cells.values()]
        .filter(
          (cell) =>
            owners.get(cell.id) === binding.id ||
            (binding.emission === "top-level" && cell.id === ir.topCellId),
        )
        .map((cell) => cell.id),
    );
    const printed = printVacaskWithLocations(
      {
        topCellId: ir.topCellId,
        cells: [...cells.values()],
        globals: [...globals],
        externalMasters: [...masters.values()],
      },
      binding.emission === "top-level",
      { cellIds, preamble: index === 0, reservedNames: authoredMasters },
    );
    if (!printed.ok)
      diagnostics.push(
        ...printed.diagnostics.map((d) => ({
          ...simulationNetlistDiagnostic(d),
          path: binding.path,
        })),
      );
    else
      generated.push({
        bindingId: binding.id,
        path: binding.path,
        text: printed.text,
        parameters: printed.parameters,
        instances: printed.instances,
      });
  }
  if (diagnostics.some((d) => d.severity === "error"))
    return { ok: false, diagnostics };
  // Existing in the Project is insufficient: the selected source graph must
  // emit the parameter. Reject inert points instead of giving a nominal run
  // the misleading label of a successful sweep member.
  const emitted = new Set(
    generated.flatMap((file) => file.parameters.map(parameterKey)),
  );
  for (const point of points)
    if (!emitted.has(parameterKey(point)))
      fail(
        "SIMULATION_VARIANT_TARGET_NOT_EMITTED",
        `Variant parameter is not emitted by this experiment: ${point.documentId}/${point.instanceId}.${point.parameter}`,
      );
  if (diagnostics.some((d) => d.severity === "error"))
    return { ok: false, diagnostics };
  const mapped = [
    ...temperature.files,
    ...generated.map((f) =>
      mapSimulationFile(f.path, f.text, {
        kind: "generated",
        purpose: "canvas-circuit",
        bindingId: f.bindingId,
      }),
    ),
  ];
  const config = structuredClone(parsed.config);
  // Run-only environment intent. The service resolves the Profile's exact
  // dependency/section and maps its prepared text; no persisted config edit.
  if (variant.environment?.corner !== undefined)
    config.environment.corner = variant.environment.corner;
  // There is no single authored write filename in VACASK. Collection is a
  // runtime multi-artifact concern; never manufacture an out.raw source setting.
  config.collection = { rawfile: null };
  const deviceOp = compileNativeDeviceOperatingPoints(currentDevices);
  const terminalSignals = nativeTerminalSignals(
    effective,
    currentInput,
    currentDevices,
    currents.instrumentations,
  );
  return {
    ok: true,
    language: "vacask",
    authority: "code",
    config,
    authoredFiles: structuredClone(folder.input.files),
    files: mapped.map(({ path, text }) => ({ path, text })),
    sourceMaps: mapped.map(({ path, segments }) => ({ path, segments })),
    entry: folder.input.entry,
    // Include positions used for later environment edits belong to prepared
    // bytes. Circuit diagnostics above keep their original authored positions.
    includes:
      variant.variables?.length ||
      variant.environment?.temperatureC !== undefined
        ? inspectVacaskSourceGraph({
            ...folder.input,
            files: temperature.files.map(({ path, text }) => ({ path, text })),
          }).includes
        : graph.includes,
    generated,
    requiredModels: [
      ...new Set(
        [...cells.values()].flatMap((cell) =>
          cell.instances.flatMap((instance) =>
            instance.target && !names.has(instance.target)
              ? [instance.target]
              : [],
          ),
        ),
      ),
    ].sort(),
    electricalHash: sha256Hex(
      JSON.stringify([...plans].sort(([a], [b]) => a.localeCompare(b))),
    ),
    reachedDocumentIds: [...cells.keys()],
    // Source controls saves. Potential device mappings are captured here; the
    // result reader materializes only returned values, never retired sidecars.
    vectors: [
      ...deviceOp.vectors,
      ...Object.keys(terminalSignals).map((vector) => ({
        probeId: `native:${vector}`,
        vector,
        quantity: "current" as const,
      })),
    ],
    outputs: [],
    deviceOperatingPoints: deviceOp.deviceOperatingPoints,
    signals: {
      ...simulationSignals(effective, currentInput),
      ...terminalSignals,
    },
    warnings: diagnostics,
  };
}
