import type { CircuitProject, InstanceNetlistData } from "@icm/model";
import { deviceDescriptor } from "@icm/devices";
import type {
  ProjectStructureEdit,
  BulkPatchInstanceNetlistEditSchema,
} from "@icm/edit-engine";
import type {
  DesignNetlistExportResult,
  PrintedNetlistInstance,
} from "@icm/netlist";
import { expressionIsStructurallyValid } from "@icm/spice";
import { restorePrintedParameter } from "@icm/netlist";
import type { z } from "zod";

type ReadyExport = Extract<DesignNetlistExportResult, { status: "ready" }>;
type Assignment = z.infer<
  typeof BulkPatchInstanceNetlistEditSchema
>["assignments"][number];
export type NetlistCodeEditPlan =
  | {
      ok: true;
      edits: ProjectStructureEdit[];
      instances: PrintedNetlistInstance[];
    }
  | { ok: false; message: string };

type NetlistCodeEditAnalysis =
  | {
      ok: true;
      instances: PrintedNetlistInstance[];
      updates: {
        documentId: string;
        expectedRevision: number;
        assignments: Assignment[];
      }[];
    }
  | { ok: false; message: string };

const literal = (text: string) =>
  text
    .replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
    .replace(/\s+/gu, (space) => (/[\r\n]/u.test(space) ? "\\s*" : "[ \\t]+"));

/** Each printed field stays on one physical line (including SPICE's + lines).
 * Never compile all cards into one regexp: even a valid 600-MOS edit overflows
 * V8's regexp stack. Match the fixed scaffold a line at a time instead, retaining
 * absolute capture ranges for code/canvas selection. Blank lines, indentation,
 * horizontal spacing and CRLF do not change the circuit scaffold.
 */
function compilePrintedFields(baseline: ReadyExport) {
  const lines = (text: string) =>
    [...text.matchAll(/[^\r\n]+/gu)].filter((line) => line[0].trim());
  const before = lines(baseline.file.text);
  const fields = baseline.locations.fields;
  const steps: { pattern: RegExp; firstField: number; endField: number }[] = [];
  let fieldIndex = 0;
  for (let lineIndex = 0; lineIndex < before.length; lineIndex++) {
    const line = before[lineIndex]!;
    const end = line.index + line[0].length;
    let cursor = line.index;
    const firstField = fieldIndex;
    const pattern: string[] = [];
    while (fields[fieldIndex] && fields[fieldIndex]!.startOffset < end) {
      const field = fields[fieldIndex]!;
      if (field.startOffset < cursor || field.endOffset > end) return null;
      const fixed = baseline.file.text.slice(cursor, field.startOffset);
      pattern.push(
        literal(fieldIndex === firstField ? fixed.trimStart() : fixed),
        "([^\\n\\r]*?)",
      );
      cursor = field.endOffset;
      fieldIndex++;
    }
    const tail = baseline.file.text.slice(cursor, end);
    pattern.push(
      literal(firstField === fieldIndex ? tail.trim() : tail.trimEnd()),
    );
    try {
      steps.push({
        pattern: new RegExp(`^[ \\t]*${pattern.join("")}[ \\t]*$`, "du"),
        firstField,
        endField: fieldIndex,
      });
    } catch (error) {
      // A pathological single card must be a rejected draft, not a render crash.
      if (error instanceof SyntaxError || error instanceof RangeError)
        return null;
      throw error;
    }
  }
  if (fieldIndex !== fields.length) return null;
  return (source: string) => {
    const after = lines(source);
    if (steps.length !== after.length) return null;
    const values: string[] = [];
    const ranges: [number, number][] = [];
    for (let lineIndex = 0; lineIndex < steps.length; lineIndex++) {
      const { pattern, firstField, endField } = steps[lineIndex]!;
      const edited = after[lineIndex]!;
      let match: RegExpExecArray | null;
      try {
        match = pattern.exec(edited[0]);
      } catch (error) {
        if (error instanceof SyntaxError || error instanceof RangeError)
          return null;
        throw error;
      }
      if (!match) return null;
      for (let index = firstField; index < endField; index++) {
        const capture = index - firstField + 1;
        values.push(match[capture]!);
        const [start, finish] = match.indices![capture]!;
        ranges.push([edited.index + start, edited.index + finish]);
      }
    }
    return { values, ranges };
  };
}

