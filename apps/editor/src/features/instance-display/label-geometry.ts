import type { Annotation, Point, Rect, SchematicDocument } from "@icm/model";
import {
  defaultInstanceParameterLabelPlacement,
  instanceLabelRowOffset,
  instanceValueRowOffset,
  objectStyleProfile,
  offsetFromPlacement,
  valuePrintsMultiplier,
  type InstanceLabelPlacement,
  type SchematicStyleProfile,
  type createLabelClearanceContext,
} from "@icm/derived";
import type { SchematicEdit } from "@icm/edit-engine";
import type { SymbolResolver } from "@icm/symbols";
import { draggedAnnotationAtPosition } from "../text-editing/annotation-drag-model";

export type LabelClearanceContext = ReturnType<
  typeof createLabelClearanceContext
>;

/**
 * How far, in grid steps, a repaired label may stand from its own part: a
 * group's two rows above it (#2619).
 */
export const OWNER_REACH_STEPS = 2;
/** How much nearer another part a label may stand than its own part. */
export const ASSOCIATION_MARGIN = 5;
/**
 * Least gaps between a label and its part's own wires, as between two
 * labels: a word space before or after it, a line space above or below.
 */
export const OWN_WIRE_SPACE = 4;
export const OWN_WIRE_LINE_SPACE = 1;
/**
 * About a character of a label's text, in ems: 10 units at the default
 * size. Two labels on one row nearer than this read as one run (#1412).
 */
export const CHARACTER_EM = 0.66;

const shiftsByGrid = new Map<number, readonly Point[]>();

/**
 * Shifts of a label within `reach` fifths of a grid step (three steps by
 * default), a fifth of a step apart, nearest first.
 */
export function nearbyShifts(grid: number, reach = 15): readonly Point[] {
  const key = grid * 1000 + reach;
  let shifts = shiftsByGrid.get(key);
  if (!shifts) {
    const step = grid / 5;
    const all: Point[] = [];
    for (let x = -reach; x <= reach; x++)
      for (let y = -reach; y <= reach; y++)
        if (x || y) all.push({ x: x * step, y: y * step });
    shifts = all.sort(
      (a, b) =>
        Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y) || a.y - b.y || a.x - b.x,
    );
    shiftsByGrid.set(key, shifts);
  }
  return shifts;
}

/** Whether two labels' ink shares a row: half the shorter one's height. */
export function sameRow(a: Rect, b: Rect): boolean {
  return (
    Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) >=
    Math.min(a.height, b.height) / 2
  );
}

/**
 * The parameter of a MOS's ×m label, which its W/L prints while shown
 * (#1423), or undefined.
 */
export function multiplierLabel(
  label: Annotation,
  instance: SchematicDocument["instances"][number],
  resolver: SymbolResolver,
): string | undefined {
  const binding = label.binding;
  return binding?.kind === "instance-value" &&
    binding.parameter !== undefined &&
    valuePrintsMultiplier(instance, binding.parameter, resolver)
    ? binding.parameter
    : undefined;
}

/** A placed Cell's name under its block, drawn as literal text (#803). */
export function isCellNameLabel(label: Annotation): boolean {
  return (
    label.anchor.kind === "object" &&
    label.id === `instance-master-${label.anchor.objectId}` &&
    label.content !== undefined
  );
}

/**
 * The part a label names, and whether it reads as its name or its value. A
 * placed Cell's name stands in its Reference's slot while the Reference is
 * hidden, as a new Cell's does, and in its value's slot beside it (#1366).
 */
export function partLabelOf(
  label: Annotation,
  visible: readonly Annotation[],
): {
  instanceId: string;
  kind: "instance-reference" | "instance-value";
} | null {
  const binding = label.binding;
  if (
    binding?.kind === "instance-reference" ||
    binding?.kind === "instance-value"
  )
    return { instanceId: binding.instanceId, kind: binding.kind };
  if (!isCellNameLabel(label) || label.anchor.kind !== "object") return null;
  const instanceId = label.anchor.objectId;
  return {
    instanceId,
    kind: visible.some(
      (other) =>
        other.binding?.kind === "instance-reference" &&
        other.binding.instanceId === instanceId,
    )
      ? "instance-value"
      : "instance-reference",
  };
}

/**
 * Whether text at `next` reads after text at `first`: below it, or after it
 * on its line.
 */
export function readsAfter(first: Rect, next: Rect): boolean {
  const slack = 1;
  return (
    next.y >= first.y + first.height - slack ||
    (next.x >= first.x + first.width - slack &&
      next.y < first.y + first.height &&
      next.y + next.height > first.y)
  );
}

/** Stacked or on one line, and whether the name reads before its value. */
export function readOrder(
  name: Rect,
  value: Rect,
): { stacked: boolean; nameFirst: boolean } {
  const dx = centre(value).x - centre(name).x;
  const dy = centre(value).y - centre(name).y;
  const stacked = Math.abs(dy) >= Math.abs(dx);
  return { stacked, nameFirst: (stacked ? dy : dx) > 0 };
}

/** The sides of its part a label box stands wholly beyond. */
export function sidesOf(
  ink: Rect,
  owner: Rect,
): { left: boolean; right: boolean; above: boolean; below: boolean } {
  return {
    left: ink.x + ink.width <= owner.x,
    right: ink.x >= owner.x + owner.width,
    above: ink.y + ink.height <= owner.y,
    below: ink.y >= owner.y + owner.height,
  };
}

