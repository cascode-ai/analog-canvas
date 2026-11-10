import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { instanceOwnedAnnotationIds } from "./instance-lifecycle.js";
import {
  planRoutingDeletion,
  type RoutingDeletionSeed,
} from "./routing-deletion-planner.js";

/** Locked drawings and texts a selection names; deleting it keeps them. */
export interface LockedSelectionObjects {
  readonly annotationIds: readonly string[];
  readonly draftingIds: readonly string[];
}

/**
 * The selection's own locked drawings and texts. A label that goes with a
 * selected part is the part's to take, so only free-standing ones count.
 */
export function lockedSelectionObjects(
  document: SchematicDocument,
  seed: Pick<
    RoutingDeletionSeed,
    "instanceIds" | "annotationIds" | "draftingIds"
  >,
): LockedSelectionObjects {
  const owned = instanceOwnedAnnotationIds(document, seed.instanceIds);
  const annotationIds = new Set(seed.annotationIds ?? []);
  const draftingIds = new Set(seed.draftingIds ?? []);
  return {
    annotationIds: document.annotations
      .filter(
        (annotation) =>
          annotation.locked &&
          annotationIds.has(annotation.id) &&
          !owned.has(annotation.id),
      )
      .map((annotation) => annotation.id),
    draftingIds: (document.drafting?.objects ?? [])
      .filter((object) => object.locked && draftingIds.has(object.id))
      .map((object) => object.id),
  };
}

/**
 * What a person is told about the locked objects a deletion kept, or null;
 * `deletedOthers` says whether the rest of the selection went.
 */
export function lockedDeletionStatus(
  locked: LockedSelectionObjects,
  deletedOthers: boolean,
): string | null {
  const counted = (count: number, noun: string) =>
    count === 0 ? [] : [`${count} locked ${noun}${count === 1 ? "" : "s"}`];
  const parts = [
    ...counted(locked.draftingIds.length, "drawing"),
    ...counted(locked.annotationIds.length, "text"),
  ];
  if (parts.length === 0) return null;
  const single = locked.draftingIds.length + locked.annotationIds.length === 1;
  const kept = `${parts.join(" and ")}; unlock ${single ? "it" : "them"} to delete`;
  return deletedOthers
    ? `Deleted the unlocked objects and kept ${kept}`
    : `Kept ${kept}`;
}

/**
 * GUI and Agent selection deletion share both graph closure and interface
 * ownership. Locked drawings and texts the selection names stay: the plan
 * deletes the rest and reports them in `locked`; only an Unlock lets them go.
 */
export function planCellSelectionDeletion(
  document: SchematicDocument,
  resolver: SymbolResolver,
  seed: RoutingDeletionSeed,
  sequence: number,
) {
  const locked = lockedSelectionObjects(document, seed);
  const keptAnnotations = new Set(locked.annotationIds);
  const keptDrafting = new Set(locked.draftingIds);
  const routing = planRoutingDeletion(
    document,
    resolver,
    {
      ...seed,
      ...(seed.annotationIds
        ? {
            annotationIds: seed.annotationIds.filter(
              (id) => !keptAnnotations.has(id),
            ),
          }
        : {}),
      ...(seed.draftingIds
        ? {
            draftingIds: seed.draftingIds.filter((id) => !keptDrafting.has(id)),
          }
        : {}),
    },
    sequence,
  );
  // Any segment of a Power Rail deletes the whole rail and the label at its
  // far end, which the selection's own closure never reaches. A label that is
  // a Cell Pin takes its terminal along, so the plan's own removals count.
  const removedTerminalIds = new Set(
    routing.edits.flatMap((edit) =>
      edit.kind === "remove_cell_terminal" ? [edit.terminalId] : [],
    ),
  );
  // Only a Pin label the plan removes takes its terminal along. The movement
  // closure also counts labels that would merely follow: with the last part
  // tapped onto a Power Rail deleted, the whole rail looked internal, its
  // VDD label a follower, and the VDD Pin went while the rail stayed,
  // unnamed and refused (#1312).
  const removedAnnotationIds = new Set(
    routing.edits.flatMap((edit) =>
      edit.kind === "remove_schematic_annotation" ? [edit.annotationId] : [],
    ),
  );
  const terminalIds = (document.netlist?.terminals ?? [])
    .filter(
      (terminal) =>
        removedTerminalIds.has(terminal.id) ||
        terminal.interfaceInstanceIds.some((id) =>
          seed.instanceIds.includes(id),
        ) ||
        (terminal.interfaceAnnotationId !== undefined &&
          removedAnnotationIds.has(terminal.interfaceAnnotationId)),
    )
    .map((terminal) => terminal.id);
  return { routing, terminalIds, locked };
}