/** Only printed fields write back; circuit identity and wiring never come from
 * reimporting a text file. All Cells apply together through one transaction.
 */
export function planNetlistCodeEdit(
  project: CircuitProject,
  baseline: ReadyExport,
  source: string,
): NetlistCodeEditPlan {
  return createNetlistCodeEditSession(project, baseline).plan(source);
}

/** One immutable Project/export snapshot and at most one cached draft. No
 * transaction authority or global cache; controller fences remain unchanged. */
export function createNetlistCodeEditSession(
  project: CircuitProject,
  baseline: ReadyExport,
) {
  const documentIndex = new Map(
    project.documents.map((d) => [
      d.id,
      { document: d, instances: new Map(d.instances.map((i) => [i.id, i])) },
    ]),
  );
  const key = (documentId: string, instanceId: string) =>
    JSON.stringify([documentId, instanceId]);
  const ownerFields = new Map<string, number[]>();
  baseline.locations.fields.forEach((field, index) => {
    const owner = key(field.documentId, field.instanceId);
    const indices = ownerFields.get(owner);
    if (indices) indices.push(index);
    else ownerFields.set(owner, [index]);
  });
  let matcher: ReturnType<typeof compilePrintedFields> | undefined;
  let lastSource: string | undefined;
  let lastAnalysis: NetlistCodeEditAnalysis | undefined;
  let lastPlan: NetlistCodeEditPlan | undefined;
  function analyze(source: string): NetlistCodeEditAnalysis {
    if (source === lastSource && lastAnalysis) return lastAnalysis;
    lastSource = source;
    lastPlan = undefined;
    lastAnalysis = undefined;
    lastAnalysis = analyzeUncached(source);
    return lastAnalysis;
  }
  function analyzeUncached(source: string): NetlistCodeEditAnalysis {
    if (source === baseline.file.text)
      return { ok: true, updates: [], instances: baseline.locations.instances };
    const fields = baseline.locations.fields;
    if (matcher === undefined) matcher = compilePrintedFields(baseline);
    const match = matcher?.(source);
    if (!match)
      return {
        ok: false,
        message:
          "Edit device names, models and parameter values here. Change connections, ports or device structure on the canvas or in Project Code; Refresh regenerates the netlist from the circuit.",
      };
    const documents = new Map<string, Map<string, Assignment>>();
    const seen = new Map<string, string>();
    for (let index = 0; index < fields.length; index++) {
      const field = fields[index]!;
      const value = match.values[index]!.trim();
      const key = JSON.stringify([
        field.documentId,
        field.instanceId,
        field.kind,
        field.parameter,
      ]);
      if (seen.has(key) && seen.get(key) !== value)
        return {
          ok: false,
          message: `Keep repeated values for ${field.parameter ?? field.kind} consistent.`,
        };
      seen.set(key, value);
      if (value === field.rawValue) continue;
      const indexed = documentIndex.get(field.documentId);
      const document = indexed?.document;
      const instance = indexed?.instances.get(field.instanceId);
      if (!document || !instance)
        return {
          ok: false,
          message: "The circuit changed. Reload the netlist before applying.",
        };
      if (!value)
        return {
          ok: false,
          message: `Enter a ${field.parameter ?? field.kind} for ${instance.reference}.`,
        };
      let assignments = documents.get(document.id);
      if (!assignments) documents.set(document.id, (assignments = new Map()));
      let assignment = assignments.get(instance.id);
      if (!assignment)
        assignments.set(
          instance.id,
          (assignment = { instanceId: instance.id }),
        );
      if (field.kind === "reference") {
        if (!/^[A-Za-z][A-Za-z0-9_]*$/u.test(value))
          return {
            ok: false,
            message:
              "Device names must start with a letter and contain only letters, digits or underscores.",
          };
        // A SPICE-only prefix must not become a new schematic name on an
        // ordinary rename (XM1 -> XM2 edits M1 -> M2). An explicit X-style
        // name such as X_load remains a valid authored name as before.
        let reference = value;
        if (field.rawValue !== instance.reference) {
          const prefix = field.rawValue[0]!;
          if (value[0]!.toLowerCase() !== prefix.toLowerCase())
            return {
              ok: false,
              message: `This SPICE device name must start with ${prefix}.`,
            };
          const suffix = field.rawValue.slice(1 + instance.reference!.length);
          let body = value.slice(1);
          if (suffix && body.endsWith(suffix))
            body = body.slice(0, -suffix.length);
          if (body[0]?.toLowerCase() === instance.reference![0]!.toLowerCase())
            reference = body;
        }
        assignment.reference = reference;
      } else if (field.kind === "parameter") {
        if (!expressionIsStructurallyValid(value))
          return {
            ok: false,
            message: `Invalid ${field.parameter} value: ${value}`,
          };
        const parameter =
          Object.keys(instance.netlist?.parameters ?? {}).find(
            (name) => name.toLowerCase() === field.parameter!.toLowerCase(),
          ) ?? field.parameter!;
        try {
          const restored = restorePrintedParameter(
            value,
            field.conversion ?? "identity",
            true,
          );
          if (restored !== instance.netlist?.parameters[parameter])
            assignment.set = { ...assignment.set, [parameter]: restored };
        } catch (error) {
          return {
            ok: false,
            message:
              error instanceof Error
                ? error.message
                : `Invalid ${parameter} value`,
          };
        }
      } else {
        if (!/^[A-Za-z_][A-Za-z0-9_.$!]*$/u.test(value))
          return { ok: false, message: `Invalid model name: ${value}` };
        const binding = instance.netlist?.binding;
        let next: InstanceNetlistData["binding"];
        if (
          binding?.kind === "model" ||
          binding?.kind === "unresolved-subcircuit"
        )
          next = { ...binding, name: value };
        else if (
          !binding &&
          deviceDescriptor(instance.symbolId)?.targetPolicy === "required-model"
        )
          next = {
            kind: "model",
            deviceClass: deviceDescriptor(instance.symbolId)!.deviceClass,
            name: value,
          };
        else
          return {
            ok: false,
            message:
              "This target has a defined pin interface. Change its binding in Properties.",
          };
        assignment.binding = next;
      }
    }
    const updates = [...documents].flatMap(([documentId, assignments]) => {
      const changed = [...assignments.values()].filter(
        (a) => Object.keys(a).length > 1,
      );
      return changed.length
        ? [
            {
              documentId,
              expectedRevision:
                documentIndex.get(documentId)!.document.revision,
              assignments: changed,
            },
          ]
        : [];
    });
    const instances = baseline.locations.instances.map((instance) => {
      const indices = ownerFields.get(
        key(instance.documentId, instance.instanceId),
      )!;
      const reference = indices.find(
        (index) => fields[index]!.kind === "reference",
      )!;
      const startOffset = match.ranges[reference]![0];
      const lastFieldEnd = Math.max(
        ...indices.map((index) => match.ranges[index]![1]),
      );
      const newline = source.indexOf("\n", lastFieldEnd);
      return {
        ...instance,
        startOffset,
        endOffset: newline < 0 ? source.length : newline,
      };
    });
    return { ok: true, updates, instances };
  }
  function plan(source: string): NetlistCodeEditPlan {
    const analysis = analyze(source);
    if (lastPlan) return lastPlan;
    lastPlan = analysis.ok
      ? {
          ok: true,
          instances: analysis.instances,
          edits: analysis.updates.map((update) => ({
            kind: "transact_document",
            documentId: update.documentId,
            expectedRevision: update.expectedRevision,
            edits: [
              {
                kind: "bulk_patch_instance_netlist",
                assignments: update.assignments,
              },
            ],
          })),
        }
      : analysis;
    return lastPlan;
  }
  return { analyze, plan };
}

export function netlistInstanceAtLine(
  source: string,
  position: number,
  instances: readonly PrintedNetlistInstance[],
): PrintedNetlistInstance | null {
  const start = source.lastIndexOf("\n", Math.max(0, position - 1)) + 1;
  const newline = source.indexOf("\n", position);
  const end = newline < 0 ? source.length : newline;
  return (
    instances.find(
      (instance) => instance.startOffset <= end && instance.endOffset > start,
    ) ?? null
  );
}

/** Where the given parts of one Cell are printed, to light them in the code. */
export function netlistInstanceRanges(
  instances: readonly PrintedNetlistInstance[],
  documentId: string,
  instanceIds: readonly string[],
): { from: number; to: number }[] {
  const wanted = new Set(instanceIds);
  return instances
    .filter(
      (instance) =>
        instance.documentId === documentId && wanted.has(instance.instanceId),
    )
    .map((instance) => ({
      from: instance.startOffset,
      to: instance.endOffset,
    }));
}
