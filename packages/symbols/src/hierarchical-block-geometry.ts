import { flattenRichText, resolveCellSymbolPinPlacements } from "@icm/model";
import type {
  CellSymbolPresentation,
  CellSymbolSide,
  RichTextDocument,
} from "@icm/model";

import type { SymbolDefinition, SymbolPin } from "./schema.js";

const PIN_LEAD = 10;
const ROW_PITCH = 20;
const BODY_PADDING = 20;
const MINIMUM_BODY_WIDTH = 80;
const MINIMUM_BODY_HEIGHT = 40;
/**
 * Half the body height a top or bottom Pin's name needs beyond the nearest
 * side-Pin row, so that the two names clear each other by about 3. Pin names
 * (15.1 high, capitals 10.9) stand on a baseline 18 below the top edge and
 * 10 above the bottom one, 4 below a side Pin's row. A supply's name is
 * often drawn V_DD, and its subscript drops 6.7 below the baseline: at 30,
 * the DD of an inverter's V_DD stood 1.5 above its "out".
 */
const NAME_ROW_CLEARANCE = 35;
/** Room between a top or bottom Pin's name and the body's side edges. */
const NAME_EDGE_INSET = 4;

export interface HierarchicalBlockLayoutOptions {
  /**
   * Size the body so that each top or bottom Pin's name clears the side
   * Pins' names and the body's sides. Only for a Cell no parent has placed
   * yet: a placed block's Pins must never move under its wires.
   */
  readonly fitNames?: boolean | undefined;
}

export interface HierarchicalBlockTerminal {
  readonly id: string;
  readonly name: string;
  readonly direction: "input" | "output" | "inout" | "passive";
  readonly nameContent?: RichTextDocument;
  readonly signalMembers?: Array<{ id: string; name: string }>;
}

interface PinSlot {
  readonly terminal: HierarchicalBlockTerminal;
  readonly side: CellSymbolSide;
  readonly offset: number;
}

function roundUp(value: number, multiple = 20): number {
  return Math.ceil(value / multiple) * multiple;
}

function estimatedLabelWidth(terminal: HierarchicalBlockTerminal): number {
  // Geometry must not depend on the caller's style profile. This conservative
  // local estimate bounds shared RichText pin labels without persisting text.
  // A Pin's display alias can be longer than its name; the body makes room
  // for whichever is longer, so a name's own look never narrows it.
  const shown = terminal.nameContent
    ? flattenRichText(terminal.nameContent).length
    : 0;
  return Math.max(20, Math.max(terminal.name.length, shown) * 10);
}

function automaticOffsets(): number[] {
  const result = [0];
  for (let distance = ROW_PITCH; distance <= 2000; distance += ROW_PITCH) {
    result.push(-distance, distance);
  }
  return result;
}

function resolvePinSlots(
  terminals: readonly HierarchicalBlockTerminal[],
  presentation: CellSymbolPresentation | undefined,
): PinSlot[] {
  const slots = resolveCellSymbolPinPlacements(terminals, presentation);
  return terminals.map((terminal, index) => ({
    terminal,
    side: slots[index]!.side,
    offset: slots[index]!.offset,
  }));
}

/** Where a Pin stands on a block: its side and its offset along that side. */
export interface HierarchicalBlockPinSlot {
  readonly terminalId: string;
  readonly side: CellSymbolSide;
  readonly offset: number;
}

/**
 * Where each Pin stands on the block, in terminal order: at its stored
 * placement, or at the automatic slot the block gives a Pin without one.
 */
export function hierarchicalBlockPinSlots(
  terminals: readonly HierarchicalBlockTerminal[],
  presentation?: CellSymbolPresentation,
): HierarchicalBlockPinSlot[] {
  return resolvePinSlots(terminals, presentation).map((slot) => ({
    terminalId: slot.terminal.id,
    side: slot.side,
    offset: slot.offset,
  }));
}

/**
 * The offsets along one side a Pin may still take, in the order an automatic
 * Pin takes them (0, -20, 20, -40, 40, …): those a full row from every
 * offset in `taken`, so no two Pin names share a row. On the 20-unit rows
 * the automatic layout uses, that is every slot `taken` leaves free; beside
 * a Pin drawn between two rows (offset 10), it keeps a row's distance.
 */
