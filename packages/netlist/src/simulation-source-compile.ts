import {
  readSimulationExperimentConfig,
  SIMULATION_NOISE_INPUT_DENSITY_ID,
  SIMULATION_NOISE_OUTPUT_DENSITY_ID,
  type CircuitProject,
  type ProjectSourceSimulationSetup,
  type SimulationCircuitBinding,
  type SimulationCircuitScope,
  type SimulationExperimentConfig,
  type SimulationExpression,
  type LegacySimulationSetup as SimulationSetup,
  type SimulationSourceExpression,
  type SimulationRunVariant,
} from "@icm/model";
import { projectSourceSimulation } from "./simulation-source-projection.js";
import { sha256Hex } from "@icm/derived";
import {
  mapSimulationFile,
  insertSimulationText,
  type SimulationFileSourceMap,
} from "./simulation-source-map.js";
import {
  buildSimulationPlan,
  type CompiledSimulation,
  type CompiledSimulationDeviceOperatingPoint,
  type CompiledSimulationExpression,
  type CompiledSimulationOutput,
  type CompiledSimulationVector,
  type TerminalCurrentInstrumentation,
} from "./simulation-compile.js";
import {
  printSpiceWithLocations,
  type PrintedSpiceParameter,
} from "./printers.js";
import type { DesignNetlistCell } from "./ir.js";
import {
  inspectSimulationSourceGraph,
  type SimulationSourceDiagnostic,
  type SimulationSourceGraph,
} from "./simulation-source-graph.js";
import { resolveAuthoredCircuitScope } from "./simulation-source-scopes.js";

type Plan = Extract<CompiledSimulation, { ok: true }>;
type BoundLeaf = Extract<
  SimulationSourceExpression,
  { kind: "voltage" | "current" }
>;
export interface GeneratedSimulationFile {
  bindingId: string;
  path: string;
  text: string;
  parameters: PrintedSpiceParameter[];
}
export type SourceSimulationCompilation =
  | { ok: false; diagnostics: SimulationSourceDiagnostic[] }
  | {
      ok: true;
      config: SimulationExperimentConfig;
      /** Original source bytes remain separate from the execution projection. */
      authoredFiles: { path: string; text: string }[];
      files: { path: string; text: string }[];
      entry: string;
      generated: GeneratedSimulationFile[];
      vectors: CompiledSimulationVector[];
      outputs: CompiledSimulationOutput[];
      deviceOperatingPoints: CompiledSimulationDeviceOperatingPoint[];
      warnings: SimulationSourceDiagnostic[];
      reachedDocumentIds: string[];
      /** Includes object identities/parameters but excludes drawing-only changes. */
      electricalHash: string;
      sourceMaps: SimulationFileSourceMap[];
      includes: SimulationSourceGraph["includes"];
    };

