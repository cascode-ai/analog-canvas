import {
  deriveStableId,
  ProjectSourceSimulationSetupSchema,
  type CircuitProject,
  type LegacyProjectSimulationSetup,
  type ProjectSourceSimulationSetup,
  type SimulationAnalysisSpec,
  type SimulationCircuitScope,
  type SimulationExperimentConfig,
  type SimulationExpression,
  type SimulationSourceExpression,
} from "@icm/model";
import { deckRequestsRawfile } from "@icm/spice-run";
import { unquoteSimulationToken } from "@icm/spice";
import { buildSimulationPlan } from "./simulation-compile.js";
import { inspectSimulationSourceGraph } from "./simulation-source-graph.js";

export interface SimulationSourceMigration {
  setup: ProjectSourceSimulationSetup;
  warnings: string[];
}

/** Offline, one-way conversion. No simulator, model files or async hashing. */
export function migrateSimulationSetupToSource(
  project: CircuitProject,
  setup: LegacyProjectSimulationSetup,
): SimulationSourceMigration {
  const warnings: string[] = [];
  const input = setup.input;
  const { temperatureC, ...environment } = input.environment;
  const config: SimulationExperimentConfig = {
    version: 1,
    environment,
    runPlan: { mode: "nominal" },
    variables: [],
    outputs: [],
    deviceOperatingPoints: [],
    measurements: [],
    collection: { rawfile: "out.raw" },
  };
  if (input.kind === "raw") {
    const occupied = new Set([
      ...input.files.map((f) => f.path),
      ...input.dependencies.map((d) => d.mountPath),
    ]);
    let configPath = "experiment.json";
    for (let index = 1; occupied.has(configPath); index++)
      configPath = `experiment-${index}.json`;
    if (temperatureC !== undefined)
      warnings.push(
        `Raw setup ${setup.name} recorded environment.temperatureC=${temperatureC}, but the raw executor did not apply it. The source is preserved unchanged; author .temp explicitly to change its simulation temperature.`,
      );
    // Raw input did not promise collection unless its text requested it.
    const graph = inspectSimulationSourceGraph({
      ...input,
      kind: "source",
      configPath,
      circuitBindings: [],
    });
    const writes = [
      ...new Set(
        graph.statements.flatMap(({ statement }) =>
          statement.kind === "control_command" &&
          statement.command.toLowerCase() === "write" &&
          statement.arguments[0]
            ? [unquoteSimulationToken(statement.arguments[0])]
            : [],
        ),
      ),
    ];
    config.collection.rawfile = input.files.some((f) =>
      deckRequestsRawfile(f.text),
    )
      ? "out.raw"
      : null;
    if (writes.length === 1 && /^[a-zA-Z0-9_.-]+\.raw$/u.test(writes[0]!))
      config.collection.rawfile = writes[0]!;
    else if (writes.length > 0 && !writes.includes("out.raw"))
      warnings.push(
        "Raw output selection is dynamic or has multiple paths; review collection.rawfile. Authored write commands were preserved unchanged.",
      );
    return {
      setup: ProjectSourceSimulationSetupSchema.parse({
        id: setup.id,
        name: setup.name,
        version: 4,
        input: {
          kind: "source",
          entry: input.entry,
          configPath,
          files: [
            ...structuredClone(input.files),
            { path: configPath, text: `${JSON.stringify(config, null, 2)}\n` },
          ],
          circuitBindings: [],
          dependencies: structuredClone(input.dependencies),
        },
      }),
      warnings,
    };
  }

  const binding = {
    id: deriveStableId(
      "simulation-circuit-binding",
      setup.id,
      input.rootDocumentId,
    ),
    documentId: input.rootDocumentId,
    path: "circuit.spice",
    emission: "top-level" as const,
  };
  const circuit = { bindingId: binding.id, callPath: [] };
  config.outputs = input.outputs.map((output) => ({
    ...output,
    expression: scopeExpression(output.expression, circuit),
  }));
  config.deviceOperatingPoints = (input.deviceOperatingPoints ?? []).map(
    (target) => ({ ...structuredClone(target), circuit }),
  );
  config.measurements = structuredClone(input.measurements ?? []);
  config.variables = input.designVariables.map(
    ({ value: _value, ...variable }) => ({
      ...structuredClone(variable),
      sourcePath: "run.cir",
    }),
  );
  config.runPlan = structuredClone(input.runPlan);
  const planned = buildSimulationPlan(project, setup);
  if (!planned.ok)
    warnings.push(...planned.diagnostics.map((d) => `${d.code}: ${d.message}`));
  const commands = planned.ok
    ? planned.commands
    : input.analyses.map((analysis) => ({
        kind: analysis.kind,
        command: unresolvedAnalysis(analysis, project, input.rootDocumentId),
      }));
  const run = [
    `* ${setup.name.replace(/[\r\n]/gu, " ")} — migrated authored experiment`,
    ...input.designVariables.map(
      (variable) => `.param ${variable.name}=${variable.value}`,
    ),
    ...(temperatureC === undefined ? [] : [`.temp ${temperatureC}`]),
    '.include "circuit.spice"',
    ".control",
    "set filetype=ascii",
    "set appendwrite",
    ...commands.flatMap(({ kind, command }) => [
      command,
      kind === "noise"
        ? "write out.raw noise1.all noise2.all"
        : "write out.raw",
    ]),
    ".endc",
    ".end",
    "",
  ].join("\n");
  return {
    setup: ProjectSourceSimulationSetupSchema.parse({
      id: setup.id,
      name: setup.name,
      version: 4,
      input: {
        kind: "source",
        entry: "run.cir",
        configPath: "experiment.json",
        files: [
          { path: "run.cir", text: run },
          {
            path: "experiment.json",
            text: `${JSON.stringify(config, null, 2)}\n`,
          },
        ],
        circuitBindings: [binding],
        dependencies: [],
      },
    }),
    warnings,
  };
}

