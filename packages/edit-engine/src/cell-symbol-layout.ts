import {
  CellSymbolPresentationSchema,
  type CellSymbolPresentation,
  type CellSymbolSide,
  type Point,
} from "@icm/model";
import {
  createBlockSymbol,
  hierarchicalBlockPinSlots,
  type BlockSymbolLayout,
} from "@icm/symbols";

export type CellSymbolBodyBounds = NonNullable<
  CellSymbolPresentation["bodyBounds"]
>;
export type CellSymbolGrip =
  CellSymbolSide | "north-west" | "north-east" | "south-west" | "south-east";
export type BlockSymbolLayoutAction =
  | { kind: "resize"; grip: CellSymbolGrip; point: Point }
  | {
      kind: "move-pins";
      terminalIds: readonly string[];
      delta: Point;
      side?: CellSymbolSide;
    }
  | {
      kind: "arrange-pins";
      terminalIds: readonly string[];
      side: CellSymbolSide;
    }
  | { kind: "space-pins"; terminalIds: readonly string[] };
export type BlockSymbolLayoutProposal =
  | { ok: true; changed: boolean; presentation: CellSymbolPresentation }
  | { ok: false; reason: string };

const snap = (value: number) => Math.round(value / 10) * 10;
const vertical = (side: CellSymbolSide) => side === "west" || side === "east";

/** One geometry proposal for pointer feedback and atomic Project commits. */
export function proposeBlockSymbolLayout(
  layout: BlockSymbolLayout,
  action: BlockSymbolLayoutAction,
): BlockSymbolLayoutProposal {
  const symbol = createBlockSymbol(layout);
  const polygon = symbol.primitives.find((item) => item.kind === "polygon")!;
  if (polygon.kind !== "polygon")
    return { ok: false, reason: "Cell has no editable body" };
  const bodyBounds = {
    left: Math.min(...polygon.points.map((point) => point.x)),
    right: Math.max(...polygon.points.map((point) => point.x)),
    top: Math.min(...polygon.points.map((point) => point.y)),
    bottom: Math.max(...polygon.points.map((point) => point.y)),
  };
  let pinPlacements = hierarchicalBlockPinSlots(
    layout.terminals,
    layout.presentation,
  );
  const originalBounds = { ...bodyBounds };
  const originalPins = pinPlacements;
  if (action.kind === "resize") {
    const { grip, point } = action;
    if (grip.includes("west")) bodyBounds.left = snap(point.x);
    if (grip.includes("east")) bodyBounds.right = snap(point.x);
    if (grip.includes("north")) bodyBounds.top = snap(point.y);
    if (grip.includes("south")) bodyBounds.bottom = snap(point.y);
  } else {
    const ids = new Set(action.terminalIds);
    const selected = pinPlacements.filter((pin) => ids.has(pin.terminalId));
    if (!selected.length || selected.length !== ids.size)
      return { ok: false, reason: "Select existing Cell pins first" };
    if (action.kind === "move-pins") {
      if (action.side && new Set(selected.map((pin) => pin.side)).size > 1)
        return {
          ok: false,
          reason: "Arrange mixed-side pins on an explicit side first",
        };
      pinPlacements = pinPlacements.map((pin) => {
        if (!ids.has(pin.terminalId)) return pin;
        const side = action.side ?? pin.side;
        return {
          ...pin,
          side,
          offset:
            pin.offset + snap(vertical(side) ? action.delta.y : action.delta.x),
        };
      });
    } else {
      const sides = new Set(selected.map((pin) => pin.side));
      if (
        action.kind === "space-pins" &&
        (sides.size !== 1 || selected.length < 3)
      )
        return {
          ok: false,
          reason: "Equal spacing needs at least three pins on one side",
        };
      const order = ["west", "north", "east", "south"];
      selected.sort(
        (a, b) =>
          order.indexOf(a.side) - order.indexOf(b.side) || a.offset - b.offset,
      );
      const side =
        action.kind === "arrange-pins" ? action.side : selected[0]!.side;
      const span =
        sides.size === 1
          ? selected.at(-1)!.offset - selected[0]!.offset
          : (selected.length - 1) * 20;
      const start =
        action.kind === "arrange-pins"
          ? snap(
              (vertical(side)
                ? bodyBounds.top + bodyBounds.bottom
                : bodyBounds.left + bodyBounds.right) /
                2 -
                span / 2,
            )
          : selected[0]!.offset;
      const step =
        action.kind === "arrange-pins"
          ? 20
          : (selected.at(-1)!.offset - start) / (selected.length - 1);
      if (step < 10 || step % 10 !== 0)
        return {
          ok: false,
          reason:
            "Equal spacing must leave distinct 10-unit grid slots; adjust the outer pins first",
        };
      const arranged = new Map(
        selected.map((pin, index) => [
          pin.terminalId,
          {
            ...pin,
            side,
            offset:
              action.kind === "arrange-pins" && sides.size === 1
                ? start + pin.offset - selected[0]!.offset
                : start + index * step,
          },
        ]),
      );
      pinPlacements = pinPlacements.map(
        (pin) => arranged.get(pin.terminalId) ?? pin,
      );
    }
  }
  const occupied = new Set<string>();
  for (const pin of pinPlacements) {
    const key = `${pin.side}:${pin.offset}`;
    if (occupied.has(key))
      return {
        ok: false,
        reason: `Pin slot ${key} is occupied; nothing changed`,
      };
    occupied.add(key);
  }
  const presentation = { ...layout.presentation, bodyBounds, pinPlacements };
  const parsed = CellSymbolPresentationSchema.safeParse(presentation);
  const changed =
    Object.keys(bodyBounds).some(
      (key) =>
        bodyBounds[key as keyof CellSymbolBodyBounds] !==
        originalBounds[key as keyof CellSymbolBodyBounds],
    ) ||
    pinPlacements.some(
      (pin, index) =>
        pin.side !== originalPins[index]!.side ||
        pin.offset !== originalPins[index]!.offset,
    );
  return parsed.success
    ? { ok: true, changed, presentation: parsed.data }
    : { ok: false, reason: parsed.error.issues[0]!.message };
}

/**
 * A block resized to `size` (the editor's resize and the Agent's
 * set-cell-symbol-size, #1879): the size is stored as the body's minimum, and
 * explicit edges keep their top-left corner.
 */
export function resizeCellSymbolPresentation(
  presentation: CellSymbolPresentation | undefined,
  size: { readonly width: number; readonly height: number },
): CellSymbolPresentation {
  const { width, height } = size;
  return {
    ...presentation,
    ...(presentation?.bodyBounds
      ? {
          bodyBounds: {
            ...presentation.bodyBounds,
            right: presentation.bodyBounds.left + width,
            bottom: presentation.bodyBounds.top + height,
          },
        }
      : {}),
    minimumBodySize: { width, height },
  };
}
