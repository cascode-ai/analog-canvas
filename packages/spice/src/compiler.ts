import { deriveStableId } from "@icm/model";
import type { SourceSpan } from "@icm/model";

import { diagnostic } from "./diagnostics.js";
import type { SpiceDiagnostic } from "./diagnostics.js";
import {
  detectSpiceDialect,
  type SpiceCompileOptions,
  type SpiceDialectEvidence,
} from "./dialect.js";
import { evaluateSpiceExpression } from "./expression.js";
import { CircuitIRSchema } from "./ir.js";
import type {
  CircuitCellIR,
  CircuitIR,
  CircuitInstanceIR,
  CircuitInstanceTargetIRSchema,
  CircuitNetIR,
  CircuitParameterDeclarationIR,
  ModelDeclarationIR,
  OpaqueStatement,
  PreservedStatementIR,
} from "./ir.js";
import { createSourceBundle } from "./source.js";
import type { SourceBundle, SpiceSourceInput } from "./source-types.js";
import type {
  InstanceStatement,
  OpaqueSyntaxStatement,
  RawSpiceParameter,
  SpiceStatement,
} from "./syntax.js";
import type { z } from "zod";

type CircuitTarget = z.infer<typeof CircuitInstanceTargetIRSchema>;

interface CellDefinition {
  name: string;
  ports: string[];
  parameters: RawSpiceParameter[];
  instances: InstanceStatement[];
  sourceRef: SourceSpan;
}

export interface SpiceCompileResult {
  bundle: SourceBundle;
  ir: CircuitIR | null;
  diagnostics: SpiceDiagnostic[];
  dialectEvidence: SpiceDialectEvidence;
  successful: boolean;
}

function normalizeName(name: string): string {
  return name.toLowerCase();
}

function fullSpan(start: SourceSpan, end: SourceSpan): SourceSpan {
  if (start.fileId !== end.fileId) return start;
  return { fileId: start.fileId, start: start.start, end: end.end };
}

function declaration(
  parameter: RawSpiceParameter,
): CircuitParameterDeclarationIR {
  return {
    name: parameter.name,
    rawText: parameter.rawText,
    sourceRef: parameter.sourceRef,
  };
}

function opaqueIr(statement: OpaqueSyntaxStatement): OpaqueStatement {
  return {
    kind: "opaque",
    rawText: statement.rawText,
    sourceRef: statement.sourceRef,
    ...(statement.probableType ? { probableType: statement.probableType } : {}),
  };
}

