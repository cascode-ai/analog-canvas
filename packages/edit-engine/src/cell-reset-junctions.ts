import type { SchematicDocument, VisualAnchor } from "@icm/model";

/** Routes are removed by both resets; only references that survive count. */
export function orphanedCellResetJunctionIds(
  document: SchematicDocument,
  intent: "clear-drawing" | "reset-placement",
): ReadonlySet<string> {
  const retained = new Set<string>();
  const retainAnchor = (anchor: VisualAnchor) => {
    if (anchor.kind === "object") retained.add(anchor.objectId);
  };
  for (const annotation of document.annotations)
    retainAnchor(annotation.anchor);
  for (const evidence of document.connectivityEvidence) {
    if (
      evidence.kind === "name-claim" &&
      evidence.owner.kind === "power-marker"
    ) {
      retained.add(evidence.owner.objectId);
    }
  }
  if (intent === "clear-drawing") {
    for (const object of [...document.layoutGroups, ...document.constraints]) {
      for (const id of object.objectIds) retained.add(id);
    }
  } else {
    for (const object of document.drafting?.objects ?? []) {
      retainAnchor(object.anchor);
      if (object.kind === "arrow") {
        retainAnchor(object.from);
        retainAnchor(object.to);
      } else if (object.kind === "leader" || object.kind === "callout") {
        retainAnchor(object.target);
      }
    }
  }
  return new Set(
    document.junctions.flatMap((junction) =>
      retained.has(junction.id) ? [] : [junction.id],
    ),
  );
}
