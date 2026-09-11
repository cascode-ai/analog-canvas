/** Shared geometry operation; each DMOS still owns a complete component file. */
export function deriveDmosSymbol(base, id, name) {
  if (!base) throw new Error(`Missing Extended Devices base Symbol for ${id}`);
  const baseId = base.id;
  const drainPin = base.pins.find((pin) => pin.name === "D");
  if (!drainPin)
    throw new Error(`Missing drain pin for Expanded Device: ${baseId}`);
  const drainBranch = base.primitives.find(
    (primitive) =>
      primitive.kind === "polyline" &&
      primitive.points.at(-1)?.x === drainPin.at.x &&
      primitive.points.at(-1)?.y === drainPin.at.y,
  );
  if (drainBranch?.kind !== "polyline")
    throw new Error(`Missing drain branch for Expanded Device: ${baseId}`);
  const branchStart = drainBranch.points[0];
  const branchEnd = drainBranch.points[1];
  if (!branchStart || !branchEnd)
    throw new Error(`Invalid drain branch for Expanded Device: ${baseId}`);
  const driftOffset = Math.sign(branchEnd.y - drainPin.at.y) * 4;
  return {
    ...base,
    id,
    name,
    primitives: [
      ...base.primitives,
      {
        kind: "polyline",
        points: [
          { x: branchStart.x, y: branchStart.y + driftOffset },
          { x: branchEnd.x, y: branchEnd.y + driftOffset },
          branchEnd,
        ],
        part: "drift-region",
        style: drainBranch.style,
      },
    ],
    variants: base.variants.map((variant) => ({
      ...variant,
      id:
        variant.id === base.defaultVariantId
          ? "standard-3terminal"
          : variant.id,
    })),
    defaultVariantId: "standard-3terminal",
  };
}