function collectDefinitions(
  bundle: SourceBundle,
  diagnostics: SpiceDiagnostic[],
): {
  definitions: CellDefinition[];
  parameters: CircuitParameterDeclarationIR[];
  models: ModelDeclarationIR[];
  globalNames: Set<string>;
  opaque: OpaqueStatement[];
  preserved: PreservedStatementIR[];
} {
  const definitions: CellDefinition[] = [];
  const parameters: CircuitParameterDeclarationIR[] = [];
  const models: ModelDeclarationIR[] = [];
  const globalNames = new Set(["0"]);
  const opaque: OpaqueStatement[] = [];
  const preserved: PreservedStatementIR[] = [];
  const topInstances: InstanceStatement[] = [];
  const globalSymbols = new Map<string, number>();
  const selectedSectionsByFile = new Map<string, Set<string>>();
  for (const dependency of bundle.dependencies) {
    if (!dependency.targetFileId || !dependency.section) continue;
    const sections =
      selectedSectionsByFile.get(dependency.targetFileId) ?? new Set<string>();
    sections.add(normalizeName(dependency.section));
    selectedSectionsByFile.set(dependency.targetFileId, sections);
  }

  const preserve = (
    statement: SpiceStatement,
    kind: PreservedStatementIR["kind"],
    name: string,
  ): void => {
    preserved.push({
      kind,
      name,
      rawText: statement.rawText,
      sourceRef: statement.sourceRef,
    });
  };

  interface ConditionFrame {
    parentActive: boolean;
    active: boolean;
    branchTaken: boolean;
    resolved: boolean;
  }

  for (const syntaxFile of bundle.syntaxFiles) {
    let current: CellDefinition | null = null;
    let currentSymbols = new Map(globalSymbols);
    let librarySection: string | null = null;
    const selectedSections = selectedSectionsByFile.get(syntaxFile.fileId);
    const conditions: ConditionFrame[] = [];
    const isActive = (): boolean => conditions.every((frame) => frame.active);
    for (const statement of syntaxFile.statements) {
      if (statement.kind === "library") {
        preserve(
          statement,
          "library",
          `${statement.mode}:${statement.section}`,
        );
        if (statement.mode === "section-start") {
          librarySection = normalizeName(statement.section);
        } else if (statement.mode === "section-end") {
          librarySection = null;
        }
        continue;
      }
      if (
        selectedSections &&
        (!librarySection || !selectedSections.has(librarySection))
      ) {
        continue;
      }
      if (statement.kind === "conditional") {
        preserve(statement, "conditional", statement.form);
        const parentActive = conditions.every((frame) => frame.active);
        if (statement.form === "if") {
          const value = evaluateSpiceExpression(
            statement.rawExpression ?? "",
            current ? currentSymbols : globalSymbols,
          );
          if (value === null) {
            diagnostics.push(
              diagnostic(
                "SPICE_BIND_CONDITION_UNRESOLVED",
                "warning",
                "bind",
                `Conditional expression was preserved but not elaborated: ${statement.rawExpression ?? ""}`,
                statement.sourceRef,
              ),
            );
          }
          conditions.push({
            parentActive,
            active: parentActive && value !== null && value !== 0,
            branchTaken: value !== null && value !== 0,
            resolved: value !== null,
          });
        } else {
          const frame = conditions.at(-1);
          if (!frame) {
            diagnostics.push(
              diagnostic(
                "SPICE_BIND_CONDITIONAL_MISMATCH",
                "error",
                "bind",
                `.${statement.form} has no matching .if`,
                statement.sourceRef,
              ),
            );
            continue;
          }
          if (statement.form === "elseif") {
            const value = evaluateSpiceExpression(
              statement.rawExpression ?? "",
              current ? currentSymbols : globalSymbols,
            );
            frame.resolved = frame.resolved && value !== null;
            frame.active =
              frame.parentActive &&
              frame.resolved &&
              !frame.branchTaken &&
              value !== 0;
            if (value !== null && value !== 0) frame.branchTaken = true;
          } else if (statement.form === "else") {
            frame.active =
              frame.parentActive && frame.resolved && !frame.branchTaken;
            frame.branchTaken = true;
          } else {
            conditions.pop();
          }
        }
        continue;
      }
      if (!isActive()) continue;
      switch (statement.kind) {
        case "include":
          preserve(statement, "directive", "include");
          break;
        case "subckt_start":
          if (current) {
            diagnostics.push(
              diagnostic(
                "SPICE_BIND_NESTED_SUBCKT",
                "error",
                "bind",
                `Nested subcircuit ${statement.name} is not valid`,
                statement.sourceRef,
                [{ message: "Open subcircuit", sourceRef: current.sourceRef }],
              ),
            );
            definitions.push(current);
          }
          current = {
            name: statement.name,
            ports: statement.ports,
            parameters: [...statement.parameters],
            instances: [],
            sourceRef: statement.sourceRef,
          };
          currentSymbols = new Map(globalSymbols);
          for (const parameter of statement.parameters) {
            const value = evaluateSpiceExpression(
              parameter.rawText,
              currentSymbols,
            );
            if (value !== null)
              currentSymbols.set(normalizeName(parameter.name), value);
          }
          break;
        case "subckt_end":
          if (!current) {
            diagnostics.push(
              diagnostic(
                "SPICE_BIND_UNMATCHED_ENDS",
                "error",
                "bind",
                "Subcircuit end has no matching start",
                statement.sourceRef,
              ),
            );
            opaque.push({
              kind: "opaque",
              rawText: statement.rawText,
              sourceRef: statement.sourceRef,
              probableType: "directive",
            });
            break;
          }
          if (
            statement.name &&
            normalizeName(statement.name) !== normalizeName(current.name)
          ) {
            diagnostics.push(
              diagnostic(
                "SPICE_BIND_ENDS_MISMATCH",
                "error",
                "bind",
                `.ends ${statement.name} does not match .subckt ${current.name}`,
                statement.sourceRef,
                [{ message: "Subcircuit start", sourceRef: current.sourceRef }],
              ),
            );
          }
          current.sourceRef = fullSpan(current.sourceRef, statement.sourceRef);
          definitions.push(current);
          current = null;
          currentSymbols = new Map(globalSymbols);
          break;
        case "parameter":
          if (current) {
            current.parameters.push(...statement.parameters);
          } else {
            parameters.push(...statement.parameters.map(declaration));
          }
          for (const parameter of statement.parameters) {
            const target = current ? currentSymbols : globalSymbols;
            const value = evaluateSpiceExpression(parameter.rawText, target);
            if (value !== null)
              target.set(normalizeName(parameter.name), value);
          }
          break;
        case "model":
          models.push({
            name: statement.name,
            modelType: statement.modelType,
            rawParameters: statement.rawParameters,
            sourceRef: statement.sourceRef,
          });
          break;
        case "global":
          for (const name of statement.names)
            globalNames.add(normalizeName(name));
          break;
        case "instance":
          if (current) current.instances.push(statement);
          else topInstances.push(statement);
          break;
        case "opaque":
          opaque.push(opaqueIr(statement));
          break;
        case "function":
          preserve(statement, "function", statement.name);
          break;
        case "control_boundary":
          preserve(statement, "control", statement.form);
          break;
        case "control_command":
          preserve(statement, "control", statement.command);
          break;
        case "directive":
          preserve(statement, "directive", statement.name);
          break;
      }
    }
    if (conditions.length > 0) {
      diagnostics.push(
        diagnostic(
          "SPICE_BIND_UNTERMINATED_CONDITIONAL",
          "error",
          "bind",
          "Conditional block has no matching .endif",
        ),
      );
    }
    if (current) {
      diagnostics.push(
        diagnostic(
          "SPICE_BIND_UNTERMINATED_SUBCKT",
          "error",
          "bind",
          `Subcircuit ${current.name} has no matching .ends`,
          current.sourceRef,
        ),
      );
      definitions.push(current);
    }
  }

  if (topInstances.length > 0) {
    definitions.push({
      name: "__flat__",
      ports: [],
      parameters: [],
      instances: topInstances,
      sourceRef: fullSpan(
        topInstances[0]!.sourceRef,
        topInstances.at(-1)!.sourceRef,
      ),
    });
  }
  return {
    definitions,
    parameters,
    models,
    globalNames,
    opaque,
    preserved,
  };
}

