import {
  AnnotationSchema,
  DraftingObjectSchema,
  LayoutConstraintSchema,
  LayoutGroupSchema,
} from "@icm/model";
import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import type { EditTransaction } from "./edit-schema.js";
import {
  ensureDraftingLayer,
  removeConnectivityEvidenceOwnedBy,
} from "./transaction-connectivity.js";
import { translateObjectAnchoredAnnotation } from "./transaction-instance-annotations.js";
import {
  lockedLayoutOwner,
  validateNetLabelBinding,
} from "./transaction-routing.js";
import type { EditMutationOutcome, RejectEdit } from "./transaction-domain.js";

type PresentationLayoutEdit = Extract<
  EditTransaction["edits"][number],
  {
    kind:
      | "set_presentation_style"
      | "set_cell_symbol_presentation"
      | "upsert_schematic_annotation"
      | "remove_schematic_annotation"
      | "upsert_drafting_object"
      | "remove_drafting_object"
      | "set_layout_group"
      | "remove_layout_group"
      | "set_layout_constraint"
      | "remove_layout_constraint"
      | "align_instances";
  }
>;

export interface PresentationLayoutEditContext {
  draft: SchematicDocument;
  resolver: SymbolResolver | undefined;
  changedObjectIds: Set<string>;
  deferNetPrune(netId: string): void;
  reject: RejectEdit;
}

export type PresentationLayoutEditOutcome = EditMutationOutcome;