function scopeExpression(
  expression: SimulationExpression,
  circuit: SimulationCircuitScope,
): SimulationSourceExpression {
  if (expression.kind === "voltage" || expression.kind === "current")
    return { ...structuredClone(expression), circuit };
  if ("operand" in expression)
    return {
      ...expression,
      operand: scopeExpression(expression.operand, circuit),
    };
  if ("left" in expression)
    return {
      ...expression,
      left: scopeExpression(expression.left, circuit),
      right: scopeExpression(expression.right, circuit),
    };
  return { ...expression };
}

/** Preserve incomplete intent as visible source, never replace it with a working demo. */
function unresolvedAnalysis(
  analysis: SimulationAnalysisSpec,
  project: CircuitProject,
  documentId: string,
): string {
  switch (analysis.kind) {
    case "op":
      return "op";
    case "ac":
      return `ac ${analysis.sweep} ${analysis.points} ${analysis.startHz} ${analysis.stopHz}`;
    case "tran":
      return [
        "tran",
        analysis.stepSeconds,
        analysis.stopSeconds,
        ...(analysis.startSeconds === undefined &&
        analysis.maxStepSeconds === undefined
          ? []
          : [analysis.startSeconds ?? 0]),
        ...(analysis.maxStepSeconds === undefined
          ? []
          : [analysis.maxStepSeconds]),
      ].join(" ");
    case "dc": {
      const source = project.documents
        .find((d) => d.id === documentId)
        ?.instances.find((i) => i.id === analysis.sourceInstanceId)?.reference;
      return `${source ? "" : `* Unresolved source identity: ${JSON.stringify(analysis)}\n`}dc ${source ?? "__UNRESOLVED_SOURCE__"} ${analysis.startValue} ${analysis.stopValue} ${analysis.stepValue * Math.sign(analysis.stopValue - analysis.startValue)}`;
    }
    case "noise":
      return `* Unresolved Noise intent: ${JSON.stringify(analysis)}\nnoise v(__UNRESOLVED_OUTPUT__) __UNRESOLVED_SOURCE__ ${analysis.sweep} ${analysis.points} ${analysis.startHz} ${analysis.stopHz}`;
  }
}