function parameterRecord(
  parameters: RawSpiceParameter[],
  controlSource?: string,
): CircuitInstanceIR["parameters"] {
  const result: CircuitInstanceIR["parameters"] = {};
  const occurrences = new Map<string, number>();
  const add = (name: string, rawText: string): void => {
    const normalizedName = normalizeName(name);
    const occurrence = (occurrences.get(normalizedName) ?? 0) + 1;
    occurrences.set(normalizedName, occurrence);
    const key =
      occurrence === 1 ? normalizedName : `${normalizedName}#${occurrence}`;
    result[key] = { normalizedName, rawText };
  };
  for (const parameter of parameters) add(parameter.name, parameter.rawText);
  if (controlSource) add("control-source", controlSource);
  return result;
}

function defaultPinNames(statement: InstanceStatement): string[] {
  const byFamily: Partial<Record<InstanceStatement["family"], string[]>> = {
    resistor: ["1", "2"],
    capacitor: ["1", "2"],
    inductor: ["1", "2"],
    "voltage-source": ["+", "-"],
    "current-source": ["+", "-"],
    vcvs: ["OUT+", "OUT-", "CTRL+", "CTRL-"],
    vccs: ["OUT+", "OUT-", "CTRL+", "CTRL-"],
    cccs: ["OUT+", "OUT-"],
    ccvs: ["OUT+", "OUT-"],
    diode: ["A", "K"],
    bjt: ["C", "B", "E", "S"],
    jfet: ["D", "G", "S"],
    mesfet: ["D", "G", "S"],
    switch: ["1", "2", "CTRL+", "CTRL-"],
    "current-switch": ["1", "2"],
    mosfet: ["D", "G", "S", "B"],
    "behavioral-source": ["+", "-"],
    "lossless-transmission-line": ["1+", "1-", "2+", "2-"],
    "lossy-transmission-line": ["1+", "1-", "2+", "2-"],
    "single-lossy-transmission-line": ["1+", "1-", "2+", "2-"],
    "uniform-rc-line": ["1", "2", "REF"],
  };
  const known = byFamily[statement.family] ?? [];
  return statement.nodes.map((_, index) => known[index] ?? `P${index + 1}`);
}

