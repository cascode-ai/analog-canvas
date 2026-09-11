import { parseSpiceNumber } from "@icm/spice";
import type { SimulationSourceGraph } from "@icm/netlist";
import type { ResultVolumeAnalysis } from "./result-volume.js";

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