export function freeHierarchicalBlockOffsets(
  taken: Iterable<number>,
): number[] {
  const held = [...taken];
  return automaticOffsets().filter((offset) =>
    held.every((other) => Math.abs(other - offset) >= ROW_PITCH),
  );
}

function bodySize(
  slots: readonly PinSlot[],
  minimum: CellSymbolPresentation["minimumBodySize"] | undefined,
  options: HierarchicalBlockLayoutOptions = {},
): { width: number; height: number } {
  const westLabels = slots
    .filter((slot) => slot.side === "west")
    .map((slot) => estimatedLabelWidth(slot.terminal));
  const eastLabels = slots
    .filter((slot) => slot.side === "east")
    .map((slot) => estimatedLabelWidth(slot.terminal));
  const maxHorizontalOffset = Math.max(
    0,
    ...slots
      .filter((slot) => slot.side === "north" || slot.side === "south")
      .map((slot) => Math.abs(slot.offset)),
  );
  const maxVerticalOffset = Math.max(
    0,
    ...slots
      .filter((slot) => slot.side === "west" || slot.side === "east")
      .map((slot) => Math.abs(slot.offset)),
  );
  let width = Math.max(
    MINIMUM_BODY_WIDTH,
    minimum?.width ?? 0,
    maxHorizontalOffset * 2 + BODY_PADDING * 2,
    Math.max(...westLabels, 0) + Math.max(...eastLabels, 0) + BODY_PADDING,
  );
  let height = Math.max(
    MINIMUM_BODY_HEIGHT,
    minimum?.height ?? 0,
    maxVerticalOffset * 2 + BODY_PADDING * 2,
  );
  if (options.fitNames) {
    // An inverter Cell with a VDD Pin on top read "in V_DDout": on a body
    // 40 high, the top name shares the side names' row.
    const sideOffsets = slots
      .filter((slot) => slot.side === "west" || slot.side === "east")
      .map((slot) => slot.offset);
    const ends = slots.filter(
      (slot) => slot.side === "north" || slot.side === "south",
    );
    if (sideOffsets.length && ends.some((slot) => slot.side === "north"))
      height = Math.max(
        height,
        2 * (NAME_ROW_CLEARANCE - Math.min(...sideOffsets)),
      );
    if (sideOffsets.length && ends.some((slot) => slot.side === "south"))
      height = Math.max(
        height,
        2 * (NAME_ROW_CLEARANCE + Math.max(...sideOffsets)),
      );
    for (const slot of ends)
      width = Math.max(
        width,
        2 *
          (Math.abs(slot.offset) +
            estimatedLabelWidth(slot.terminal) / 2 +
            NAME_EDGE_INSET),
      );
  }
  // Centre-based body edges need a half-size on the 10-unit pin grid.
  return { width: roundUp(width), height: roundUp(height) };
}

/** The body size a Cell's block takes for these Pins. */
export function hierarchicalBlockBodySize(
  terminals: readonly HierarchicalBlockTerminal[],
  presentation?: CellSymbolPresentation,
  options: HierarchicalBlockLayoutOptions = {},
): { width: number; height: number } {
  if (presentation?.bodyBounds) {
    const { left, right, top, bottom } = presentation.bodyBounds;
    return { width: right - left, height: bottom - top };
  }
  return bodySize(
    resolvePinSlots(terminals, presentation),
    presentation?.minimumBodySize,
    options,
  );
}