function targetFor(
  statement: InstanceStatement,
  definitions: Map<string, CellDefinition>,
): { target: CircuitTarget; pinNames: string[]; calledCell?: string } {
  if (statement.family === "subcircuit") {
    const master = statement.master!;
    const definition = definitions.get(normalizeName(master));
    if (definition) {
      return {
        target: { kind: "subcircuit", cellName: definition.name },
        pinNames: statement.nodes.map(
          (_, index) => definition.ports[index] ?? `P${index + 1}`,
        ),
        calledCell: definition.name,
      };
    }
    return {
      target: { kind: "external-subcircuit", masterName: master },
      pinNames: statement.nodes.map((_, index) => `P${index + 1}`),
    };
  }
  if (
    [
      "diode",
      "bjt",
      "jfet",
      "mesfet",
      "switch",
      "current-switch",
      "mosfet",
      "lossy-transmission-line",
      "coupled-multiconductor-line",
      "uniform-rc-line",
      "single-lossy-transmission-line",
    ].includes(statement.family) &&
    statement.master
  ) {
    return {
      target: { kind: "model", modelName: statement.master },
      pinNames: defaultPinNames(statement),
    };
  }
  return {
    target: { kind: "primitive", family: statement.family },
    pinNames: defaultPinNames(statement),
  };
}

function buildCell(
  definition: CellDefinition,
  definitions: Map<string, CellDefinition>,
  globalNames: Set<string>,
  diagnostics: SpiceDiagnostic[],
  calledCells: Set<string>,
): CircuitCellIR {
  const netByName = new Map<string, CircuitNetIR>();
  const netFor = (name: string): CircuitNetIR => {
    const normalized = normalizeName(name);
    let net = netByName.get(normalized);
    if (!net) {
      net = {
        id: deriveStableId("net", normalizeName(definition.name), normalized),
        name,
        scope: globalNames.has(normalized) ? "global" : "local",
      };
      netByName.set(normalized, net);
    }
    return net;
  };

  const ports = definition.ports.map((name, position) => ({
    name,
    position,
    netId: netFor(name).id,
    sourceRef: definition.sourceRef,
  }));
  const instances: CircuitInstanceIR[] = [];
  const seenInstances = new Map<string, number>();
  for (const statement of definition.instances) {
    const normalizedInstance = normalizeName(statement.name);
    const occurrence = (seenInstances.get(normalizedInstance) ?? 0) + 1;
    seenInstances.set(normalizedInstance, occurrence);
    if (occurrence > 1) {
      diagnostics.push(
        diagnostic(
          "SPICE_BIND_DUPLICATE_INSTANCE",
          "error",
          "bind",
          `Duplicate instance ${statement.name} in ${definition.name}`,
          statement.sourceRef,
        ),
      );
    }
    const resolved = targetFor(statement, definitions);
    if (resolved.calledCell)
      calledCells.add(normalizeName(resolved.calledCell));
    if (resolved.target.kind === "subcircuit") {
      const targetDefinition = definitions.get(
        normalizeName(resolved.target.cellName),
      )!;
      if (targetDefinition.ports.length !== statement.nodes.length) {
        diagnostics.push(
          diagnostic(
            "SPICE_BIND_TERMINAL_COUNT",
            "error",
            "bind",
            `${statement.name} has ${statement.nodes.length} terminals; ${targetDefinition.name} requires ${targetDefinition.ports.length}`,
            statement.sourceRef,
          ),
        );
      }
    }
    instances.push({
      id:
        occurrence === 1
          ? statement.name
          : deriveStableId(
              "instance",
              definition.name,
              statement.name,
              String(occurrence),
            ),
      name: statement.name,
      target: resolved.target,
      terminals: statement.nodes.map((name, position) => ({
        position,
        name: resolved.pinNames[position] ?? `P${position + 1}`,
        netId: netFor(name).id,
      })),
      parameters: parameterRecord(
        statement.parameters,
        statement.controlSource,
      ),
      sourceRef: statement.sourceRef,
    });
  }
  return {
    id: deriveStableId("cell", normalizeName(definition.name)),
    name: definition.name,
    ports,
    nets: [...netByName.values()],
    instances,
    parameters: definition.parameters.map(declaration),
    sourceRef: definition.sourceRef,
  };
}

