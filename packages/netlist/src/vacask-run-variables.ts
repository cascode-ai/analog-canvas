import type { SimulationRunVariant, SimulationSourceInput } from "@icm/model";
import {
  inspectVacaskSource,
  type VacaskSourceStatement,
} from "./vacask-source.js";
import type {
  SourceFileGraph,
  SimulationSourceDiagnostic,
} from "./source-file-graph.js";
import {
  mapSimulationFile,
  replaceSimulationText,
} from "./simulation-source-map.js";

function assignments(statement: VacaskSourceStatement) {
  const tokens = statement.tokens;
  const starts: number[] = [];
  let depth = 0;
  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (!depth && token.kind === "word" && tokens[i + 1]?.value === "=")
      starts.push(i);
    if (token.kind === "symbol" && ["(", "[", "{"].includes(token.value))
      depth++;
    if (token.kind === "symbol" && [")", "]", "}"].includes(token.value))
      depth--;
  }
  return starts.map((index, i) => ({
    name: tokens[index]!.value,
    start: tokens[index + 2]?.start ?? tokens[index + 1]!.end,
    end: tokens[(starts[i + 1] ?? tokens.length) - 1]!.end,
  }));
}

const bare = (statement: VacaskSourceStatement, name: string) => {
  const first = statement.tokens[0];
  return (
    first?.kind === "word" &&
    first.value === name &&
    statement.rawText.slice(0, first.end - first.start) === name
  );
};

/** Run-only edits to one reachable root declaration per case-sensitive name.
 * No expression evaluation, persistent variable table or implicit Canvas edits. */
export function projectVacaskRunVariables(
  input: SimulationSourceInput,
  graph: SourceFileGraph<VacaskSourceStatement>,
  points: NonNullable<SimulationRunVariant["variables"]>,
) {
  const files = input.files
    .filter((file) => file.path !== input.configPath)
    .map((file) => mapSimulationFile(file.path, file.text));
  const diagnostics: SimulationSourceDiagnostic[] = [];
  if (!points.length) return { files, diagnostics };
  type Declaration = {
    path: string;
    statement: VacaskSourceStatement;
    conditional: boolean;
    name: string;
    start: number;
    end: number;
  };
  const declarations = new Map<string, Declaration[]>();
  let local = 0,
    conditional = 0,
    control = false;
  for (const { path, statement } of graph.statements) {
    if (bare(statement, "control")) {
      control = true;
      continue;
    }
    if (bare(statement, "endc")) {
      control = false;
      continue;
    }
    if (control) continue;
    if (bare(statement, "subckt")) {
      local++;
      continue;
    }
    if (bare(statement, "ends")) {
      local--;
      continue;
    }
    if (bare(statement, "@if")) {
      conditional++;
      continue;
    }
    if (bare(statement, "@end")) {
      conditional--;
      continue;
    }
    if (local || !bare(statement, "parameters")) continue;
    for (const value of assignments(statement))
      declarations.set(value.name, [
        ...(declarations.get(value.name) ?? []),
        { path, statement, conditional: conditional !== 0, ...value },
      ]);
  }
  const issue = (code: string, message: string, declaration?: Declaration) =>
    diagnostics.push({
      code,
      message,
      severity: "error",
      ...(declaration
        ? { path: declaration.path, sourceRef: declaration.statement.sourceRef }
        : {}),
    });
  const seen = new Set<string>();
  const changes: (Declaration & { value: string })[] = [];
  for (const point of points) {
    const name = point.variableId;
    if (seen.has(name)) {
      issue(
        "SIMULATION_VARIABLE_DUPLICATE",
        `More than one point supplied for ${name}`,
      );
      continue;
    }
    seen.add(name);
    const found = declarations.get(name) ?? [];
    const declaration = found[0];
    if (
      !declaration ||
      found.length !== 1 ||
      declaration.conditional ||
      declaration.start >= declaration.end
    ) {
      issue(
        "SIMULATION_VARIABLE_DECLARATION",
        `Variable ${name} requires one reachable unconditional root parameters declaration; names are case-sensitive`,
        declaration,
      );
      continue;
    }
    // A managed point replaces one expression, not an additional declaration or
    // control program. Unknown native functions remain simulator-owned.
    const parsed = inspectVacaskSource(
      "point",
      `parameters point=${point.value}`,
    );
    const statement = parsed.statements[0];
    const values = statement ? assignments(statement) : [];
    if (
      /[\r\n;]/u.test(point.value) ||
      parsed.comments.length ||
      parsed.diagnostics.length ||
      parsed.statements.length !== 1 ||
      values.length !== 1 ||
      values[0]!.start >= values[0]!.end
    ) {
      issue(
        "SIMULATION_VARIABLE_POINT",
        `Use one native parameter expression for ${name}`,
        declaration,
      );
      continue;
    }
    changes.push({ ...declaration, value: point.value });
  }
  if (!diagnostics.length)
    for (const change of changes.sort((a, b) => b.start - a.start)) {
      const index = files.findIndex((file) => file.path === change.path);
      files[index] = replaceSimulationText(
        files[index]!,
        change.start,
        change.end,
        change.value,
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
  return { files, diagnostics };
}
