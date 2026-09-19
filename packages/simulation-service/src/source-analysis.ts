import { parseSpiceNumber } from "@icm/spice";
import type { SimulationSourceGraph } from "@icm/netlist";
import type { ResultVolumeAnalysis } from "./result-volume.js";
import { estimateSimulationOutputBytes } from "./result-volume.js";

/** Estimate captured plots, never multiply every device OP vector by TRAN length.
 * Dynamic programs stay executable; an unknown count is not a guessed number. */
export function sourceOutputVolumeWarning(
  graph: SimulationSourceGraph,
  limit: number | undefined,
): string | null {
  if (limit === undefined) return null;
  let analysis: ResultVolumeAnalysis | undefined;
  let saved: string[] | undefined;
  let savesUnknown = false;
  let unknown = false;
  let writes = 0;
  let bytes = 0;
  for (const entry of graph.statements) {
    const s = entry.statement;
    if (s.kind !== "directive" && s.kind !== "control_command") continue;
    const name = (s.kind === "directive" ? s.name : s.command)
      .replace(/^\./, "")
      .toLowerCase();
    const args = s.arguments;
    if (
      [
        "foreach",
        "while",
        "dowhile",
        "repeat",
        "setplot",
        "source",
        "run",
        "reset",
        "resume",
      ].includes(name)
    )
      unknown = true;
    if (["op", "dc", "ac", "tran", "noise"].includes(name)) {
      analysis = literalSourceAnalyses({ ...graph, statements: [entry] })[0];
      if (name === "dc" && args.length > 4) analysis = undefined;
    }
    if (name === "save") {
      const explicit =
        args.length > 0 &&
        args.every((a) => !/[\s$*?]/.test(a) && a.toLowerCase() !== "all");
      savesUnknown ||= !explicit;
      saved =
        explicit && !savesUnknown
          ? [...new Set([...(saved ?? []), ...args])]
          : undefined;
    }
    if (name !== "write") continue;
    writes++;
    const selection = args.slice(1);
    const probes =
      selection.length === 0 ||
      (selection.length === 1 && selection[0]!.toLowerCase() === "all")
        ? saved
        : selection;
    if (
      !analysis ||
      !probes?.length ||
      probes.some((p) => /[\s$*?]/.test(p) || p.toLowerCase() === "all") ||
      args.some((a) => a.includes("$"))
    ) {
      unknown = true;
      continue;
    }
    bytes += estimateSimulationOutputBytes([analysis], new Set(probes).size);
  }
  if (!writes) return null;
  if (unknown)
    return "Raw output size cannot be reliably estimated from this native capture program; no numerical size estimate is asserted and the run remains allowed. Read result diagnostics and artifact availability after execution.";
  if (bytes <= limit) return null;
  return `Estimated ASCII raw capture is about ${bytes} bytes across ${writes} write commands, above this executor's ${limit}-byte output limit. This is advisory (TRAN uses a conservative adaptive-step allowance); the run remains allowed. A shortened result preview is not file loss; actual missing or truncated artifacts are reported by result diagnostics.`;
}

/** Advisory only. Symbolic arguments/loops remain native ngspice programs, never admission failures. */
export function literalSourceAnalyses(
  graph: SimulationSourceGraph,
): ResultVolumeAnalysis[] {
  const found: ResultVolumeAnalysis[] = [];
  for (const { statement } of graph.statements) {
    if (statement.kind !== "directive" && statement.kind !== "control_command")
      continue;
    const name = (
      statement.kind === "directive" ? statement.name : statement.command
    )
      .replace(/^\./u, "")
      .toLowerCase();
    const args = statement.arguments;
    const number = (index: number) =>
      parseSpiceNumber(args[index] ?? "")?.value;
    if (name === "op") found.push({ kind: "op" });
    else if (name === "tran") {
      const step = number(0),
        stop = number(1),
        start = number(2);
      if (step !== undefined && step > 0 && stop !== undefined && stop > 0)
        found.push({
          kind: "tran",
          stepSeconds: step,
          stopSeconds: stop,
          ...(start === undefined ? {} : { startSeconds: start }),
        });
    } else if (name === "ac" || name === "noise") {
      const offset = name === "noise" ? 2 : 0,
        sweep = args[offset]?.toLowerCase(),
        points = number(offset + 1),
        start = number(offset + 2),
        stop = number(offset + 3);
      if (
        (sweep === "dec" || sweep === "oct" || sweep === "lin") &&
        points !== undefined &&
        points > 0 &&
        start !== undefined &&
        start > 0 &&
        stop !== undefined &&
        stop >= start
      )
        found.push({ kind: name, sweep, points, startHz: start, stopHz: stop });
    } else if (name === "dc") {
      const start = number(1),
        stop = number(2),
        step = number(3);
      if (
        start !== undefined &&
        stop !== undefined &&
        step !== undefined &&
        step !== 0
      )
        found.push({
          kind: "dc",
          startValue: start,
          stopValue: stop,
          stepValue: Math.abs(step),
        });
    }
  }
  return found;
}