export function compileSourceBundle(
  bundle: SourceBundle,
  options: SpiceCompileOptions = {},
): SpiceCompileResult {
  const diagnostics = [...bundle.diagnostics];
  const dialect = detectSpiceDialect(bundle, options.dialect);
  if (!bundle.entryFileId) {
    return {
      bundle,
      ir: null,
      diagnostics,
      dialectEvidence: dialect,
      successful: false,
    };
  }
  const collected = collectDefinitions(bundle, diagnostics);
  const definitions = new Map<string, CellDefinition>();
  for (const definition of collected.definitions) {
    const key = normalizeName(definition.name);
    const previous = definitions.get(key);
    if (previous) {
      diagnostics.push(
        diagnostic(
          "SPICE_BIND_DUPLICATE_SUBCKT",
          "error",
          "bind",
          `Duplicate subcircuit definition: ${definition.name}`,
          definition.sourceRef,
          [{ message: "First definition", sourceRef: previous.sourceRef }],
        ),
      );
      continue;
    }
    definitions.set(key, definition);
  }
  const calledCells = new Set<string>();
  const cells = [...definitions.values()].map((definition) =>
    buildCell(
      definition,
      definitions,
      collected.globalNames,
      diagnostics,
      calledCells,
    ),
  );
  const topCells = cells
    .filter((cell) => !calledCells.has(normalizeName(cell.name)))
    .map((cell) => cell.name);
  if (cells.length > 0 && topCells.length === 0) {
    diagnostics.push(
      diagnostic(
        "SPICE_BIND_NO_ROOT",
        "error",
        "bind",
        "No non-recursive top-cell candidate exists",
      ),
    );
  }
  const candidate = CircuitIRSchema.safeParse({
    dialect: dialect.dialect,
    topCells,
    cells,
    parameters: collected.parameters,
    models: collected.models,
    preservedStatements: collected.preserved,
    unresolvedStatements: collected.opaque,
  });
  if (!candidate.success) {
    diagnostics.push(
      diagnostic(
        "SPICE_BIND_INVALID_IR",
        "error",
        "bind",
        candidate.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; "),
      ),
    );
    return {
      bundle,
      ir: null,
      diagnostics,
      dialectEvidence: dialect,
      successful: false,
    };
  }
  return {
    bundle,
    ir: candidate.data,
    diagnostics,
    dialectEvidence: dialect,
    successful: !diagnostics.some((item) => item.severity === "error"),
  };
}

export async function compileSpiceSources(
  inputs: readonly SpiceSourceInput[],
  entryPath: string,
  options: SpiceCompileOptions = {},
): Promise<SpiceCompileResult> {
  return compileSourceBundle(
    await createSourceBundle(inputs, entryPath, options.includeRoot),
    options,
  );
}
