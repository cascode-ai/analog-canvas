import {
  drawingOrderEntries,
  drawingOrderKey,
  resolveDrawingOrder,
} from "@icm/model";
import type { DrawingOrderEntry, SchematicDocument } from "@icm/model";
import {
  annotationOwningInstanceId,
  gatheredDrawingLabelOwners,
  instanceSupportsBodyFill,
  isSchematicAnnotationVisible,
  resolveDocumentLogicalNets,
} from "@icm/derived";
import type { SymbolResolver } from "@icm/symbols";

import type { SchematicEdit } from "./edit-schema.js";
import { lockedLayoutOwner } from "./transaction-routing.js";
import { rejectedEditMutation } from "./transaction-domain.js";
import type { EditMutationOutcome, RejectEdit } from "./transaction-domain.js";

type FillEdit = Extract<SchematicEdit, { kind: "set_body_fill" }>;
type ReorderEdit = Extract<SchematicEdit, { kind: "reorder_drawing_objects" }>;

interface DrawingEditContext {
  draft: SchematicDocument;
  before: SchematicDocument;
  resolver: SymbolResolver | undefined;
  changedObjectIds: Set<string>;
  reject: RejectEdit;
}

function sameFill(left: FillEdit["fill"], right: FillEdit["fill"]): boolean {
  if (left?.kind !== right?.kind) return false;
  return (
    left?.kind !== "color" ||
    (right?.kind === "color" && left.color === right.color)
  );
}

function applyBodyFill(
  edit: FillEdit,
  context: DrawingEditContext,
): EditMutationOutcome {
  const { draft, resolver, changedObjectIds, reject } = context;
  const instances = new Map(
    draft.instances.map((instance) => [instance.id, instance]),
  );
  for (const id of new Set(edit.objectIds)) {
    const instance = instances.get(id);
    if (!instance)
      return rejectedEditMutation(
        reject,
        "OBJECT_NOT_FOUND",
        `Instance does not exist: ${id}`,
        [],
        [id],
      );
    const lock = lockedLayoutOwner(draft, id);
    if (lock)
      return rejectedEditMutation(
        reject,
        "EDIT_PRECONDITION",
        `Instance ${id} belongs to locked layout ${lock}`,
        [],
        [id, lock],
      );
    if (edit.fill && !resolver)
      return rejectedEditMutation(
        reject,
        "EDIT_CONTEXT_REQUIRED",
        `Filling ${id} requires a Symbol resolver`,
        [],
        [id],
      );
    if (edit.fill && !instanceSupportsBodyFill(instance, resolver!))
      return rejectedEditMutation(
        reject,
        "EDIT_PRECONDITION",
        `Instance ${id} has no visible fillable body`,
        [],
        [id],
      );
    const legacyBackground = instance.styleOverride?.background;
    if (!legacyBackground && sameFill(instance.bodyFill ?? null, edit.fill))
      continue;
    if (edit.fill) instance.bodyFill = structuredClone(edit.fill);
    else delete instance.bodyFill;
    if (instance.styleOverride && legacyBackground) {
      delete instance.styleOverride.background;
      if (!instance.styleOverride.foreground) delete instance.styleOverride;
    }
    changedObjectIds.add(id);
  }
  return { ok: true };
}

function relativeInsertionIndex(
  order: readonly DrawingOrderEntry[],
  target: DrawingOrderEntry,
  after: boolean,
  gatheredLabels: ReadonlyMap<string, string>,
): number {
  const ownerId =
    target.kind === "instance"
      ? target.id
      : target.kind === "annotation"
        ? gatheredLabels.get(target.id)
        : undefined;
  if (!after && ownerId)
    return order.findIndex(
      (entry) => entry.kind === "instance" && entry.id === ownerId,
    );
  let index = order.indexOf(target) + Number(after);
  while (after && ownerId) {
    const entry = order[index];
    if (
      entry?.kind !== "annotation" ||
      gatheredLabels.get(entry.id) !== ownerId
    )
      break;
    index++;
  }
  return index;
}

