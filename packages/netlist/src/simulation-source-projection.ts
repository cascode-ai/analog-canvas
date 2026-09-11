import {
  SimulationRunVariantSchema,
  type CircuitProject,
  type ProjectSimulationFolder,
  type SimulationExperimentConfig,
  type SimulationRunVariant,
} from "@icm/model";
import {
  evaluateSpiceExpression,
  locateSpiceParameterValues,
  type ParameterStatement,
} from "@icm/spice";
import type {
  SimulationSourceGraph,
  SimulationSourceDiagnostic,
  SourceStatement,
} from "./simulation-source-graph.js";
import {
  mapSimulationFile,
  replaceSimulationText,
} from "./simulation-source-map.js";

/** Mutates only the caller's run projection. Both legacy and native compilers share target resolution. */
export function applySimulationParameter(
  project: CircuitProject,
  target: {
    readonly documentId: string;
    readonly instanceId: string;
    readonly parameter: string;
  },
  value: string,
  source: string,
  codePrefix: string,
  requireExisting = false,
): { ok: true } | { ok: false; code: string; message: string } {
  const document = project.documents.find((d) => d.id === target.documentId);
  if (!document)
    return {
      ok: false,
      code: `${codePrefix}_DOCUMENT_MISSING`,
      message: `${source} Document does not exist: ${target.documentId}`,
    };
  const instance = document.instances.find((i) => i.id === target.instanceId);
  if (!instance?.netlist)
    return {
      ok: false,
      code: `${codePrefix}_INSTANCE_MISSING`,
      message: `${source} Instance is unavailable or has no netlist parameters: ${target.instanceId}`,
    };
  if (requireExisting && !(target.parameter in instance.netlist.parameters))
    return {
      ok: false,
      code: `${codePrefix}_PARAMETER_MISSING`,
      message: `${source} parameter does not exist: ${target.instanceId}.${target.parameter}`,
    };
  instance.netlist.parameters[target.parameter] = value;
  return { ok: true };
}