export function rectangleGap(a: Rect, b: Rect): number {
  return Math.hypot(
    Math.max(0, a.x - b.x - b.width, b.x - a.x - a.width),
    Math.max(0, a.y - b.y - b.height, b.y - a.y - a.height),
  );
}

export function overlap(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/** The bounding box around every one of `boxes`. */
export function union(boxes: readonly Rect[]): Rect {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return {
    x,
    y,
    width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
    height: Math.max(...boxes.map((b) => b.y + b.height)) - y,
  };
}

export function centre(box: Rect): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** `box` grown by `by` on every side. */
export function grown(box: Rect, by: number): Rect {
  return {
    x: box.x - by,
    y: box.y - by,
    width: box.width + 2 * by,
    height: box.height + 2 * by,
  };
}

/** Gap between a point and a box, 0 inside it. */
export function pointGap(point: Point, box: Rect): number {
  return Math.hypot(
    Math.max(0, box.x - point.x, point.x - box.x - box.width),
    Math.max(0, box.y - point.y, point.y - box.y - box.height),
  );
}

/** The annotation drawn at `placement`, keeping its anchor on its part. */
export function annotationAt(
  document: SchematicDocument,
  resolver: SymbolResolver,
  annotation: Annotation,
  placement: InstanceLabelPlacement,
): Annotation {
  return {
    ...draggedAnnotationAtPosition(
      { document, resolver, annotationGrid: 1, routeGeometryRecords: [] },
      annotation,
      placement.position,
    ),
    alignment: placement.alignment,
  };
}

/**
 * Keeps hidden MOS `×m` labels aligned with their moved Reference/W/L (#1434).
 */
export function followHiddenMultiplierEdits(args: {
  document: SchematicDocument;
  resolver: SymbolResolver;
  context: LabelClearanceContext;
  documentProfile: SchematicStyleProfile;
  grid: number;
  edits: readonly SchematicEdit[];
  ownLabels: ReadonlyMap<string, readonly Annotation[]>;
  arrangedGroupIds: ReadonlyMap<string, ReadonlySet<string>>;
  includeManual: boolean;
}): SchematicEdit[] {
  const {
    document,
    resolver,
    context,
    documentProfile,
    grid,
    edits,
    ownLabels,
    arrangedGroupIds,
    includeManual,
  } = args;
  const arranged = new Map(
    edits.flatMap((edit) =>
      edit.kind === "upsert_schematic_annotation"
        ? [[edit.annotation.id, edit.annotation] as const]
        : [],
    ),
  );
  const placeOf = (annotation: Annotation): InstanceLabelPlacement => {
    const { position, alignment } = context.measure(annotation);
    return { position, alignment };
  };
  const followed: SchematicEdit[] = [];
  for (const [id, groupLabelIds] of arrangedGroupIds) {
    const instance = document.instances.find((item) => item.id === id);
    if (!instance) continue;
    const resolved = resolver.resolve(
      instance.symbolId,
      instance.symbolVariantId,
    );
    const drawn = ownLabels.get(id) ?? [];
    const name = drawn.find(
      (label) => label.binding?.kind === "instance-reference",
    );
    const value = drawn.find(
      (label) =>
        label.binding?.kind === "instance-value" &&
        label.binding.parameter === undefined,
    );
    const lead = name ?? value;
    const moved = lead && arranged.get(lead.id);
    if (
      !resolved ||
      !lead ||
      !moved ||
      moved.visible === false ||
      offsetFromPlacement(placeOf(moved), placeOf(lead))
    )
      continue;
    const owner = context.symbols.find((symbol) => symbol.id === id)?.bounds;
    const above =
      name !== undefined &&
      owner !== undefined &&
      moved.alignment === "middle" &&
      context.measure(moved).inkBounds.y +
        context.measure(moved).inkBounds.height <=
        owner.y;
    const valueNow =
      value && groupLabelIds.has(value.id) && (arranged.get(value.id) ?? value);
    const visibleValueNow =
      valueNow && valueNow.visible !== false ? valueNow : undefined;
    if (above && !visibleValueNow) continue;
    for (const label of document.annotations) {
      const parameter = multiplierLabel(label, instance, resolver);
      if (
        parameter === undefined ||
        label.anchor.kind !== "object" ||
        label.anchor.objectId !== id ||
        context.visible.includes(label) ||
        label.locked ||
        label.rotation !== 0 ||
        label.content ||
        label.formatOverride
      )
        continue;
      const style = objectStyleProfile(documentProfile, label);
      const below = (
        annotation: Annotation,
        row: number,
      ): InstanceLabelPlacement => {
        const { position, alignment } = placeOf(annotation);
        return {
          position: { x: position.x, y: position.y + row },
          alignment,
        };
      };
      const row = instanceLabelRowOffset(style, grid);
      const places = [
        defaultInstanceParameterLabelPlacement(
          instance,
          resolved,
          style,
          grid,
          parameter,
          resolver,
        ),
        ...(value ? [placeOf(value)] : []),
        ...(name
          ? [
              below(name, row),
              below(
                name,
                instanceValueRowOffset(instance.symbolId, style, grid),
              ),
            ]
          : []),
      ];
      if (
        !includeManual &&
        !places.some((place) => offsetFromPlacement(placeOf(label), place))
      )
        continue;
      const target =
        name && !above
          ? below(moved, row)
          : visibleValueNow && placeOf(visibleValueNow);
      if (!target) continue;
      const next = annotationAt(document, resolver, label, target);
      if (JSON.stringify(next) !== JSON.stringify(label))
        followed.push({
          kind: "upsert_schematic_annotation",
          annotation: next,
        });
    }
  }
  return followed;
}