/** Author text stays native. Canvas extraction, instrumentation and output math remain shared. */
export function compileSourceSimulation(
  project: CircuitProject,
  setup: ProjectSourceSimulationSetup,
  variant?: SimulationRunVariant,
): SourceSimulationCompilation {
  const diagnostics: SimulationSourceDiagnostic[] = [];
  const fail = (code: string, message: string, field?: string) =>
    diagnostics.push({
      code,
      severity: "error",
      message,
      ...(field ? { field } : {}),
    });
  const parsedConfig = readSimulationExperimentConfig(setup);
  if (!parsedConfig.ok)
    return {
      ok: false,
      diagnostics: (parsedConfig.fields.length
        ? parsedConfig.fields
        : [{ message: parsedConfig.message, field: "" }]
      ).map((issue) => ({
        code: parsedConfig.fields.length
          ? "SIMULATION_CONFIG_INVALID"
          : "SIMULATION_CONFIG_JSON",
        severity: "error",
        message: issue.message,
        path: parsedConfig.path,
        ...(issue.field ? { field: issue.field } : {}),
      })),
    };
  const graph = inspectSimulationSourceGraph(setup.input);
  diagnostics.push(...graph.diagnostics);
  const projection = projectSourceSimulation(
    project,
    setup,
    parsedConfig.config,
    graph,
    variant,
  );
  const effective = projection.project;
  const config = projection.config;
  diagnostics.push(...projection.diagnostics);
  const reachable = new Set(graph.paths);
  const bindings = setup.input.circuitBindings.filter((b) =>
    reachable.has(b.path),
  );
  const byBinding = new Map(bindings.map((b) => [b.id, b]));
  const leaves = new Map<
    BoundLeaf,
    { id: string; binding: SimulationCircuitBinding }
  >();
  const perBinding = new Map(
    bindings.map((b) => [
      b.id,
      [] as { id: string; expression: SimulationExpression }[],
    ]),
  );
  function register(expression: SimulationSourceExpression) {
    if (expression.kind === "voltage" || expression.kind === "current") {
      const binding = byBinding.get(expression.circuit.bindingId);
      if (!binding) {
        fail(
          "SIMULATION_BINDING_UNAVAILABLE",
          `Output binding ${expression.circuit.bindingId} is missing or is not included by the entry`,
        );
        return;
      }
      const id = `source-leaf-${leaves.size}`;
      const { circuit: _circuit, ...local } = expression;
      leaves.set(expression, { id, binding });
      perBinding.get(binding.id)!.push({ id, expression: local });
    } else if ("operand" in expression) register(expression.operand);
    else if ("left" in expression) {
      register(expression.left);
      register(expression.right);
    }
  }
  config.outputs.forEach((output) => register(output.expression));
  for (const target of config.deviceOperatingPoints)
    if (!byBinding.has(target.circuit.bindingId))
      fail(
        "SIMULATION_BINDING_UNAVAILABLE",
        `Device OP binding ${target.circuit.bindingId} is missing or not included`,
      );
  const intents = new Map(
    bindings.map((binding) => [
      binding.id,
      {
        version: 3,
        input: {
          kind: "structured",
          rootDocumentId: binding.documentId,
          environment: config.environment,
          analyses: [],
          outputs: perBinding
            .get(binding.id)!
            .map((leaf) => ({ ...leaf, label: leaf.id })),
          deviceOperatingPoints: config.deviceOperatingPoints
            .filter((target) => target.circuit.bindingId === binding.id)
            .map(({ circuit: _circuit, ...target }) => target),
          measurements: [],
          designVariables: [],
          runPlan: { mode: "nominal" },
        },
      } satisfies SimulationSetup,
    ]),
  );
  // Two passes share one ephemeral instrumentation set across reused Cell definitions.
  // No additional sources or pins are written back into the Project.
  let instrumentations: readonly TerminalCurrentInstrumentation[] = [];
  for (const intent of intents.values()) {
    const plan = buildSimulationPlan(effective, intent, {
      nativeControl: true,
      terminalInstrumentations: instrumentations,
    });
    if (plan.ok) instrumentations = plan.terminalInstrumentations;
    else
      diagnostics.push(
        ...plan.diagnostics.map((item) => ({
          code: item.code,
          severity: item.severity,
          message: item.message,
          field: item.documentId,
        })),
      );
  }
  if (diagnostics.some((d) => d.severity === "error"))
    return { ok: false, diagnostics };
  const plans = new Map<string, Plan>();
  for (const [id, intent] of intents) {
    const plan = buildSimulationPlan(effective, intent, {
      nativeControl: true,
      terminalInstrumentations: instrumentations,
    });
    if (!plan.ok)
      return {
        ok: false,
        diagnostics: plan.diagnostics.map((item) => ({
          code: item.code,
          severity: item.severity,
          message: item.message,
        })),
      };
    plans.set(id, plan);
    diagnostics.push(
      ...plan.warnings.map((item) => ({
        code: item.code,
        severity: item.severity,
        message: item.message,
        field: item.documentId,
      })),
    );
  }
  // A generated definition is emitted once even when two bound roots reach it.
  const definitions = new Map<
    string,
    { cell: DesignNetlistCell; bindingId: string }
  >();
  const names = new Map<string, string>();
  for (const binding of bindings) {
    const plan = plans.get(binding.id)!;
    for (const cell of plan.circuit.cells) {
      const name = cell.name.toLowerCase();
      if (names.has(name) && names.get(name) !== cell.id)
        fail(
          "SIMULATION_GENERATED_NAME_COLLISION",
          `Generated Cells share the name ${cell.name}`,
        );
      names.set(name, cell.id);
      if (binding.emission === "top-level" && cell.id === binding.documentId)
        continue;
      const prior = definitions.get(cell.id);
      if (prior && JSON.stringify(prior.cell) !== JSON.stringify(cell))
        fail(
          "SIMULATION_GENERATED_DEFINITION_CONFLICT",
          `Cell ${cell.name} has conflicting generated definitions`,
        );
      else if (!prior)
        definitions.set(cell.id, { cell, bindingId: binding.id });
    }
  }
  for (const { path, statement } of graph.statements) {
    if (
      statement.kind === "subckt_start" &&
      names.has(statement.name.toLowerCase())
    )
      diagnostics.push({
        code: "SIMULATION_GENERATED_DEFINITION_SHADOWED",
        severity: "error",
        message: `Author definition shadows generated Cell ${statement.name}`,
        path,
        sourceRef: statement.sourceRef,
      });
    if (
      bindings.length &&
      statement.kind === "control_command" &&
      ["source", "circbyline", "remcirc", "edit"].includes(
        statement.command.toLowerCase(),
      )
    )
      diagnostics.push({
        code: "SIMULATION_BOUND_TOPOLOGY_REPLACED",
        severity: "error",
        message:
          "Use Canvas edits for topology changes, or an unbound source experiment to replace the loaded circuit",
        path,
        sourceRef: statement.sourceRef,
      });
  }
  const generated: GeneratedSimulationFile[] = bindings.map((binding) => {
    const ir = plans.get(binding.id)!.circuit;
    const cells = ir.cells.filter(
      (cell) =>
        definitions.get(cell.id)?.bindingId === binding.id ||
        (binding.emission === "top-level" && cell.id === binding.documentId),
    );
    const printed = printSpiceWithLocations(
      { ...ir, cells },
      binding.emission === "top-level",
    );
    return { bindingId: binding.id, path: binding.path, ...printed };
  });
  const vectors: CompiledSimulationVector[] = [];
  const capture = new Set<string>();
  const scopes = new Map<
    string,
    ReturnType<typeof resolveAuthoredCircuitScope>
  >();
  const getScope = (
    binding: SimulationCircuitBinding,
    scope: SimulationCircuitScope,
  ) => {
    const key = JSON.stringify([
      binding.id,
      scope.callPath.map((part) => part.toLowerCase()),
    ]);
    let resolved = scopes.get(key);
    if (!resolved) {
      resolved = resolveAuthoredCircuitScope(
        graph,
        binding,
        plans.get(binding.id)!.circuit,
        scope,
      );
      scopes.set(key, resolved);
      if (!resolved.ok) fail("SIMULATION_CALL_SCOPE", resolved.message);
    }
    return resolved;
  };
  function acquisition(
    vector: string,
    quantity: CompiledSimulationVector["quantity"],
    collect: boolean,
  ): CompiledSimulationExpression {
    const normalized = vector.toLowerCase();
    if (normalized === "v(0)") return { kind: "constant", value: 0, unit: "V" };
    const existing = vectors.find(
      (item) => item.vector === normalized && item.quantity === quantity,
    );
    const item = existing ?? {
      probeId: `source-acquisition-${vectors.length}`,
      vector: normalized,
      quantity,
    };
    if (!existing) vectors.push(item);
    if (collect) capture.add(normalized);
    return {
      kind: "acquisition",
      acquisitionId: item.probeId,
      quantity: item.quantity,
    };
  }
  function scoped(
    expression: CompiledSimulationExpression,
    plan: Plan,
    binding: SimulationCircuitBinding,
    scope: SimulationCircuitScope,
  ): CompiledSimulationExpression {
    if (expression.kind === "acquisition") {
      const original = plan.vectors.find(
        (v) => v.probeId === expression.acquisitionId,
      )!;
      const resolved = getScope(binding, scope);
      return resolved.ok
        ? acquisition(resolved.vector(original.vector), original.quantity, true)
        : expression;
    }
    if ("operand" in expression)
      return {
        ...expression,
        operand: scoped(expression.operand, plan, binding, scope),
      };
    if ("left" in expression)
      return {
        ...expression,
        left: scoped(expression.left, plan, binding, scope),
        right: scoped(expression.right, plan, binding, scope),
      };
    return { ...expression };
  }
  function expression(
    source: SimulationSourceExpression,
  ): CompiledSimulationExpression {
    if (source.kind === "voltage" || source.kind === "current") {
      const leaf = leaves.get(source)!;
      const plan = plans.get(leaf.binding.id)!;
      getScope(leaf.binding, source.circuit);
      return scoped(
        plan.outputs.find((o) => o.id === leaf.id)!.expression,
        plan,
        leaf.binding,
        source.circuit,
      );
    }
    if (source.kind === "vector") {
      if (/[\r\n;]/u.test(source.vector))
        fail(
          "SIMULATION_VECTOR_INVALID",
          "A native vector must be one expression, not multiple commands",
        );
      return acquisition(source.vector, "native", false);
    }
    if ("operand" in source)
      return { ...source, operand: expression(source.operand) };
    if ("left" in source)
      return {
        ...source,
        left: expression(source.left),
        right: expression(source.right),
      };
    return { ...source };
  }
  const outputs = config.outputs.map((output) => ({
    ...output,
    expression: expression(output.expression),
  }));
  const deviceOperatingPoints = config.deviceOperatingPoints.map((target) => {
    const binding = byBinding.get(target.circuit.bindingId)!;
    const plan = plans.get(binding.id)!;
    const compiled = plan.deviceOperatingPoints.find(
      (item) => item.id === target.id,
    )!;
    return {
      ...compiled,
      reference: [...target.circuit.callPath, compiled.reference].join("."),
      values: compiled.values.map((value) => ({
        ...value,
        expression: scoped(value.expression, plan, binding, target.circuit),
      })),
    };
  });
  for (const measurement of config.measurements)
    if (
      !outputs.some((o) => o.id === measurement.outputId) &&
      measurement.outputId !== SIMULATION_NOISE_INPUT_DENSITY_ID &&
      measurement.outputId !== SIMULATION_NOISE_OUTPUT_DENSITY_ID
    )
      fail(
        "SIMULATION_MEASUREMENT_OUTPUT_MISSING",
        `Measurement ${measurement.label} references missing Output ${measurement.outputId}`,
      );
  if (diagnostics.some((d) => d.severity === "error"))
    return { ok: false, diagnostics };
  const mappedFiles = [
    ...projection.mappedFiles,
    ...generated.map(({ path, text, bindingId }) =>
      mapSimulationFile(path, text, {
        kind: "generated",
        purpose: "canvas-circuit",
        bindingId,
      }),
    ),
  ];
  if (capture.size) {
    const index = mappedFiles.findIndex((f) => f.path === setup.input.entry);
    const entry = mappedFiles[index]!;
    const end = entry.text.indexOf("\n");
    const prefix = `* Canvas acquisitions (generated)\n.save all ${[...capture].join(" ")}\n`;
    // Keep the native title in place. Other author bytes are never reformatted.
    mappedFiles[index] = insertSimulationText(
      entry,
      end < 0 ? entry.text.length : end + 1,
      (end < 0 ? "\n" : "") + prefix,
      { kind: "generated", purpose: "canvas-acquisitions" },
    );
  }
  return {
    ok: true,
    config,
    authoredFiles: structuredClone(setup.input.files),
    files: mappedFiles.map(({ path, text }) => ({ path, text })),
    sourceMaps: mappedFiles.map(({ path, segments }) => ({ path, segments })),
    includes: graph.includes,
    electricalHash: sha256Hex(
      JSON.stringify(
        [...plans]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([id, plan]) => ({ bindingId: id, circuit: plan.circuit })),
      ),
    ),
    entry: setup.input.entry,
    generated,
    vectors,
    outputs,
    deviceOperatingPoints,
    warnings: diagnostics,
    reachedDocumentIds: [
      ...new Set(
        [...plans.values()].flatMap((plan) =>
          plan.circuit.cells.map((cell) => cell.id),
        ),
      ),
    ],
  };
}
