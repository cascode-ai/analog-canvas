import type { SimulationSourceInput } from "@icm/model";
import { isSimulationInputPath } from "@icm/model";
import {
  inspectVacaskSourceGraph,
  vacaskNumber as number,
  type VacaskSourceStatement,
  type VacaskSourceToken,
} from "@icm/netlist";
import type { VacaskPlotProjection } from "@icm/spice-run";
import type { ResultVolumeAnalysis } from "./result-volume.js";

const bare = (s: VacaskSourceStatement, name: string) => {
  const t = s.tokens[0];
  return (
    t?.kind === "word" &&
    t.value === name &&
    s.rawText.slice(0, t.end - t.start) === name
  );
};

function literals(tokens: VacaskSourceToken[]) {
  const result = new Map<string, string | undefined>();
  let depth = 0;
  const starts: number[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (depth === 0 && t.kind === "word" && tokens[i + 1]?.value === "=")
      starts.push(i);
    if (["(", "[", "{"].includes(t.value) && t.kind === "symbol") depth++;
    if ([")", "]", "}"].includes(t.value) && t.kind === "symbol") depth--;
  }
  for (const [index, start] of starts.entries()) {
    const value = tokens.slice(start + 2, starts[index + 1] ?? tokens.length);
    const key = tokens[start]!.value;
    const literal =
      value.length === 1 && value[0]!.kind !== "symbol"
        ? value[0]!.value
        : value.length === 2 &&
            ["-", "+"].includes(value[0]!.value) &&
            value[1]!.kind === "word"
          ? value.map((v) => v.value).join("")
          : undefined;
    result.set(key, result.has(key) ? undefined : literal);
  }
  return result;
}

/** Transient source-derived collection meaning, shared by Prepare and result reading.
 * Unsupported/dynamic programs remain executable; their original artifacts remain evidence. */