function reorderIndex(
  current: readonly DrawingOrderEntry[],
  rest: readonly DrawingOrderEntry[],
  selectedKeys: ReadonlySet<string>,
  position: ReorderEdit["position"],
  gatheredLabels: ReadonlyMap<string, string>,
  isStep: (entry: DrawingOrderEntry) => boolean,
): number | undefined {
  switch (position.kind) {
    case "insert":
      return position.beforePlane
        ? rest.findIndex((entry) => entry.kind === position.beforePlane)
        : rest.length;
    case "front":
      return rest.length;
    case "back":
      return 0;
    case "before":
    case "after": {
      const key = drawingOrderKey(position.target);
      const target = rest.find((entry) => drawingOrderKey(entry) === key);
      return target
        ? relativeInsertionIndex(
            rest,
            target,
            position.kind === "after",
            gatheredLabels,
          )
        : undefined;
    }
    case "forward": {
      const selected = current.findLastIndex(
        (entry) => selectedKeys.has(drawingOrderKey(entry)) && isStep(entry),
      );
      if (selected < 0) return undefined;
      const next = current
        .slice(selected + 1)
        .find(
          (entry) => !selectedKeys.has(drawingOrderKey(entry)) && isStep(entry),
        );
      return next
        ? relativeInsertionIndex(rest, next, true, gatheredLabels)
        : undefined;
    }
    case "backward": {
      const selected = current.findIndex(
        (entry) => selectedKeys.has(drawingOrderKey(entry)) && isStep(entry),
      );
      if (selected < 0) return undefined;
      const previous = current
        .slice(0, selected)
        .findLast(
          (entry) => !selectedKeys.has(drawingOrderKey(entry)) && isStep(entry),
        );
      return previous
        ? relativeInsertionIndex(rest, previous, false, gatheredLabels)
        : undefined;
    }
  }
}