export function applyPresentationLayoutEdit(
  edit: PresentationLayoutEdit,
  context: PresentationLayoutEditContext,
): PresentationLayoutEditOutcome {
  const { draft, resolver, changedObjectIds, deferNetPrune, reject } = context;
  switch (edit.kind) {
    case "set_presentation_style":
      draft.presentation.styleProfileId = edit.styleProfileId;
      if (edit.styleOverrides === null) {
        delete draft.presentation.styleOverrides;
      } else if (edit.styleOverrides !== undefined) {
        draft.presentation.styleOverrides = structuredClone(
          edit.styleOverrides,
        );
      }
      changedObjectIds.add(draft.id);
      return { ok: true, connectivityChanged: false };
    case "set_cell_symbol_presentation":
      if (edit.presentation === null) {
        delete draft.presentation.cellSymbol;
      } else {
        draft.presentation.cellSymbol = structuredClone(edit.presentation);
      }
      changedObjectIds.add(draft.id);
      return { ok: true, connectivityChanged: false };
    case "upsert_schematic_annotation": {
      const existingIndex = draft.annotations.findIndex(
        (annotation) => annotation.id === edit.annotation.id,
      );
      const existing = draft.annotations[existingIndex];
      if (existing?.locked) {
        return {
          ok: false,
          rejection: reject(
            "EDIT_PRECONDITION",
            `Annotation is locked: ${existing.id}`,
          ),
        };
      }
      const annotation = AnnotationSchema.parse(edit.annotation);
      const bindingError = validateNetLabelBinding(draft, annotation);
      if (bindingError) {
        return {
          ok: false,
          rejection: reject("EDIT_PRECONDITION", bindingError),
        };
      }
      if (existingIndex >= 0) draft.annotations[existingIndex] = annotation;
      else draft.annotations.push(annotation);
      changedObjectIds.add(annotation.id);
      return { ok: true, connectivityChanged: false };
    }
    case "remove_schematic_annotation": {
      const index = draft.annotations.findIndex(
        (annotation) => annotation.id === edit.annotationId,
      );
      const annotation = draft.annotations[index];
      if (!annotation) {
        return {
          ok: false,
          rejection: reject(
            "OBJECT_NOT_FOUND",
            `Annotation does not exist: ${edit.annotationId}`,
          ),
        };
      }
      if (annotation.locked) {
        return {
          ok: false,
          rejection: reject(
            "EDIT_PRECONDITION",
            `Annotation is locked: ${annotation.id}`,
          ),
        };
      }
      if (
        [...draft.layoutGroups, ...draft.constraints].some((item) =>
          item.objectIds.includes(annotation.id),
        )
      ) {
        return {
          ok: false,
          rejection: reject(
            "EDIT_PRECONDITION",
            `Annotation is referenced by layout intent: ${annotation.id}`,
          ),
        };
      }
      const ownerNetIds = removeConnectivityEvidenceOwnedBy(
        draft,
        new Set([annotation.id]),
        changedObjectIds,
      );
      draft.annotations.splice(index, 1);
      changedObjectIds.add(annotation.id);
      for (const netId of ownerNetIds) deferNetPrune(netId);
      return { ok: true, connectivityChanged: ownerNetIds.length > 0 };
    }
    case "upsert_drafting_object": {
      ensureDraftingLayer(draft);
      const objects = draft.drafting!.objects;
      const existingIndex = objects.findIndex(
        (item) => item.id === edit.object.id,
      );
      const existing = objects[existingIndex];
      const parsed = DraftingObjectSchema.parse(edit.object);
      const isPureUnlock =
        existing?.locked === true &&
        parsed.locked === false &&
        JSON.stringify({ ...existing, locked: false }) ===
          JSON.stringify(parsed);
      if (existing?.locked && !isPureUnlock) {
        return {
          ok: false,
          rejection: reject(
            "EDIT_PRECONDITION",
            `Drafting object is locked: ${existing.id}`,
          ),
        };
      }
      if (parsed.kind === "floating-symbol") {
        if (!resolver) {
          return {
            ok: false,
            rejection: reject(
              "EDIT_PRECONDITION",
              `A Symbol Resolver is required to validate a floating symbol: ${parsed.symbolId}`,
            ),
          };
        }
        const resolved = resolver.resolve(parsed.symbolId);
        if (!resolved) {
          return {
            ok: false,
            rejection: reject(
              "EDIT_PRECONDITION",
              `Unknown floating symbol: ${parsed.symbolId}`,
            ),
          };
        }
        if (!resolved.definition.decorative) {
          return {
            ok: false,
            rejection: reject(
              "EDIT_PRECONDITION",
              `Floating symbol must be decorative: ${parsed.symbolId}`,
            ),
          };
        }
        if (resolved.definition.pins.length > 0) {
          return {
            ok: false,
            rejection: reject(
              "EDIT_PRECONDITION",
              `Floating symbol must be terminal-free: ${parsed.symbolId}`,
            ),
          };
        }
      }
      if (existingIndex >= 0) objects[existingIndex] = parsed;
      else objects.push(parsed);
      changedObjectIds.add(parsed.id);
      return { ok: true, connectivityChanged: false };
    }
    case "remove_drafting_object": {
      ensureDraftingLayer(draft);
      const objects = draft.drafting!.objects;
      const index = objects.findIndex((item) => item.id === edit.objectId);
      const object = objects[index];
      if (!object) {
        return {
          ok: false,
          rejection: reject(
            "OBJECT_NOT_FOUND",
            `Drafting object does not exist: ${edit.objectId}`,
          ),
        };
      }
      objects.splice(index, 1);
      draft.layoutGroups = draft.layoutGroups.flatMap((group) => {
        if (!group.objectIds.includes(object.id)) return [group];
        const objectIds = group.objectIds.filter(
          (objectId) => objectId !== object.id,
        );
        changedObjectIds.add(group.id);
        return objectIds.length > 0 ? [{ ...group, objectIds }] : [];
      });
      changedObjectIds.add(object.id);
      return { ok: true, connectivityChanged: false };
    }
    case "set_layout_group": {
      const index = draft.layoutGroups.findIndex(
        (group) => group.id === edit.group.id,
      );
      const existing = draft.layoutGroups[index];
      if (existing?.locked) {
        return {
          ok: false,
          rejection: reject(
            "EDIT_PRECONDITION",
            `Layout group is locked: ${existing.id}`,
          ),
        };
      }
      const group = LayoutGroupSchema.parse(edit.group);
      if (index >= 0) draft.layoutGroups[index] = group;
      else draft.layoutGroups.push(group);
      changedObjectIds.add(group.id);
      return { ok: true, connectivityChanged: false };
    }
    case "remove_layout_group": {
      const index = draft.layoutGroups.findIndex(
        (group) => group.id === edit.groupId,
      );
      const group = draft.layoutGroups[index];
      if (!group) {
        return {
          ok: false,
          rejection: reject(
            "OBJECT_NOT_FOUND",
            `Layout group does not exist: ${edit.groupId}`,
          ),
        };
      }
      if (group.locked) {
        return {
          ok: false,
          rejection: reject(
            "EDIT_PRECONDITION",
            `Layout group is locked: ${group.id}`,
          ),
        };
      }
      draft.layoutGroups.splice(index, 1);
      changedObjectIds.add(group.id);
      return { ok: true, connectivityChanged: false };
    }
    case "set_layout_constraint": {
      const index = draft.constraints.findIndex(
        (constraint) => constraint.id === edit.constraint.id,
      );
      const existing = draft.constraints[index];
      if (existing?.locked) {
        return {
          ok: false,
          rejection: reject(
            "EDIT_PRECONDITION",
            `Layout constraint is locked: ${existing.id}`,
          ),
        };
      }
      const constraint = LayoutConstraintSchema.parse(edit.constraint);
      if (index >= 0) draft.constraints[index] = constraint;
      else draft.constraints.push(constraint);
      changedObjectIds.add(constraint.id);
      return { ok: true, connectivityChanged: false };
    }
    case "remove_layout_constraint": {
      const index = draft.constraints.findIndex(
        (constraint) => constraint.id === edit.constraintId,
      );
      const constraint = draft.constraints[index];
      if (!constraint) {
        return {
          ok: false,
          rejection: reject(
            "OBJECT_NOT_FOUND",
            `Layout constraint does not exist: ${edit.constraintId}`,
          ),
        };
      }
      if (constraint.locked) {
        return {
          ok: false,
          rejection: reject(
            "EDIT_PRECONDITION",
            `Layout constraint is locked: ${constraint.id}`,
          ),
        };
      }
      draft.constraints.splice(index, 1);
      changedObjectIds.add(constraint.id);
      return { ok: true, connectivityChanged: false };
    }
    case "align_instances": {
      if (new Set(edit.instanceIds).size !== edit.instanceIds.length) {
        return {
          ok: false,
          rejection: reject(
            "EDIT_PRECONDITION",
            "Alignment instance IDs must be unique",
          ),
        };
      }
      const instances = edit.instanceIds.map((id) =>
        draft.instances.find((instance) => instance.id === id),
      );
      if (instances.some((instance) => !instance)) {
        const missing = edit.instanceIds.find(
          (id) => !draft.instances.some((instance) => instance.id === id),
        );
        return {
          ok: false,
          rejection: reject(
            "OBJECT_NOT_FOUND",
            `Instance does not exist: ${missing}`,
          ),
        };
      }
      const lockedInstanceId = edit.instanceIds.find((id) =>
        lockedLayoutOwner(draft, id),
      );
      if (lockedInstanceId) {
        return {
          ok: false,
          rejection: reject(
            "EDIT_PRECONDITION",
            `Instance ${lockedInstanceId} is locked by layout intent ${lockedLayoutOwner(draft, lockedInstanceId)}`,
          ),
        };
      }
      if (instances.some((instance) => instance!.placement === null)) {
        return {
          ok: false,
          rejection: reject(
            "EDIT_PRECONDITION",
            "Every aligned instance must be placed",
          ),
        };
      }
      const coordinate =
        edit.coordinate ?? instances[0]!.placement!.position[edit.axis];
      for (const instance of instances) {
        const oldCoordinate = instance!.placement!.position[edit.axis];
        instance!.placement!.position[edit.axis] = coordinate;
        for (const annotation of draft.annotations) {
          if (
            annotation.anchor.kind === "object" &&
            annotation.anchor.objectId === instance!.id
          ) {
            translateObjectAnchoredAnnotation(annotation, instance!.id, {
              x: edit.axis === "x" ? coordinate - oldCoordinate : 0,
              y: edit.axis === "y" ? coordinate - oldCoordinate : 0,
            });
            changedObjectIds.add(annotation.id);
          }
        }
        changedObjectIds.add(instance!.id);
      }
      return { ok: true, connectivityChanged: false };
    }
  }
}