export function inspectNativeAnalyses(input: SimulationSourceInput) {
  const graph = inspectVacaskSourceGraph(input);
  const projections: VacaskPlotProjection[] = [];
  const analyses: ResultVolumeAnalysis[] = [];
  const warnings: string[] = [];
  const models = new Map<string, "voltage" | "current" | null>();
  const sources = new Map<string, "voltage" | "current" | null>();
  let depth = 0;
  let control = false;
  for (const { statement: s } of graph.statements) {
    if (bare(s, "control")) {
      control = true;
      continue;
    }
    if (bare(s, "endc")) {
      control = false;
      continue;
    }
    if (control) continue;
    if (bare(s, "subckt")) {
      depth++;
      continue;
    }
    if (bare(s, "ends")) {
      depth--;
      continue;
    }
    if (depth || !bare(s, "model")) continue;
    const name = s.tokens[1]?.value,
      target = s.tokens[2]?.value;
    if (name)
      models.set(
        name,
        models.has(name)
          ? null
          : target === "vsource"
            ? "voltage"
            : target === "isource"
              ? "current"
              : null,
      );
  }
  depth = 0;
  control = false;
  for (const { statement: s } of graph.statements) {
    if (bare(s, "control")) {
      control = true;
      continue;
    }
    if (bare(s, "endc")) {
      control = false;
      continue;
    }
    if (control) continue;
    if (bare(s, "subckt")) {
      depth++;
      continue;
    }
    if (bare(s, "ends")) {
      depth--;
      continue;
    }
    if (depth || s.tokens[1]?.value !== "(") continue;
    const close = s.tokens.findIndex(
      (t) => t.kind === "symbol" && t.value === ")",
    );
    const name = s.tokens[0]!.value;
    const target = s.tokens[close + 1]?.value;
    sources.set(
      name,
      sources.has(name) ? null : (models.get(target ?? "") ?? null),
    );
  }
  control = false;
  let dynamicDepth = 0;
  let sweeps: { name: string; params: Map<string, string | undefined> }[] = [];
  const named = new Set<string>();
  const ambiguous = new Set<string>();
  for (const { statement: s, path } of graph.statements) {
    if (bare(s, "control")) {
      control = true;
      continue;
    }
    if (bare(s, "endc")) {
      control = false;
      continue;
    }
    if (!control) continue;
    if (bare(s, "mc")) {
      dynamicDepth++;
      continue;
    }
    if (bare(s, "endmc")) {
      dynamicDepth = Math.max(0, dynamicDepth - 1);
      continue;
    }
    if (bare(s, "sweep") && s.tokens[1]) {
      sweeps.push({
        name: s.tokens[1].value,
        params: literals(s.tokens.slice(2)),
      });
      continue;
    }
    if (!bare(s, "analysis")) {
      sweeps = [];
      continue;
    }
    const sweep = sweeps;
    sweeps = [];
    const name = s.tokens[1]?.value;
    const kind = s.tokens[2]?.value;
    if (!name || !kind) continue; // simulator owns syntax diagnosis
    const artifactPath = `${name}.raw`;
    if (named.has(artifactPath)) ambiguous.add(artifactPath);
    named.add(artifactPath);
    const params = literals(s.tokens.slice(3));
    const warn = (reason: string) =>
      warnings.push(
        `${path}:${s.sourceRef.start.line}: ${name}: ${reason}; native execution and raw export remain available.`,
      );
    if (dynamicDepth || sweep.length > 1 || (sweep.length && kind !== "op")) {
      warn(
        "dynamic or multidimensional result mapping requires runtime sweep evidence",
      );
      continue;
    }
    if (!isSimulationInputPath(artifactPath)) {
      warn("output name is outside run-local collection paths");
      continue;
    }
    if (params.has("write") && number(params.get("write")) === 0) continue;
    if (params.has("write") && number(params.get("write")) === undefined) {
      warn("write policy is not a literal");
      continue;
    }
    const common = { artifactPath, plotOrdinal: 0 };
    if (kind === "op" && !sweep.length) {
      projections.push({ ...common, analysis: "op" });
      analyses.push({ kind: "op" });
    } else if (kind === "op" && sweep.length === 1) {
      const axis = sweep[0]!;
      const source = sources.get(axis.params.get("instance") ?? "");
      const quantity =
        axis.params.get("parameter") === "dc" || !axis.params.has("parameter")
          ? source
          : null;
      projections.push({
        ...common,
        analysis: "dc",
        axis: {
          name: axis.name,
          quantity: quantity ?? "unknown",
          unit:
            quantity === "voltage" ? "V" : quantity === "current" ? "A" : null,
        },
      });
      const from = number(axis.params.get("from")),
        to = number(axis.params.get("to")),
        step = number(axis.params.get("step"));
      if (from !== undefined && to !== undefined && step)
        analyses.push({
          kind: "dc",
          startValue: from,
          stopValue: to,
          stepValue: Math.abs(step),
        });
    } else if (kind === "ac" || kind === "tran")
      projections.push({
        ...common,
        analysis: kind,
        axis: kind === "ac" ? "frequency" : "time",
      });
    else if (kind === "noise") {
      const quantity = sources.get(params.get("in") ?? "");
      if (quantity)
        projections.push({
          ...common,
          analysis: "noise",
          axis: "frequency",
          outputPsd: "onoise",
          powerGain: "gain",
          inputQuantity: quantity,
        });
      else warn("noise input source quantity has not been established");
    } else {
      warn(`analysis ${kind} has no numeric adapter yet`);
      continue;
    }
    if (number(params.get("writeop")) === 1 && kind !== "op")
      projections.push({
        artifactPath: `${name}.op.raw`,
        plotOrdinal: 0,
        analysis: "op",
      });
    if (kind === "ac" || kind === "noise") {
      const mode = params.get("mode"),
        points = number(params.get("points")),
        from = number(params.get("from")),
        to = number(params.get("to"));
      if (
        (mode === "lin" || mode === "dec" || mode === "oct") &&
        points &&
        from !== undefined &&
        from > 0 &&
        to !== undefined &&
        to >= from
      )
        analyses.push({
          kind,
          sweep: mode,
          points: mode === "lin" ? points + 1 : points,
          startHz: from,
          stopHz: to,
        });
    }
    if (kind === "tran") {
      const step = number(params.get("step")),
        stop = number(params.get("stop"));
      if (step && step > 0 && stop && stop > 0)
        analyses.push({ kind: "tran", stepSeconds: step, stopSeconds: stop });
    }
  }
  for (const path of ambiguous)
    warnings.push(
      `Repeated analysis output ${path} has ambiguous source identity; raw export remains available.`,
    );
  return {
    projections: projections.filter(
      (p) =>
        !ambiguous.has(p.artifactPath) &&
        !ambiguous.has(p.artifactPath.replace(/\.op\.raw$/u, ".raw")),
    ),
    analyses,
    warnings,
  };
}
