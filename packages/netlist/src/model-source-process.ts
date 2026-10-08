import type { ProjectModelSource } from "@icm/model";
import {
  LIBRARY_PROCESS,
  reviewedExternalBindingForMaster,
  reviewedExternalBindingById,
  projectLengthToSky130Micrometres,
  sky130MicrometresToProjectLength,
} from "@icm/devices";
import type { InstanceStatement } from "@icm/spice";
import { inspectProjectModelSource } from "./project-model-source.js";
import type { SimulationSourceDiagnostic } from "./source-file-graph.js";

export type ModelSourceProcess =
  "abstract" | "sky130" | "sg13g2" | "tsmc28" | "tsmc180" | "custom";
// Reviewed core MOS counterparts. Threshold/high-voltage variants are not
// equivalent to these defaults, even if their port lists happen to match.
const CORE_MOS = [
  ["sky130-nfet-01v8", "sg13g2-lv-nmos"],
  ["sky130-pfet-01v8", "sg13g2-lv-pmos"],
] as const;

/** Called with the canonical SPICE projection; never reads host model files. */
export function inspectSpiceModelProcess(
  source: ProjectModelSource,
): ModelSourceProcess {
  const inspected = inspectProjectModelSource(source);
  const processes = new Set<string>();
  const local = new Set(inspected.entries.map((e) => e.name.toLowerCase()));
  let unresolved =
    source.dependencies.length > 0 ||
    inspected.diagnostics.some((d) => d.severity === "error");
  for (const { statement: s } of inspected.graph.statements) {
    if (s.kind === "model" || s.kind === "opaque") unresolved = true;
    if (s.kind !== "instance" || !s.master) continue;
    if (local.has(s.master.toLowerCase())) continue;
    const binding = reviewedExternalBindingForMaster(s.master);
    if (binding && binding.terminals.length === s.nodes.length)
      processes.add(LIBRARY_PROCESS[binding.libraryId]);
    else unresolved = true;
  }
  return !unresolved && processes.size === 0
    ? "abstract"
    : !unresolved && processes.size === 1
      ? ([...processes][0] as ModelSourceProcess)
      : "custom";
}

/** Refuse an ambiguous transformation before touching any owned bytes. */
export function replaceSpiceModelProcess(
  source: ProjectModelSource,
  target: ModelSourceProcess,
):
  | { ok: true; source: ProjectModelSource }
  | { ok: false; diagnostic: SimulationSourceDiagnostic } {
  const inspected = inspectProjectModelSource(source);
  const failure = (
    message: string,
    path = source.entry,
    sourceRef?: InstanceStatement["sourceRef"],
  ): { ok: false; diagnostic: SimulationSourceDiagnostic } => ({
    ok: false,
    diagnostic: {
      code: "MODEL_SOURCE_PROCESS_UNSUPPORTED",
      severity: "error",
      message,
      path,
      ...(sourceRef ? { sourceRef } : {}),
    },
  });
  if (target === "custom")
    return failure("Custom requires explicit native model edits.");
  // Replacing a device cannot prove a new library digest or erase an authored
  // corner/include. The author must repair that real dependency first.
  if (source.dependencies.length)
    return failure(
      "Edit library dependencies before replacing this model's process.",
    );
  const local = new Set(inspected.entries.map((e) => e.name.toLowerCase()));
  const changes = new Map<string, Map<number, { end: number; text: string }>>();
  let seen = 0;
  for (const { path, statement: s } of inspected.graph.statements) {
    if (s.kind === "opaque" || s.kind === "conditional" || s.kind === "model")
      return failure(
        "This model has custom or conditional syntax; edit its native source.",
        path,
        s.sourceRef,
      );
    if (s.kind !== "instance" || !s.master || local.has(s.master.toLowerCase()))
      continue;
    const from = reviewedExternalBindingForMaster(s.master);
    if (
      !from ||
      s.family !== "subcircuit" ||
      s.nodes.length !== from.terminals.length
    )
      return failure(
        "This device call has no reviewed process mapping.",
        path,
        s.sourceRef,
      );
    seen++;
    if (LIBRARY_PROCESS[from.libraryId] === target) continue;
    const pair = CORE_MOS.find((p) => p.some((id) => id === from.id));
    const to = pair
      ?.map((id) => reviewedExternalBindingById(id)!)
      .find((b) => LIBRARY_PROCESS[b.libraryId] === target);
    if (!to || from.deviceClass !== to.deviceClass)
      return failure(
        "This device has no reviewed counterpart in the selected process.",
        path,
        s.sourceRef,
      );
    const nodes = to.terminals.map(
      (t) =>
        s.nodes[
          from.terminals.findIndex(
            (f) => f.pinName === t.pinName && f.role === t.role,
          )
        ],
    );
    if (nodes.some((n) => n === undefined))
      return failure(
        "The device terminal roles differ; edit the native model.",
        path,
        s.sourceRef,
      );
    const supplied = new Map(
      s.parameters.map((p) => [p.name.toLowerCase(), p.rawText]),
    );
    if (supplied.size !== s.parameters.length)
      return failure(
        "Duplicate device parameters cannot be replaced safely.",
        path,
        s.sourceRef,
      );
    const parameters: string[] = [];
    for (const p of from.parameters) {
      const value =
        supplied.get(p.name) ??
        p.targetDefaultValue ??
        (p.targetUnit === "micrometre"
          ? projectLengthToSky130Micrometres(p.defaultValue!)
          : p.defaultValue);
      const q = to.parameters.find(
        (q) => q.displayRole === p.displayRole && q.displayRole !== "none",
      );
      if (!q || value === undefined)
        return failure(
          "A device parameter has no reviewed counterpart.",
          path,
          s.sourceRef,
        );
      let mapped = value;
      try {
        if (p.targetUnit !== q.targetUnit) {
          mapped =
            p.targetUnit === "micrometre"
              ? sky130MicrometresToProjectLength(value)
              : projectLengthToSky130Micrometres(value);
        }
      } catch (error) {
        return failure(
          error instanceof Error
            ? error.message
            : "Unsupported geometry expression.",
          path,
          s.sourceRef,
        );
      }
      parameters.push(`${q.name}=${mapped}`);
      supplied.delete(p.name);
    }
    if (supplied.size)
      return failure(
        "An override has no reviewed process mapping.",
        path,
        s.sourceRef,
      );
    const fileChanges = changes.get(path) ?? new Map();
    changes.set(path, fileChanges);
    fileChanges.set(s.sourceRef.start.offset, {
      end: s.sourceRef.end.offset,
      text: [s.name, ...nodes, to.masterName, ...parameters].join(" "),
    });
  }
  if (!seen && target !== "abstract")
    return failure("This model has no reviewed process devices to replace.");
  const next = structuredClone(source);
  for (const file of next.files)
    for (const [start, change] of [...(changes.get(file.path) ?? [])].sort(
      (a, b) => b[0] - a[0],
    ))
      file.text =
        file.text.slice(0, start) + change.text + file.text.slice(change.end);
  return { ok: true, source: next };
}
