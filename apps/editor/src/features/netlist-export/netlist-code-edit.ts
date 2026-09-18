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

const literal = (text: string) =>
  text
    .replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
    .replace(/\s+/gu, (space) => (/[\r\n]/u.test(space) ? "\\s*" : "[ \\t]+"));

/** Only printed fields write back; circuit identity and wiring never come from
 * reimporting a text file. All Cells apply together through one transaction.
 */
export function planNetlistCodeEdit(
  project: CircuitProject,
  baseline: ReadyExport,
  source: string,
): NetlistCodeEditPlan {
  if (source === baseline.file.text)
    return { ok: true, edits: [], instances: baseline.locations.instances };
  const fields = baseline.locations.fields;
  let cursor = 0;
  const pattern: string[] = [];
  for (const field of fields) {
    pattern.push(
      literal(baseline.file.text.slice(cursor, field.startOffset)),
      "([^\\n\\r]*?)",
    );
    cursor = field.endOffset;
  }
  pattern.push(literal(baseline.file.text.slice(cursor)));
  const match = new RegExp(`^${pattern.join("")}$`, "du").exec(source);
  if (!match)
    return {
      ok: false,
      message:
        "Edit device names, models and parameter values here. Change connections, ports or device structure on the canvas or in Project Code.",
    };
  const documents = new Map<string, Map<string, Assignment>>();
  const seen = new Map<string, string>();
  for (let index = 0; index < fields.length; index++) {
    const field = fields[index]!;
    const value = match[index + 1]!.trim();
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
    const document = project.documents.find(
      (item) => item.id === field.documentId,
    );
    const instance = document?.instances.find(
      (item) => item.id === field.instanceId,
    );
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
      assignments.set(instance.id, (assignment = { instanceId: instance.id }));
    if (field.kind === "reference") {
      if (!/^[A-Za-z][A-Za-z0-9_]*$/u.test(value))
        return {
          ok: false,
          message:
            "Device names must start with a letter and contain only letters, digits or underscores.",
        };
      assignment.reference = value;
    } else if (field.kind === "parameter") {
      if (!expressionIsStructurallyValid(value))
        return {
          ok: false,
          message: `Invalid ${field.parameter} value: ${value}`,
        };
      assignment.set = { ...assignment.set, [field.parameter!]: value };
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
  const edits: ProjectStructureEdit[] = [...documents].map(
    ([documentId, assignments]) => ({
      kind: "transact_document",
      documentId,
      expectedRevision: project.documents.find(
        (item) => item.id === documentId,
      )!.revision,
      edits: [
        {
          kind: "bulk_patch_instance_netlist",
          assignments: [...assignments.values()],
        },
      ],
    }),
  );
  const instances = baseline.locations.instances.map((instance) => {
    const ownerFields = fields.flatMap((field, index) =>
      field.documentId === instance.documentId &&
      field.instanceId === instance.instanceId
        ? [index]
        : [],
    );
    const reference = ownerFields.find(
      (index) => fields[index]!.kind === "reference",
    )!;
    const startOffset = match.indices![reference + 1]![0];
    const lastFieldEnd = Math.max(
      ...ownerFields.map((index) => match.indices![index + 1]![1]),
    );
    const newline = source.indexOf("\n", lastFieldEnd);
    return {
      ...instance,
      startOffset,
      endOffset: newline < 0 ? source.length : newline,
    };
  });
  return { ok: true, edits, instances };
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
