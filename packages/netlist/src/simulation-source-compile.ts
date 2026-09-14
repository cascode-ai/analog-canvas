import {
  readSimulationExperimentConfig,
  type CircuitProject,
  type ProjectSimulationFolder,
  type SimulationExperimentConfig,
  type SimulationRunVariant,
} from "@icm/model";
import { sha256Hex } from "@icm/derived";
import { analyzeDesignNetlist } from "./extract.js";
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
import type {
  PrintedNetlistParameter,
  PrintedNetlistInstance,
} from "./printed-netlist.js";
import { inspectVacaskSourceGraph } from "./vacask-source.js";
import type { SimulationSourceDiagnostic } from "./source-file-graph.js";

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
  if (variant && Object.values(variant).some((value) => value !== undefined))
    fail(
      "SIMULATION_NATIVE_VARIANT_UNSUPPORTED",
      "Native experiments own their parameter sweeps in Code. Batch selects folders; it does not override their electrical parameters.",
    );
  const graph = inspectVacaskSourceGraph(folder.input);
  diagnostics.push(...graph.diagnostics);
  if (diagnostics.some((d) => d.severity === "error"))
    return { ok: false, diagnostics };
  const reachable = new Set(graph.paths);
  const bindings = folder.input.circuitBindings.filter((b) =>
    reachable.has(b.path),
  );
  const plans = new Map<string, DesignNetlistIR>();
  for (const binding of bindings) {
    const result = analyzeDesignNetlist(project, {
      format: "spice",
      rootDocumentId: binding.documentId,
    });
    diagnostics.push(
      ...result.diagnostics.map((d) => ({
        code: d.code,
        severity: d.severity,
        message: d.message,
        field: d.documentId,
      })),
    );
    if (result.ir) plans.set(binding.id, result.ir);
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
          code: d.code,
          severity: d.severity,
          message: d.message,
          path: binding.path,
          field: d.documentId,
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
  const mapped = [
    ...folder.input.files
      .filter((f) => f.path !== folder.input.configPath)
      .map((f) => mapSimulationFile(f.path, f.text)),
    ...generated.map((f) =>
      mapSimulationFile(f.path, f.text, {
        kind: "generated",
        purpose: "canvas-circuit",
        bindingId: f.bindingId,
      }),
    ),
  ];
  const config = structuredClone(parsed.config);
  // There is no single authored write filename in VACASK. Collection is a
  // runtime multi-artifact concern; never manufacture an out.raw source setting.
  config.collection = { rawfile: null };
  return {
    ok: true,
    language: "vacask",
    authority: "code",
    config,
    authoredFiles: structuredClone(folder.input.files),
    files: mapped.map(({ path, text }) => ({ path, text })),
    sourceMaps: mapped.map(({ path, segments }) => ({ path, segments })),
    entry: folder.input.entry,
    includes: graph.includes,
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
    // Native source controls acquisition and result declarations. These are
    // derived from actual native output, not restored from retired sidecars.
    vectors: [],
    outputs: [],
    deviceOperatingPoints: [],
    warnings: diagnostics,
  };
}
