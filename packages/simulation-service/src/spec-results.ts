import {
  inspectSimulationSourceGraph,
  inspectVacaskSourceGraph,
} from "@icm/netlist";
import { parseSpiceSource } from "@icm/spice";
import { flattenRichText } from "@icm/model";
import type { SimulationOutputData } from "./contract.js";
import {
  formatSimulationSpec,
  SimulationSpecLabelSchema,
  SimulationSpecResultSchema,
  type SimulationSpecCondition,
  type SimulationSpecReport,
  type SimulationSpecResult,
} from "./spec-contract.js";

const number = (text: string | undefined): number | null =>
  text &&
  /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text) &&
  Number.isFinite(Number(text))
    ? Number(text)
    : null;
type Source = SimulationSpecResult["source"];
type Declaration = {
  name: string;
  source: Source;
  unit: string;
  expected: SimulationSpecCondition | null;
  invalid: boolean;
  label?: SimulationSpecResult["label"];
  group?: string;
};

/** v1 deliberately has no executable expressions or inferred unit conversions. */
function declaration(source: Source): Declaration {
  // One optional JSON label at the end; reuse the canonical RichText contract,
  // never interpret authored HTML or introduce another markup dialect.
  const labelStart = [
    ...source.text.matchAll(/"(?:\\.|[^"\\])*"|\s+label=/gu),
  ].find((match) => /^\s+label=$/u.test(match[0]));
  let label: SimulationSpecResult["label"];
  let invalidLabel = false;
  if (labelStart) {
    try {
      const value: unknown = JSON.parse(
        source.text.slice(labelStart.index + labelStart[0].length),
      );
      const parsed = SimulationSpecLabelSchema.safeParse(
        typeof value === "string" ? { runs: [{ kind: "text", value }] } : value,
      );
      if (parsed.success) label = parsed.data;
      else invalidLabel = true;
    } catch {
      invalidLabel = true;
    }
  }
  let group: string | undefined;
  let invalidGroup = false;
  let groupCount = 0;
  const metadataText = (
    labelStart ? source.text.slice(0, labelStart.index) : source.text
  ).replace(/\s+group=("(?:\\.|[^"\\])*"|[^\s]+)/gu, (_match, text: string) => {
    groupCount++;
    try {
      const parsed = SimulationSpecResultSchema.shape.group.safeParse(
        text.startsWith('"') ? JSON.parse(text) : text,
      );
      if (parsed.success) group = parsed.data;
      else invalidGroup = true;
    } catch {
      invalidGroup = true;
    }
    return "";
  });
  const tokens = metadataText
    .trim()
    .replace(/^(?:\*|\/\/)\s*@spec\b/i, "")
    .trim()
    .split(/\s+/);
  const name = tokens.shift() ?? "";
  let unit = "";
  if (tokens.at(-1)?.startsWith("unit=")) unit = tokens.pop()!.slice(5);
  const [op, a, b, c] = tokens;
  const first = number(a),
    second = number(b),
    tolerance = number(c);
  let expected: SimulationSpecCondition | null = null;
  if (
    tokens.length === 2 &&
    ["<", "<=", ">", ">="].includes(op ?? "") &&
    first !== null
  )
    expected = {
      kind: "limit",
      operator: op as "<" | "<=" | ">" | ">=",
      value: first,
    };
  if (
    tokens.length === 3 &&
    op === "range" &&
    first !== null &&
    second !== null &&
    first <= second
  )
    expected = { kind: "range", minimum: first, maximum: second };
  if (
    tokens.length === 4 &&
    op === "target" &&
    first !== null &&
    b === "tol" &&
    tolerance !== null &&
    tolerance >= 0
  )
    expected = { kind: "target", value: first, tolerance };
  return {
    name,
    source,
    unit,
    expected,
    ...(label ? { label } : {}),
    ...(group ? { group } : {}),
    invalid:
      invalidLabel ||
      invalidGroup ||
      groupCount > 1 ||
      (!expected && !(tokens.length === 0 && (unit || label || group))) ||
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ||
      !/^[A-Za-z0-9_/%°µΩ.-]*$/.test(unit),
  };
}
function satisfies(value: number, rule: SimulationSpecCondition): boolean {
  if (rule.kind === "range")
    return value >= rule.minimum && value <= rule.maximum;
  if (rule.kind === "target")
    return (
      value >= rule.value - rule.tolerance &&
      value <= rule.value + rule.tolerance
    );
  switch (rule.operator) {
    case "<":
      return value < rule.value;
    case "<=":
      return value <= rule.value;
    case ">":
      return value > rule.value;
    case ">=":
      return value >= rule.value;
  }
}

