import type {
  Annotation,
  Orientation,
  Point,
  SchematicDocument,
} from "@icm/model";
import {
  INSTANCE_LABEL_SIDES,
  instanceGroupLabel,
  instanceLabelGroupSeat,
  instanceValueRowOffset,
  placeUprightInstanceLabel,
  seatedInstanceLabelGroup,
  transformedSide,
  type InstanceLabelGroupSeat,
  type InstanceLabelPlacement,
  type InstanceLabelSide,
} from "@icm/derived";
import type { SymbolResolver } from "@icm/symbols";

/** Unit screen-space normal pointing outward from one side of a part. */
function sideNormal(side: InstanceLabelSide): Point {
  switch (side) {
    case "right":
      return { x: 1, y: 0 };
    case "left":
      return { x: -1, y: 0 };
    case "bottom":
      return { x: 0, y: 1 };
    case "top":
      return { x: 0, y: -1 };
  }
}

export function rotatedSide(
  side: InstanceLabelSide,
  rotateVector: (vector: Point) => Point,
): InstanceLabelSide {
  const next = rotateVector(sideNormal(side));
  if (next.x > 0) return "right";
  if (next.x < 0) return "left";
  return next.y > 0 ? "bottom" : "top";
}

function decomposeSideOffset(
  side: InstanceLabelSide,
  delta: Point,
): { outward: number; shift: Point } {
  switch (side) {
    case "right":
      return { outward: delta.x, shift: { x: 0, y: delta.y } };
    case "left":
      return { outward: -delta.x, shift: { x: 0, y: delta.y } };
    case "bottom":
      return { outward: delta.y, shift: { x: delta.x, y: 0 } };
    case "top":
      return { outward: -delta.y, shift: { x: delta.x, y: 0 } };
  }
}

export interface RotatedInstanceLabelGroup {
  name: Annotation;
  value: Annotation;
  seat: InstanceLabelGroupSeat;
  /** Extra outward clearance beyond the canonical side gap (0 for exact seats). */
  outward: number;
  /** Custom vertical row gap when user-positioned, else null for canonical row. */
  rowDelta: number | null;
}

/**
 * Recognizes a part's name + value standing together on any side (exact seat
 * or a nearby side-parallel pair such as labels snapped to the 5-unit grid)
 * so rotating the part preserves their relative relationship and name-first
 * vertical stack.
 */
export function rotatedInstanceLabelGroupSeat(
  document: SchematicDocument,
  instance: SchematicDocument["instances"][number],
  resolved: NonNullable<ReturnType<SymbolResolver["resolve"]>>,
  position: Point,
  orientation: Orientation,
  findValueAnnotation: (
    doc: Pick<SchematicDocument, "annotations">,
    instanceId: string,
  ) => Annotation | null,
): RotatedInstanceLabelGroup | null {
  const names = document.annotations.filter(
    (annotation) =>
      annotation.kind === "instance-label" &&
      annotation.anchor.kind === "object" &&
      annotation.anchor.objectId === instance.id,
  );
  const name = names.find((label) => label.visible !== false) ?? names[0];
  const value = findValueAnnotation(document, instance.id);
  if (!name || !value || name.rotation !== 0 || value.rotation !== 0) {
    return null;
  }
  const nameLabel = instanceGroupLabel(document, name, position);
  const valueLabel = instanceGroupLabel(document, value, position);
  if (!nameLabel || !valueLabel) return null;
  const placedInstance = {
    ...instance,
    placement: { position, ...orientation },
  };
  const exactSeat = instanceLabelGroupSeat(
    placedInstance,
    resolved,
    document.presentation.grid,
    nameLabel,
    valueLabel,
  );
  if (exactSeat) {
    return { name, value, seat: exactSeat, outward: 0, rowDelta: null };
  }
  if (
    name.visible === false ||
    value.visible === false ||
    name.alignment !== value.alignment
  ) {
    return null;
  }
  const grid = document.presentation.grid;
  const canonicalRow = instanceValueRowOffset(
    instance.symbolId,
    nameLabel.profile,
    grid,
  );
  const rowDelta = valueLabel.position.y - nameLabel.position.y;
  if (Math.abs(rowDelta - canonicalRow) > grid / 2) return null;
  const maxOutward = grid;
  const maxShift = 3 * grid;
  for (const localSide of INSTANCE_LABEL_SIDES) {
    const worldSide = transformedSide(localSide, placedInstance);
    if (!worldSide) continue;
    const baseName = placeUprightInstanceLabel(
      placedInstance,
      resolved,
      nameLabel.profile,
      { x: 0, y: 0 },
      localSide,
      grid,
      nameLabel.sizeScale,
      "reference-over-value",
    );
    const baseValue = placeUprightInstanceLabel(
      placedInstance,
      resolved,
      valueLabel.profile,
      { x: 0, y: 0 },
      localSide,
      grid,
      valueLabel.sizeScale,
      "value",
    );
    if (!baseName || !baseValue) continue;
    if (nameLabel.alignment !== baseName.alignment) continue;
    if (Math.abs(nameLabel.position.x - valueLabel.position.x) > 2) continue;
    const anchor = worldSide === "top" ? valueLabel : nameLabel;
    const baseAnchor = worldSide === "top" ? baseValue : baseName;
    const { outward, shift } = decomposeSideOffset(worldSide, {
      x: anchor.position.x - baseAnchor.position.x,
      y: anchor.position.y - baseAnchor.position.y,
    });
    if (
      outward < -2 ||
      outward > maxOutward ||
      Math.hypot(shift.x, shift.y) > maxShift
    ) {
      continue;
    }
    return {
      name,
      value,
      seat: { side: worldSide, shift },
      outward,
      rowDelta,
    };
  }
  return null;
}

export function placeRotatedInstanceLabelGroup(
  document: SchematicDocument,
  instance: SchematicDocument["instances"][number],
  resolved: NonNullable<ReturnType<SymbolResolver["resolve"]>>,
  group: RotatedInstanceLabelGroup,
  side: InstanceLabelSide,
  shift: Point,
): { name: InstanceLabelPlacement; value: InstanceLabelPlacement } | null {
  const position = instance.placement?.position;
  if (!position) return null;
  const nameLabel = instanceGroupLabel(document, group.name, position);
  const valueLabel = instanceGroupLabel(document, group.value, position);
  if (!nameLabel || !valueLabel) return null;
  const seated = seatedInstanceLabelGroup(
    instance,
    resolved,
    document.presentation.grid,
    { side, shift },
    nameLabel,
    valueLabel,
  );
  if (!seated) return null;
  const normal = sideNormal(side);
  const outX = normal.x * group.outward;
  const outY = normal.y * group.outward;
  const placedName = {
    alignment: seated.name.alignment,
    position: {
      x: Math.round(seated.name.position.x + outX),
      y: Math.round(seated.name.position.y + outY),
    },
  };
  const placedValue = {
    alignment: seated.value.alignment,
    position: {
      x: Math.round(seated.value.position.x + outX),
      y: Math.round(seated.value.position.y + outY),
    },
  };
  if (group.rowDelta !== null) {
    if (side === "top") {
      placedName.position.y = placedValue.position.y - group.rowDelta;
    } else {
      placedValue.position.y = placedName.position.y + group.rowDelta;
    }
  }
  return { name: placedName, value: placedValue };
}
