import type { SimulationSourceInput } from "@icm/model";
import {
  inspectVacaskSourceGraph,
  type VacaskSourceStatement,
} from "./vacask-source.js";
import {
  isVacaskStatement as bare,
  vacaskAssignments,
} from "./vacask-statement.js";
import type { SimulationSourceDiagnostic } from "./source-file-graph.js";
import {
  insertSimulationText,
  locateSimulationText,
  type MappedSimulationFile,
} from "./simulation-source-map.js";

/** An ambient-temperature run point, not tnom or a device parameter override.
 * Set options immediately before each analysis/sweep group so native clears
 * and earlier options cannot silently restore a nominal ambient temperature. */
export function projectVacaskRunTemperature(
  input: SimulationSourceInput,
  mapped: MappedSimulationFile[],
  temperatureC: number | undefined,
) {
  const files = [...mapped];
  const diagnostics: SimulationSourceDiagnostic[] = [];
  if (temperatureC === undefined) return { files, diagnostics };
  type Item = { path: string; statement: VacaskSourceStatement };
  const nominalOffset = (item: Item) => {
    const file = mapped.find((f) => f.path === item.path)!;
    const origin = locateSimulationText(
      file,
      item.statement.sourceRef.start.offset,
    );
    return origin?.kind === "authored" ? origin.startOffset : undefined;
  };
  const issue = (code: string, message: string, item?: Item) => {
    const start = item ? nominalOffset(item) : undefined;
    const original = input.files.find((f) => f.path === item?.path);
    const position = (offset: number) => {
      const prefix = original!.text.slice(0, offset);
      return {
        offset,
        line: prefix.split("\n").length,
        column: offset - prefix.lastIndexOf("\n"),
      };
    };
    diagnostics.push({
      code,
      message,
      severity: "error",
      ...(item ? { path: item.path } : {}),
      ...(item && original && start !== undefined
        ? {
            sourceRef: {
              fileId: item.path,
              start: position(start),
              end: position(start + item.statement.rawText.length),
            },
          }
        : {}),
    });
  };
  if (!Number.isFinite(temperatureC) || temperatureC < -273.15) {
    issue(
      "SIMULATION_TEMPERATURE_RANGE",
      "Ambient temperature must be finite and at least -273.15 degrees Celsius",
    );
    return { files, diagnostics };
  }
  const graph = inspectVacaskSourceGraph({
    ...input,
    files: files.map(({ path, text }) => ({ path, text })),
  });
  let control = false;
  let sweeps: Item[] = [];
  const insertions = new Map<string, Item>();
  for (const item of graph.statements) {
    const s = item.statement;
    if (bare(s, "control")) {
      control = true;
      sweeps = [];
      continue;
    }
    if (bare(s, "endc")) {
      control = false;
      sweeps = [];
      continue;
    }
    if (!control) continue;
    if (bare(s, "include")) continue; // expanded virtual source, not a control command
    if (bare(s, "sweep")) {
      sweeps.push(item);
      continue;
    }
    if (
      bare(s, "analysis") &&
      s.tokens[1]?.kind === "word" &&
      s.tokens[2]?.kind === "word"
    ) {
      for (const sweep of sweeps) {
        for (const option of vacaskAssignments(sweep.statement).filter(
          (p) => p.name === "option",
        )) {
          const value = sweep.statement.tokens.filter(
            (t) => t.start >= option.start && t.end <= option.end,
          );
          if (
            value.length !== 1 ||
            value[0]!.kind !== "string" ||
            value[0]!.value === "temp"
          )
            issue(
              "SIMULATION_TEMPERATURE_SWEEP_CONFLICT",
              "A fixed temperature point cannot also sweep temp or a dynamic option name; edit the native sweep or omit the fixed point",
              sweep,
            );
        }
      }
      const anchor = sweeps[0] ?? item;
      insertions.set(
        JSON.stringify([anchor.path, anchor.statement.sourceRef.start.offset]),
        anchor,
      );
    }
    sweeps = [];
  }
  if (!insertions.size)
    issue(
      "SIMULATION_TEMPERATURE_ANALYSIS_UNAVAILABLE",
      "A fixed temperature point needs an authored analysis; dynamic programs remain runnable without this override",
    );
  if (!diagnostics.length) {
    for (const item of [...insertions.values()].sort(
      (a, b) =>
        b.statement.sourceRef.start.offset - a.statement.sourceRef.start.offset,
    )) {
      const index = files.findIndex((f) => f.path === item.path);
      const file = files[index]!;
      const offset = item.statement.sourceRef.start.offset;
      const indent = /^[ \t]*$/u.test(
        file.text.slice(file.text.lastIndexOf("\n", offset - 1) + 1, offset),
      )
        ? file.text.slice(file.text.lastIndexOf("\n", offset - 1) + 1, offset)
        : "";
      const eol = file.text.includes("\r\n") ? "\r\n" : "\n";
      const original = nominalOffset(item);
      files[index] = insertSimulationText(
        file,
        offset,
        `options temp=${temperatureC}${eol}${indent}`,
        {
          kind: "generated",
          purpose: "run-variant",
          ...(original === undefined
            ? {}
            : {
                nominal: {
                  path: item.path,
                  startOffset: original,
                  endOffset: original,
                },
              }),
        },
      );
    }
  }
  return { files, diagnostics };
}