/** Evaluate against captured input, never against the live Project. Repeated reports
 * retain occurrence and log evidence; there is no guessed raw-record association. */
export function simulationSpecReport(
  files: readonly { path: string; text: string }[],
  entry: string,
  measurements: NonNullable<SimulationOutputData["nativeMeasurements"]>,
  identity: Pick<SimulationSpecReport, "runId" | "preparedId" | "inputDigest">,
  completed: boolean,
  context: { engine: "ngspice" | "vacask"; log: string } = {
    engine: "ngspice",
    log: "",
  },
): SimulationSpecReport {
  const { engine } = context;
  const input = {
    kind: "source",
    entry,
    configPath: "experiment.json",
    files: [...files],
    circuitBindings: [],
    dependencies: [],
  } satisfies import("@icm/model").SimulationSourceInput;
  const graph =
    engine === "ngspice" ? inspectSimulationSourceGraph(input) : null;
  const definitions: Declaration[] = [];
  if (engine === "vacask") {
    const native = inspectVacaskSourceGraph(input, { includeComments: true });
    const lines = new Map(files.map((f) => [f.path, f.text.split(/\r?\n/)]));
    const seen = new Set<string>();
    for (const { path, statement } of native.statements) {
      if (
        statement.tokens.length ||
        !/^\/\/\s*@spec\b/i.test(statement.rawText)
      )
        continue;
      const line = statement.sourceRef.start.line;
      const text = lines.get(path)![line - 1]!;
      if (!/^\s*\/\/\s*@spec\b/i.test(text)) continue;
      const key = JSON.stringify([path, line]);
      if (seen.has(key)) continue;
      seen.add(key);
      definitions.push(declaration({ path, line, text }));
    }
  } else
    for (const path of new Set(graph!.paths)) {
      const file = files.find((f) => f.path === path);
      if (!file) continue;
      const visits = graph!.includes.filter((edge) => edge.target === path);
      const plain =
        path === entry || visits.some((edge) => edge.section === undefined);
      const selected = new Set(
        visits.flatMap((edge) =>
          edge.section ? [edge.section.toLowerCase()] : [],
        ),
      );
      const parsed = parseSpiceSource(
        { ...file, id: path, hash: "", encoding: "utf-8" },
        { titleLine: path === entry },
      );
      const boundaries = new Map(
        parsed.statements
          .filter((s) => s.kind === "library" && s.mode !== "include")
          .map((s) => [s.sourceRef.start.line, s]),
      );
      const sections: string[] = [];
      file.text.split(/\r?\n/).forEach((text, index) => {
        const line = index + 1;
        const boundary = boundaries.get(line);
        if (boundary?.kind === "library" && boundary.mode === "section-start")
          sections.push(boundary.section.toLowerCase());
        if (boundary?.kind === "library" && boundary.mode === "section-end")
          sections.pop();
        if (
          (sections.length
            ? !sections.some((section) => selected.has(section))
            : !plain) ||
          !/^\s*\*\s*@spec\b/i.test(text)
        )
          return;
        definitions.push(declaration({ path, line, text }));
      });
    }
  const measurementSources = new Map<string, Source[]>();
  for (const { path, statement } of graph?.statements ?? []) {
    const command =
      statement.kind === "control_command"
        ? statement.command
        : statement.kind === "directive"
          ? statement.name
          : "";
    if (
      !["meas", "measure"].includes(command.toLowerCase()) ||
      !("arguments" in statement)
    )
      continue;
    const name = statement.arguments[1];
    if (!name) continue;
    const sources = measurementSources.get(name.toLowerCase()) ?? [];
    const source = {
      path,
      line: statement.sourceRef.start.line,
      text: statement.rawText,
    };
    if (!sources.some((s) => s.path === path && s.line === source.line))
      sources.push(source);
    measurementSources.set(name.toLowerCase(), sources);
  }
  const nameKey = (name: string) =>
    engine === "vacask" ? name : name.toLowerCase();
  const defined = new Set(definitions.map((d) => nameKey(d.name)));
  for (const [name, sources] of measurementSources)
    if (!defined.has(name))
      definitions.push({
        name,
        source: sources[0]!,
        unit: "",
        expected: null,
        invalid: false,
      });
  const logLines = context.log.split(/\r?\n/);
  const logSource = (m: (typeof measurements)[number]): Source => ({
    kind: "log",
    path: "log.txt",
    line: m.logLine!,
    text: logLines[m.logLine! - 1] ?? m.detail,
  });
  if (engine === "vacask") {
    for (const m of measurements) {
      const key = nameKey(m.name);
      if (defined.has(key) || m.logLine === undefined) continue;
      defined.add(key);
      definitions.push({
        name: m.name,
        source: logSource(m),
        unit: m.unit ?? "",
        expected: null,
        invalid: false,
      });
    }
  }
  const results = definitions.flatMap((d): SimulationSpecResult[] => {
    const key = nameKey(d.name);
    const found = measurements.filter((m) => nameKey(m.name) === key);
    return (found.length ? found : [null]).map((m) => {
      const value = m?.status === "available" ? m.value : null;
      const source =
        d.source.kind === "log" && m?.logLine !== undefined
          ? logSource(m)
          : d.source;
      const base = {
        id: `${source.kind === "log" ? "log:" : ""}${source.path}:${source.line}:${m?.occurrence ?? 0}`,
        name: d.name || "Invalid spec",
        ...(d.label ? { label: d.label } : {}),
        ...(d.group ? { group: d.group } : {}),
        source,
        unit: d.source.kind === "log" ? (m?.unit ?? "") : d.unit,
        expected: d.expected,
        value,
        occurrence: m?.occurrence ?? 0,
        logLine: m?.logLine ?? null,
      };
      const unavailable = (
        reason: SimulationSpecResult["reason"],
        detail: string,
      ): SimulationSpecResult => ({
        ...base,
        judgment: "not-evaluated",
        reason,
        detail,
      });
      if (d.invalid)
        return unavailable(
          "invalid-spec",
          "Use name [condition] [unit=unit] [group=name or JSON string] [label=JSON string or RichText document]. A measurement-only annotation needs a unit, group or label. Conditions use decimal/scientific numbers.",
        );
      if (definitions.filter((other) => nameKey(other.name) === key).length > 1)
        return unavailable(
          "duplicate-spec",
          "Multiple specifications refer to the same measurement name. Use unique measurement names.",
        );
      if ((measurementSources.get(key)?.length ?? 0) > 1)
        return unavailable(
          "ambiguous-measurement",
          "Multiple measurement declarations share this name. Their reports cannot be uniquely attributed.",
        );
      if (!completed)
        return unavailable(
          "run-incomplete",
          "This execution did not complete successfully; partial measurements are not certified.",
        );
      if (value === null)
        return unavailable(
          "measurement-missing",
          m?.detail ?? "No matching native measurement was reported.",
        );
      if (!d.expected)
        return {
          ...base,
          judgment: "unconstrained",
          reason: "no-spec",
          detail: "Measured value only; no expected condition was authored.",
        };
      const pass = satisfies(value, d.expected);
      return {
        ...base,
        judgment: pass ? "pass" : "failed",
        reason: pass ? "satisfied" : "outside-spec",
        detail: pass
          ? "Meets the authored specification."
          : "Outside the authored specification.",
      };
    });
  });
  return { schemaVersion: 1, ...identity, results };
}

export function simulationSpecsToCsv(report: SimulationSpecReport): string {
  const cell = (value: unknown) =>
    `"${String(value ?? "").replaceAll('"', '""')}"`;
  return (
    [
      [
        "spec",
        "sim result",
        "expected",
        "judgment",
        "unit",
        "occurrence",
        "reason",
        "source",
        "line",
        "run id",
        "prepared id",
        "input digest",
        "label",
        "group",
        "source kind",
      ],
      ...report.results.map((r) => [
        r.source.kind === "log" ? csvText(r.name) : r.name,
        r.value,
        formatSimulationSpec(r.expected),
        r.judgment,
        r.source.kind === "log" ? csvText(r.unit) : r.unit,
        r.occurrence,
        r.reason,
        r.source.path,
        r.source.line,
        report.runId,
        report.preparedId,
        report.inputDigest,
        r.label ? csvText(flattenRichText(r.label)) : "",
        r.group ? csvText(r.group) : "",
        r.source.kind ?? "input",
      ]),
    ]
      .map((row) => row.map(cell).join(","))
      .join("\n") + "\n"
  );
}

function csvText(text: string): string {
  return /^[\s]*[=+@-]/u.test(text) ? `'${text}` : text;
}
