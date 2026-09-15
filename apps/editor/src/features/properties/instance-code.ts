import {
  InstanceNetlistBindingSchema,
  InstanceNetlistDataSchema,
  type CircuitProject,
} from "@icm/model";
import {
  BulkPatchInstanceNetlistEditSchema,
  type ProjectStructureEdit,
} from "@icm/edit-engine";
import { z } from "zod";

const InstanceCodeSchema = z.strictObject({
  symbol: z.string().optional(),
  reference: z.string().min(1).max(128).nullable().optional(),
  target: InstanceNetlistBindingSchema.nullable().optional(),
  parameters: InstanceNetlistDataSchema.shape.parameters.optional(),
});
const ProjectInstanceCodeSchema = z.record(
  z.string().min(1),
  z.record(z.string().min(1), InstanceCodeSchema),
);

type Assignment = z.infer<
  typeof BulkPatchInstanceNetlistEditSchema
>["assignments"][number];

/** Stable addresses allow reference swaps and partial multi-Cell pastes. */
export function formatInstanceCode(project: CircuitProject): string {
  return JSON.stringify(
    Object.fromEntries(
      project.documents.map((document) => [
        document.id,
        Object.fromEntries(
          document.instances
            .filter((instance) => instance.netlist)
            .map((instance) => [
              instance.id,
              {
                symbol: instance.symbolId,
                reference: instance.reference ?? null,
                target: instance.netlist!.binding ?? null,
                parameters: instance.netlist!.parameters,
              },
            ]),
        ),
      ]),
    ),
    null,
    2,
  );
}

/** All requested records must validate before any typed edits are returned. */
export function planInstanceCode(
  project: CircuitProject,
  source: string,
):
  { ok: true; edits: ProjectStructureEdit[] } | { ok: false; message: string } {
  let data: unknown;
  try {
    data = JSON.parse(source);
  } catch {
    return { ok: false, message: "Enter valid JSON" };
  }
  const parsed = ProjectInstanceCodeSchema.safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    return { ok: false, message: `${issue.path.join(".")}: ${issue.message}` };
  }
  const edits: ProjectStructureEdit[] = [];
  for (const [documentId, rows] of Object.entries(parsed.data)) {
    const document = project.documents.find((item) => item.id === documentId);
    if (!document)
      return { ok: false, message: `Unknown Cell ID: ${documentId}` };
    const assignments: Assignment[] = [];
    for (const [instanceId, row] of Object.entries(rows)) {
      const instance = document.instances.find(
        (item) => item.id === instanceId,
      );
      if (!instance?.netlist)
        return {
          ok: false,
          message: `Unknown netlist instance: ${documentId}/${instanceId}`,
        };
      if (row.symbol !== undefined && row.symbol !== instance.symbolId)
        return { ok: false, message: `${instanceId}: symbol is read-only` };
      const assignment: Assignment = { instanceId };
      if (
        row.reference !== undefined &&
        row.reference !== (instance.reference ?? null)
      ) {
        if (row.reference === null)
          return {
            ok: false,
            message: `${instanceId}: reference cannot be cleared`,
          };
        assignment.reference = row.reference;
      }
      if (
        row.target !== undefined &&
        JSON.stringify(row.target) !==
          JSON.stringify(
            instance.netlist.binding
              ? InstanceNetlistBindingSchema.parse(instance.netlist.binding)
              : null,
          )
      )
        assignment.binding = row.target;
      if (row.parameters !== undefined) {
        const set = Object.fromEntries(
          Object.entries(row.parameters).filter(
            ([name, value]) => value !== instance.netlist!.parameters[name],
          ),
        );
        const unset = Object.keys(instance.netlist.parameters).filter(
          (name) => !Object.hasOwn(row.parameters!, name),
        );
        if (Object.keys(set).length) assignment.set = set;
        if (unset.length) assignment.unset = unset;
      }
      if (Object.keys(assignment).length > 1) assignments.push(assignment);
    }
    if (!assignments.length) continue;
    const bulk = BulkPatchInstanceNetlistEditSchema.safeParse({
      kind: "bulk_patch_instance_netlist",
      assignments,
    });
    if (!bulk.success)
      return {
        ok: false,
        message: `${documentId}: ${bulk.error.issues[0]!.message}`,
      };
    edits.push({
      kind: "transact_document",
      documentId,
      expectedRevision: document.revision,
      edits: [bulk.data],
    });
  }
  return { ok: true, edits };
}
