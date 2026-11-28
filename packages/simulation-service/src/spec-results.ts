import { inspectSimulationSourceGraph } from "@icm/netlist";
import { parseSpiceSource } from "@icm/spice";
import { flattenRichText } from "@icm/model";
import type { SimulationOutputData } from "./contract.js";
import type { ExecutionOutput } from "./executor.js";
import { ngspiceMeasurementResults } from "./ngspice-measurements.js";
import {
  formatSimulationSpec,
  type SimulationSpecCondition,
  type SimulationSpecReport,
  type SimulationSpecResult,
} from "./spec-contract.js";
import {
  parseSimulationSpecAnnotation,
  type SimulationSpecAnnotation,
} from "./spec-annotation.js";

type Source = SimulationSpecResult["source"];
type Declaration = SimulationSpecAnnotation & { source: Source };

/** One annotation line, read by the parser the editor's check uses too. */
function declaration(source: Source): Declaration {
  return { ...parseSimulationSpecAnnotation(source.text), source };
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
): SimulationSpecReport {
  const input = {
    kind: "source",
    entry,
    configPath: "experiment.json",
    files: [...files],
    circuitBindings: [],
    dependencies: [],
  } satisfies import("@icm/model").SimulationSourceInput;
  const graph = inspectSimulationSourceGraph(input);
  const definitions: Declaration[] = [];
  for (const path of new Set(graph.paths)) {
    const file = files.find((f) => f.path === path);
    if (!file) continue;
    const visits = graph.includes.filter((edge) => edge.target === path);
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
  for (const { path, statement } of graph.statements) {
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
  const nameKey = (name: string) => name.toLowerCase();
  const defined = new Set(definitions.map((d) => nameKey(d.name)));
  for (const [name, sources] of measurementSources)
    if (!defined.has(name))
      definitions.push({
        name,
        source: sources[0]!,
        unit: "",
        expected: null,
        problems: [],
      });
  const results = definitions.flatMap((d): SimulationSpecResult[] => {
    const key = nameKey(d.name);
    const found = measurements.filter((m) => nameKey(m.name) === key);
    return (found.length ? found : [null]).map((m) => {
      const value = m?.status === "available" ? m.value : null;
      const source = d.source;
      const base = {
        id: `${source.path}:${source.line}:${m?.occurrence ?? 0}`,
        name: d.name || "Invalid spec",
        ...(d.label ? { label: d.label } : {}),
        ...(d.group ? { group: d.group } : {}),
        source,
        unit: d.unit,
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
      if (d.problems.length)
        return unavailable("invalid-spec", d.problems.join(" "));
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
          m?.detail ?? "No matching measurement was reported.",
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

/**
 * One execution's Spec report: the measurements its simulator printed,
 * judged against the Specs its captured input states. The Simulation
 * panel's run and the Gallery's simulation check (#1545) both read a run's
 * Specs through this function.
 */
export function executionSpecReport(
  input: {
    files: readonly { path: string; text: string }[];
    entryPath?: string | undefined;
  },
  output: Pick<ExecutionOutput, "result" | "cancelled">,
  identity: Pick<SimulationSpecReport, "runId" | "preparedId" | "inputDigest">,
): {
  specs: SimulationSpecReport;
  diagnostics: SimulationOutputData["diagnostics"];
} {
  const { result } = output;
  const entry = input.entryPath ?? "run.cir";
  const measurements = ngspiceMeasurementResults(
    input.files,
    entry,
    result.log,
  );
  return {
    specs: simulationSpecReport(
      input.files,
      entry,
      measurements,
      identity,
      result.outcome.status === "completed" && !output.cancelled,
    ),
    diagnostics: [],
  };
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
        "detail",
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
        // Appended, so no earlier column moves. A measurement-missing
        // detail can be the author's own text.
        csvText(r.detail),
      ]),
    ]
      .map((row) => row.map(cell).join(","))
      .join("\n") + "\n"
  );
}

function csvText(text: string): string {
  return /^[\s]*[=+@-]/u.test(text) ? `'${text}` : text;
}
