import type { Annotation, DraftingObject, SchematicDocument } from "@icm/model";

import type { VisualSelection } from "./visual-selection";

export const SELECTION_CLASSES = [
  "instance",
  "route",
  "junction",
  "terminal",
  "instance-name",
  "instance-value",
  "net-name",
  "pin-name",
  "route-marker",
  "drafting-text",
  "drafting-line",
  "drafting-shape",
] as const;

export type SelectionClass = (typeof SELECTION_CLASSES)[number];
export type SelectionFilter = Readonly<Record<SelectionClass, boolean>>;

function uniformSelectionFilter(enabled: boolean): SelectionFilter {
  return Object.fromEntries(
    SELECTION_CLASSES.map((kind) => [kind, enabled]),
  ) as Record<SelectionClass, boolean>;
}

/** The product default preserves every selectable surface that exists now. */
export const DEFAULT_SELECTION_FILTER = Object.freeze(
  uniformSelectionFilter(true),
);
export const ALL_SELECTION_FILTER = Object.freeze(uniformSelectionFilter(true));
export const NO_SELECTION_FILTER = Object.freeze(uniformSelectionFilter(false));

export function selectionFilterIsDefault(filter: SelectionFilter): boolean {
  return SELECTION_CLASSES.every(
    (kind) => filter[kind] === DEFAULT_SELECTION_FILTER[kind],
  );
}

export function selectionFilterSummary(filter: SelectionFilter): string | null {
  if (selectionFilterIsDefault(filter)) return null;
  const enabled = SELECTION_CLASSES.filter((kind) => filter[kind]);
  if (enabled.length === 0) return "Filter: None";
  if (enabled.length === 1) {
    const labels: Record<SelectionClass, string> = {
      instance: "Instances",
      route: "Wires",
      junction: "Junctions",
      terminal: "Pins",
      "instance-name": "Instance names",
      "instance-value": "Instance values",
      "net-name": "Net names",
      "pin-name": "Pin names",
      "route-marker": "Markers",
      "drafting-text": "Note text",
      "drafting-line": "Drawing lines",
      "drafting-shape": "Shapes",
    };
    return `Filter: ${labels[enabled[0]!]}`;
  }
  return `Filter: ${enabled.length}/${SELECTION_CLASSES.length}`;
}

export function selectionClassForAnnotation(
  annotation: Annotation,
): SelectionClass {
  if (annotation.binding?.kind === "cell-terminal-name") return "pin-name";
  switch (annotation.kind) {
    case "instance-label":
      return "instance-name";
    case "instance-value":
      return "instance-value";
    case "net-label":
    case "power-label":
      return "net-name";
    case "route-marker":
      return "route-marker";
  }
}

export function selectionClassForDrafting(
  object: DraftingObject,
): SelectionClass {
  switch (object.kind) {
    case "text":
    case "callout":
      return "drafting-text";
    case "arrow":
    case "leader":
    case "construction-line":
      return "drafting-line";
    case "rectangle":
    case "circle":
    case "floating-symbol":
      return "drafting-shape";
  }
}

type SelectableCanvasHit = {
  kind:
    | "handle"
    | "annotation"
    | "instance-label"
    | "instance"
    | "drafting"
    | "route"
    | "junction";
  id: string;
};

/** Classify one existing canvas hit without adding a second object model. */
export function selectionClassForCanvasHit(
  document: SchematicDocument,
  hit: SelectableCanvasHit,
): SelectionClass | null {
  switch (hit.kind) {
    case "handle":
      return null;
    case "instance":
      return "instance";
    case "instance-label":
      return "instance-name";
    case "route":
      return "route";
    case "junction":
      return "junction";
    case "annotation": {
      const annotation = document.annotations.find(
        (candidate) => candidate.id === hit.id,
      );
      return annotation ? selectionClassForAnnotation(annotation) : null;
    }
    case "drafting": {
      const object = document.drafting?.objects.find(
        (candidate) => candidate.id === hit.id,
      );
      return object ? selectionClassForDrafting(object) : null;
    }
  }
}

export function selectionFilterAllowsCanvasHit(
  filter: SelectionFilter,
  document: SchematicDocument,
  hit: SelectableCanvasHit,
): boolean {
  if (hit.kind === "handle") return true;
  const kind = selectionClassForCanvasHit(document, hit);
  // A stale DOM node is not an eligible target; filtering it lets the next
  // live object in the paint stack answer the press instead.
  return kind !== null && filter[kind];
}

export function selectionFilterAllowsAnnotation(
  filter: SelectionFilter,
  annotation: Annotation,
): boolean {
  return filter[selectionClassForAnnotation(annotation)];
}

export function selectionFilterAllowsDrafting(
  filter: SelectionFilter,
  object: DraftingObject,
): boolean {
  return filter[selectionClassForDrafting(object)];
}

/** Collect the same five persisted selection families as Ctrl/Cmd+A. */
export function selectionForDocument(
  document: SchematicDocument,
  filter: SelectionFilter,
): VisualSelection {
  return {
    instanceIds: filter.instance
      ? document.instances
          .filter((instance) => instance.placement)
          .map((instance) => instance.id)
      : [],
    routeIds: filter.route ? document.routes.map((route) => route.id) : [],
    junctionIds: filter.junction
      ? document.junctions.map((junction) => junction.id)
      : [],
    annotationIds: document.annotations
      .filter((annotation) =>
        selectionFilterAllowsAnnotation(filter, annotation),
      )
      .map((annotation) => annotation.id),
    draftingIds: (document.drafting?.objects ?? [])
      .filter((object) => selectionFilterAllowsDrafting(filter, object))
      .map((object) => object.id),
  };
}