/** Conservative name clearance advice; explicit edges are never changed. */
export function hierarchicalBlockLabelWarnings(
  terminals: readonly HierarchicalBlockTerminal[],
  presentation?: CellSymbolPresentation,
): string[] {
  const bounds = presentation?.bodyBounds;
  if (!bounds) return [];
  const boxes = resolvePinSlots(terminals, presentation).map(
    ({ terminal, side, offset }) => {
      const width = estimatedLabelWidth(terminal);
      const x =
        side === "west"
          ? bounds.left + 4
          : side === "east"
            ? bounds.right - 4 - width
            : offset - width / 2;
      const baseline =
        side === "north"
          ? bounds.top + 18
          : side === "south"
            ? bounds.bottom - 10
            : offset + 4;
      return { name: terminal.name, x, y: baseline - 12, width, height: 16 };
    },
  );
  const crowded = new Set<string>();
  for (const [index, box] of boxes.entries()) {
    if (
      box.x < bounds.left ||
      box.x + box.width > bounds.right ||
      box.y < bounds.top ||
      box.y + box.height > bounds.bottom
    )
      crowded.add(box.name);
    for (const other of boxes.slice(index + 1))
      if (
        box.x < other.x + other.width &&
        box.x + box.width > other.x &&
        box.y < other.y + other.height &&
        box.y + box.height > other.y
      ) {
        crowded.add(box.name);
        crowded.add(other.name);
      }
  }
  return crowded.size
    ? [
        `Pin names may overlap or exceed this body: ${[...crowded].join(", ")}. Resize or move pins; explicit edges are kept.`,
      ]
    : [];
}

function pinForSlot(
  slot: PinSlot,
  bounds: { left: number; right: number; top: number; bottom: number },
): SymbolPin {
  const presentation = {
    visibility: "visible" as const,
    leadLength: PIN_LEAD,
    showName: true,
  };
  switch (slot.side) {
    case "west":
      return {
        name: slot.terminal.name,
        role: "hierarchical-port",
        at: { x: bounds.left - PIN_LEAD, y: slot.offset },
        direction: "west",
        presentation,
      };
    case "east":
      return {
        name: slot.terminal.name,
        role: "hierarchical-port",
        at: { x: bounds.right + PIN_LEAD, y: slot.offset },
        direction: "east",
        presentation,
      };
    case "north":
      return {
        name: slot.terminal.name,
        role: "hierarchical-port",
        at: { x: slot.offset, y: bounds.top - PIN_LEAD },
        direction: "north",
        presentation,
      };
    case "south":
      return {
        name: slot.terminal.name,
        role: "hierarchical-port",
        at: { x: slot.offset, y: bounds.bottom + PIN_LEAD },
        direction: "south",
        presentation,
      };
  }
}

function leadToBody(
  pin: SymbolPin,
  bounds: { left: number; right: number; top: number; bottom: number },
) {
  switch (pin.direction) {
    case "west":
      return { x: bounds.left, y: pin.at.y };
    case "east":
      return { x: bounds.right, y: pin.at.y };
    case "north":
      return { x: pin.at.x, y: bounds.top };
    case "south":
      return { x: pin.at.x, y: bounds.bottom };
  }
}

/** Geometry used only for a Project's derived subcircuit navigation blocks. */
export function createHierarchicalBlockGeometry(
  terminals: readonly HierarchicalBlockTerminal[],
  presentation?: CellSymbolPresentation,
  options: HierarchicalBlockLayoutOptions = {},
): SymbolDefinition {
  const slots = resolvePinSlots(terminals, presentation);
  const { width, height } = hierarchicalBlockBodySize(
    terminals,
    presentation,
    options,
  );
  const bounds = presentation?.bodyBounds ?? {
    left: -width / 2,
    right: width / 2,
    top: -height / 2,
    bottom: height / 2,
  };
  const { left, right, top, bottom } = bounds;
  const pins = slots.map((slot) => pinForSlot(slot, bounds));
  return {
    schemaVersion: 1,
    id: "derived-hierarchical-block",
    name: "Hierarchical Block",
    viewBox: {
      x: left - PIN_LEAD,
      y: top - PIN_LEAD,
      width: width + PIN_LEAD * 2,
      height: height + PIN_LEAD * 2,
    },
    pins,
    primitives: [
      {
        kind: "polygon",
        points: [
          { x: left, y: top },
          { x: right, y: top },
          { x: right, y: bottom },
          { x: left, y: bottom },
        ],
        fill: "none",
        fillableBody: true,
        stroke: "foreground",
      },
      ...pins.map((pin) => ({
        kind: "line" as const,
        from: pin.at,
        to: leadToBody(pin, bounds),
      })),
    ],
    variants: [],
  };
}