/** Nominal source -> variable point -> exact Canvas point, with no edits to persistent input. */
export function projectSourceSimulation(
  project: CircuitProject,
  folder: ProjectSimulationFolder,
  config: SimulationExperimentConfig,
  graph: SimulationSourceGraph,
  variant?: SimulationRunVariant,
) {
  const effective = structuredClone(project);
  config = structuredClone(config);
  const mappedFiles = folder.input.files
    .filter((f) => f.path !== folder.input.configPath)
    .map((f) => mapSimulationFile(f.path, f.text));
  const diagnostics: SimulationSourceDiagnostic[] = [];
  const issue = (code: string, message: string, item?: SourceStatement) =>
    diagnostics.push({
      code,
      message,
      severity: "error",
      ...(item ? { path: item.path, sourceRef: item.statement.sourceRef } : {}),
    });
  const parsed = SimulationRunVariantSchema.safeParse(variant ?? {});
  if (!parsed.success) {
    issue("SIMULATION_VARIANT_INVALID", parsed.error.issues[0]!.message);
    return { project: effective, config, mappedFiles, diagnostics };
  }
  variant = parsed.data;
  if (variant.environment?.corner)
    config.environment.corner = variant.environment.corner;
  type Declaration = SourceStatement & {
    raw: string;
    conditional: boolean;
    statement: ParameterStatement;
  };
  const declarations = new Map<string, Declaration[]>();
  const temperatures: (SourceStatement & { conditional: boolean })[] = [];
  let local = 0,
    conditional = 0;
  for (const item of graph.statements) {
    const statement = item.statement;
    if (statement.kind === "subckt_start") local++;
    else if (statement.kind === "subckt_end") local--;
    else if (statement.kind === "conditional") {
      if (statement.form === "if") conditional++;
      else if (statement.form === "endif") conditional--;
    } else if (statement.kind === "parameter" && local === 0) {
      for (const p of statement.parameters) {
        const name = p.name.toLowerCase();
        declarations.set(name, [
          ...(declarations.get(name) ?? []),
          {
            path: item.path,
            statement,
            raw: p.rawText,
            conditional: conditional !== 0,
          },
        ]);
      }
    } else if (
      statement.kind === "directive" &&
      statement.name === "temp" &&
      local === 0
    )
      temperatures.push({ ...item, conditional: conditional !== 0 });
  }
  const changes: { path: string; start: number; end: number; text: string }[] =
    [];
  const overrides = new Map<string, string>();
  for (const point of variant.variables ?? []) {
    const variable = config.variables.find((v) => v.id === point.variableId);
    if (!variable) {
      issue(
        "SIMULATION_VARIABLE_MISSING",
        `Design Variable does not exist: ${point.variableId}`,
      );
      continue;
    }
    const name = variable.name.toLowerCase();
    if (overrides.has(name)) {
      issue(
        "SIMULATION_VARIABLE_DUPLICATE",
        `More than one point supplied for ${variable.name}`,
      );
      continue;
    }
    const items = declarations.get(name) ?? [];
    const declaration = items[0];
    if (
      items.length !== 1 ||
      !declaration ||
      declaration.conditional ||
      declaration.path !== variable.sourcePath
    ) {
      issue(
        "SIMULATION_VARIABLE_DECLARATION",
        `Variable ${variable.name} requires one reachable top-level .param at ${variable.sourcePath}`,
        declaration,
      );
      continue;
    }
    const range = locateSpiceParameterValues(declaration.statement).find(
      (p) => p.name.toLowerCase() === name,
    );
    if (!range) {
      issue(
        "SIMULATION_VARIABLE_RANGE",
        `Cannot locate a reversible value range for ${variable.name}`,
        declaration,
      );
      continue;
    }
    // A managed point is one scalar expression, not additional native cards.
    if (/[\r\n;]/u.test(point.value)) {
      issue(
        "SIMULATION_VARIABLE_POINT",
        `Use one scalar expression for ${variable.name}`,
        declaration,
      );
      continue;
    }
    overrides.set(name, point.value);
    changes.push({
      path: declaration.path,
      start: range.startOffset,
      end: range.endOffset,
      text: point.value,
    });
  }
  const values = new Map<string, number>();
  for (let pass = 0; pass < declarations.size; pass++) {
    let changed = false;
    for (const [name, items] of declarations) {
      if (values.has(name) || items.length !== 1 || items[0]!.conditional)
        continue;
      const value = evaluateSpiceExpression(
        overrides.get(name) ?? items[0]!.raw,
        values,
      );
      if (value !== null) {
        values.set(name, value);
        changed = true;
      }
    }
    if (!changed) break;
  }
  for (const variable of config.variables) {
    if (
      !variable.bindings.length &&
      !overrides.has(variable.name.toLowerCase())
    )
      continue;
    const key = variable.name.toLowerCase(),
      items = declarations.get(key) ?? [],
      value = values.get(key);
    if (
      items.length !== 1 ||
      items[0]!.path !== variable.sourcePath ||
      value === undefined
    ) {
      issue(
        "SIMULATION_VARIABLE_DECLARATION",
        `Variable ${variable.name} requires an unambiguous root .param with a finite value for descriptor projection`,
        items[0],
      );
      continue;
    }
    for (const target of variable.bindings) {
      const document = effective.documents.find(
        (d) => d.id === target.documentId,
      );
      if (
        document?.netlist?.formalParameters.some(
          (p) => p.name.toLowerCase() === key,
        )
      ) {
        issue(
          "SIMULATION_VARIABLE_SHADOWED",
          `Cell ${document.name} has a formal parameter ${variable.name}; choose an unshadowed root binding`,
          items[0],
        );
        continue;
      }
      const result = applySimulationParameter(
        effective,
        target,
        String(value),
        "Design Variable",
        "SIMULATION_VARIABLE_BINDING",
        true,
      );
      if (!result.ok) issue(result.code, result.message, items[0]);
    }
  }
  const targets = new Set<string>();
  for (const point of variant.parameters ?? []) {
    const key = JSON.stringify([
      point.documentId,
      point.instanceId,
      point.parameter.toLowerCase(),
    ]);
    if (targets.has(key)) {
      issue(
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
    if (!result.ok) issue(result.code, result.message);
  }
  if (variant.environment?.temperatureC !== undefined) {
    if (temperatures.length > 1 || temperatures.some((t) => t.conditional)) {
      issue(
        "SIMULATION_TEMPERATURE_AMBIGUOUS",
        "A managed temperature point needs at most one unconditional root .temp; native temperature programs remain editable",
        temperatures[0],
      );
    } else if (temperatures[0]) {
      const item = temperatures[0];
      // Preserve the directive and its comments: replace the one literal/parameter value only.
      const match = /^\s*\.temp\s+/iu.exec(item.statement.rawText);
      if (
        item.statement.kind !== "directive" ||
        item.statement.arguments.length !== 1 ||
        !match ||
        !item.statement.rawText
          .slice(match[0].length)
          .startsWith(item.statement.arguments[0]!)
      ) {
        issue(
          "SIMULATION_TEMPERATURE_AMBIGUOUS",
          "Use one nominal .temp value for a managed temperature point",
          item,
        );
      } else {
        const start = item.statement.sourceRef.start.offset + match[0].length;
        changes.push({
          path: item.path,
          start,
          end: start + item.statement.arguments[0]!.length,
          text: String(variant.environment.temperatureC),
        });
      }
    } else {
      const entry = mappedFiles.find((f) => f.path === folder.input.entry);
      if (entry) {
        const lineEnd = entry.text.indexOf("\n");
        const start = lineEnd < 0 ? entry.text.length : lineEnd + 1;
        changes.push({
          path: entry.path,
          start,
          end: start,
          text: `${lineEnd < 0 ? "\n" : ""}.temp ${variant.environment.temperatureC}\n`,
        });
      }
    }
  }
  for (const change of changes.sort((a, b) => b.start - a.start)) {
    const index = mappedFiles.findIndex((f) => f.path === change.path);
    if (index < 0) continue;
    mappedFiles[index] = replaceSimulationText(
      mappedFiles[index]!,
      change.start,
      change.end,
      change.text,
      {
        kind: "generated",
        purpose: "run-variant",
        nominal: {
          path: change.path,
          startOffset: change.start,
          endOffset: change.end,
        },
      },
    );
  }
  return { project: effective, config, mappedFiles, diagnostics };
}
