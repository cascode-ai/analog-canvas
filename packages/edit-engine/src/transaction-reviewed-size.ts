import {
  reviewedBindingOfDefinition,
  reviewedModelledSizeChanges,
  reviewedSize,
  type ReviewedSizeRole,
} from "@icm/devices";
import type {
  ExternalSubcircuitDefinition,
  SchematicDocument,
} from "@icm/model";

/**
 * Keep every part of the Cell that is bound to a device its library models
 * only at a few sizes (SKY130's 16 V pair) at one of them (#1485): no
 * simulator runs that device at any other. A part an edit left elsewhere —
 * placed, rebound, or given a typed W or L — takes the changes
 * `reviewedModelledSizeChanges` gives, keeping a W or L this transaction set
 * where it can. Other parts normally have a modelled size already, since
 * opening a Project repairs them.
 */
export function fitReviewedSizes(
  before: SchematicDocument,
  draft: SchematicDocument,
  definitions: readonly ExternalSubcircuitDefinition[] | undefined,
  changedObjectIds: Set<string>,
): void {
  if (!definitions?.length) return;
  const byId = new Map(definitions.map((item) => [item.id, item]));
  for (const instance of draft.instances) {
    const binding = instance.netlist?.binding;
    if (binding?.kind !== "external-subcircuit") continue;
    const definition = byId.get(binding.definitionId);
    const reviewed = definition && reviewedBindingOfDefinition(definition);
    if (!reviewed?.modelledSizes) continue;
    const parameters = instance.netlist!.parameters;
    const now = reviewedSize(reviewed, parameters);
    const prior = reviewedSize(
      reviewed,
      before.instances.find((item) => item.id === instance.id)?.netlist
        ?.parameters ?? {},
    );
    const kept = (["width", "length"] as const).filter(
      (role: ReviewedSizeRole) => now[role]?.text !== prior[role]?.text,
    );
    const changes = reviewedModelledSizeChanges(reviewed, parameters, kept);
    if (Object.keys(changes).length === 0) continue;
    instance.netlist!.parameters = { ...parameters, ...changes };
    changedObjectIds.add(instance.id);
  }
}
