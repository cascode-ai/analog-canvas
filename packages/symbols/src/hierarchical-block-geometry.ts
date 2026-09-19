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

export interface HierarchicalBlockTerminal {
  readonly id: string;
  readonly name: string;
  readonly direction: "input" | "output" | "inout" | "passive";
  readonly nameContent?: RichTextDocument;
}

interface PinSlot {
  readonly terminal: HierarchicalBlockTerminal;
  readonly side: CellSymbolSide;
  readonly offset: number;
}

function roundUp(value: number, multiple = 20): number {
  return Math.ceil(value / multiple) * multiple;
}

function estimatedLabelWidth(name: string): number {
  // Geometry must not depend on the caller's style profile. This conservative
  // local estimate bounds shared RichText pin labels without persisting text.
  return Math.max(20, name.length * 10);
}

function slotKey(side: CellSymbolSide, offset: number): string {
  return `${side}:${offset}`;
}

function automaticOffsets(): number[] {
  const result = [0];
  for (let distance = ROW_PITCH; distance <= 2000; distance += ROW_PITCH) {
    result.push(-distance, distance);
  }
  return result;
}

function nextAutomaticOffset(
  side: CellSymbolSide,
  occupied: Set<string>,
): number {
  for (const offset of automaticOffsets()) {
    if (!occupied.has(slotKey(side, offset))) return offset;
  }
  throw new Error(`No automatic hierarchy pin slot on ${side}`);
}

function defaultSide(
  terminal: HierarchicalBlockTerminal,
  westCount: number,
  eastCount: number,
): "west" | "east" {
  switch (terminal.direction) {
    case "input":
      return "west";
    case "output":
      return "east";
    case "inout":
    case "passive":
      return westCount <= eastCount ? "west" : "east";
  }
}

function resolvePinSlots(
  terminals: readonly HierarchicalBlockTerminal[],
  presentation: CellSymbolPresentation | undefined,
): PinSlot[] {
  const explicit = new Map(
    (presentation?.pinPlacements ?? []).map((placement) => [
      placement.terminalId,
      placement,
    ]),
  );
  const occupied = new Set(
    (presentation?.pinPlacements ?? []).map((placement) =>
      slotKey(placement.side, placement.offset),
    ),
  );
  let westCount = (presentation?.pinPlacements ?? []).filter(
    (placement) => placement.side === "west",
  ).length;
  let eastCount = (presentation?.pinPlacements ?? []).filter(
    (placement) => placement.side === "east",
  ).length;

  return terminals.map((terminal) => {
    const placement = explicit.get(terminal.id);
    if (placement) {
      return {
        terminal,
        side: placement.side,
        offset: placement.offset,
      };
    }
    const side = defaultSide(terminal, westCount, eastCount);
    const offset = nextAutomaticOffset(side, occupied);
    occupied.add(slotKey(side, offset));
    if (side === "west") westCount += 1;
    else eastCount += 1;
    return { terminal, side, offset };
  });
}

function bodySize(
  slots: readonly PinSlot[],
  minimum: CellSymbolPresentation["minimumBodySize"] | undefined,
): { width: number; height: number } {
  const westLabels = slots
    .filter((slot) => slot.side === "west")
    .map((slot) => estimatedLabelWidth(slot.terminal.name));
  const eastLabels = slots
    .filter((slot) => slot.side === "east")
    .map((slot) => estimatedLabelWidth(slot.terminal.name));
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
  const width = Math.max(
    MINIMUM_BODY_WIDTH,
    minimum?.width ?? 0,
    maxHorizontalOffset * 2 + BODY_PADDING * 2,
    Math.max(...westLabels, 0) + Math.max(...eastLabels, 0) + BODY_PADDING,
  );
  const height = Math.max(
    MINIMUM_BODY_HEIGHT,
    minimum?.height ?? 0,
    maxVerticalOffset * 2 + BODY_PADDING * 2,
  );
  // Centre-based body edges need a half-size on the 10-unit pin grid.
  return { width: roundUp(width), height: roundUp(height) };
}

function pinForSlot(slot: PinSlot, width: number, height: number): SymbolPin {
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
        at: { x: -width / 2 - PIN_LEAD, y: slot.offset },
        direction: "west",
        presentation,
      };
    case "east":
      return {
        name: slot.terminal.name,
        role: "hierarchical-port",
        at: { x: width / 2 + PIN_LEAD, y: slot.offset },
        direction: "east",
        presentation,
      };
    case "north":
      return {
        name: slot.terminal.name,
        role: "hierarchical-port",
        at: { x: slot.offset, y: -height / 2 - PIN_LEAD },
        direction: "north",
        presentation,
      };
    case "south":
      return {
        name: slot.terminal.name,
        role: "hierarchical-port",
        at: { x: slot.offset, y: height / 2 + PIN_LEAD },
        direction: "south",
        presentation,
      };
  }
}

function leadToBody(pin: SymbolPin, width: number, height: number) {
  switch (pin.direction) {
    case "west":
      return { x: -width / 2, y: pin.at.y };
    case "east":
      return { x: width / 2, y: pin.at.y };
    case "north":
      return { x: pin.at.x, y: -height / 2 };
    case "south":
      return { x: pin.at.x, y: height / 2 };
  }
}

/** Geometry used only for a Project's derived subcircuit navigation blocks. */
export function createHierarchicalBlockGeometry(
  terminals: readonly HierarchicalBlockTerminal[],
  presentation?: CellSymbolPresentation,
): SymbolDefinition {
  const slots = resolvePinSlots(terminals, presentation);
  const { width, height } = bodySize(slots, presentation?.minimumBodySize);
  const pins = slots.map((slot) => pinForSlot(slot, width, height));
  const left = -width / 2;
  const top = -height / 2;
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
          { x: -left, y: top },
          { x: -left, y: -top },
          { x: left, y: -top },
        ],
        fill: "none",
        stroke: "foreground",
      },
      ...pins.map((pin) => ({
        kind: "line" as const,
        from: pin.at,
        to: leadToBody(pin, width, height),
      })),
    ],
    variants: [],
  };
}