function applyDrawingOrder(
  edit: ReorderEdit,
  context: DrawingEditContext,
): EditMutationOutcome {
  const { draft, before, changedObjectIds, resolver, reject } = context;
  const current = resolveDrawingOrder(draft);
  const objects = new Map(
    current.flatMap((entry) =>
      "id" in entry ? [[entry.id, entry] as const] : [],
    ),
  );
  const ids = new Set(edit.objectIds);
  const inserting = edit.position.kind === "insert";
  const existingIds = inserting
    ? new Set(
        drawingOrderEntries(before).flatMap((entry) =>
          "id" in entry ? [entry.id] : [],
        ),
      )
    : undefined;
  const existingUnplaced = inserting
    ? new Set(
        before.instances
          .filter((instance) => !instance.placement)
          .map((instance) => instance.id),
      )
    : undefined;
  const instances = new Map(
    draft.instances.map((instance) => [instance.id, instance]),
  );
  const annotations = new Map(
    draft.annotations.map((annotation) => [annotation.id, annotation]),
  );
  const drafting = new Map(
    (draft.drafting?.objects ?? []).map((object) => [object.id, object]),
  );
  const groups = new Map(draft.layoutGroups.map((group) => [group.id, group]));
  for (const id of [...ids]) {
    const group = groups.get(id);
    if (group && !inserting) {
      if (group.locked)
        return rejectedEditMutation(
          reject,
          "EDIT_PRECONDITION",
          `Drawing group is locked: ${id}`,
          [],
          [id],
        );
      ids.delete(id);
      for (const member of group.objectIds)
        if (objects.has(member)) ids.add(member);
    }
  }
  if (!ids.size)
    return rejectedEditMutation(
      reject,
      "EDIT_PRECONDITION",
      "Selection has no movable drawing objects",
      [],
      edit.objectIds,
    );

  const owners = new Map<string, string>();
  for (const annotation of annotations.values()) {
    const owner = annotationOwningInstanceId(annotation);
    if (owner && instances.has(owner)) owners.set(annotation.id, owner);
    if (!inserting && owner && ids.has(owner)) ids.add(annotation.id);
  }

  for (const id of ids) {
    const entry = objects.get(id);
    if (!entry)
      return rejectedEditMutation(
        reject,
        "OBJECT_NOT_FOUND",
        `Object is not part of the drawing: ${id}`,
        [],
        [id],
      );
    const instance = instances.get(id);
    if (instance && !instance.placement && !inserting)
      return rejectedEditMutation(
        reject,
        "EDIT_PRECONDITION",
        `Instance ${id} has not been placed`,
        [],
        [id],
      );
    if (inserting) {
      if (
        existingIds!.has(id) &&
        (!existingUnplaced!.has(id) || !instance?.placement)
      )
        return rejectedEditMutation(
          reject,
          "EDIT_PRECONDITION",
          `Drawing insertion requires a new object: ${id}`,
          [],
          [id],
        );
    } else {
      const lock = lockedLayoutOwner(draft, id);
      if (lock || annotations.get(id)?.locked || drafting.get(id)?.locked)
        return rejectedEditMutation(
          reject,
          "EDIT_PRECONDITION",
          `Drawing object is locked: ${id}`,
          [],
          lock ? [id, lock] : [id],
        );
    }
  }

  const selectedKeys = new Set(
    [...ids].map((id) => drawingOrderKey(objects.get(id)!)),
  );
  const rest = current.filter(
    (entry) => !selectedKeys.has(drawingOrderKey(entry)),
  );
  if ("target" in edit.position) {
    const key = drawingOrderKey(edit.position.target);
    if (!rest.some((entry) => drawingOrderKey(entry) === key)) {
      const id = "id" in edit.position.target ? edit.position.target.id : key;
      return rejectedEditMutation(
        reject,
        "EDIT_PRECONDITION",
        `Drawing target is missing or selected: ${id}`,
        [],
        [id],
      );
    }
  }
  // A label still drawn apart from its owner has its own step until that owner
  // is sorted. Once gathered, it stays with its owner as other objects pass.
  const gatheredLabels = gatheredDrawingLabelOwners(current, owners);
  const logicalNets =
    edit.position.kind === "forward" || edit.position.kind === "backward"
      ? resolveDocumentLogicalNets(draft)
      : undefined;
  const isStep = (entry: DrawingOrderEntry): boolean => {
    switch (entry.kind) {
      case "instance":
        return !!instances.get(entry.id)?.placement;
      case "annotation":
        return (
          ((!ids.has(owners.get(entry.id) ?? "") &&
            !gatheredLabels.has(entry.id)) ||
            edit.objectIds.includes(entry.id)) &&
          isSchematicAnnotationVisible(
            draft,
            annotations.get(entry.id)!,
            logicalNets,
            undefined,
            resolver,
          )
        );
      case "electrical":
        return draft.routes.length > 0 || draft.junctions.length > 0;
      case "circuit-marks":
        return false;
      case "drafting":
        return true;
    }
  };
  const index = reorderIndex(
    current,
    rest,
    selectedKeys,
    edit.position,
    gatheredLabels,
    isStep,
  );
  if (index === undefined || index < 0) return { ok: true };

  const selected = current.filter((entry) =>
    selectedKeys.has(drawingOrderKey(entry)),
  );
  const ownedLabels = new Map<string, DrawingOrderEntry[]>();
  for (const entry of selected) {
    if (entry.kind !== "annotation") continue;
    const owner = owners.get(entry.id);
    if (!owner || !ids.has(owner)) continue;
    const labels = ownedLabels.get(owner) ?? [];
    labels.push(entry);
    ownedLabels.set(owner, labels);
  }
  const ordered = inserting
    ? [...ids].map((id) => objects.get(id)!)
    : selected.flatMap((entry) => {
        if (entry.kind === "annotation" && ids.has(owners.get(entry.id) ?? ""))
          return [];
        if (entry.kind !== "instance") return [entry];
        return [entry, ...(ownedLabels.get(entry.id) ?? [])];
      });
  const next = [...rest.slice(0, index), ...ordered, ...rest.slice(index)];
  if (
    next.every(
      (entry, position) =>
        drawingOrderKey(entry) === drawingOrderKey(current[position]!),
    )
  )
    return { ok: true };
  draft.drawingOrder = next;
  for (const id of ids) changedObjectIds.add(id);
  return { ok: true };
}

export function applyDrawingPresentationEdit(
  edit: FillEdit | ReorderEdit,
  context: DrawingEditContext,
): EditMutationOutcome {
  return edit.kind === "set_body_fill"
    ? applyBodyFill(edit, context)
    : applyDrawingOrder(edit, context);
}
