import {
  DIFFERENTIAL_COMPARATOR_TARGET,
  subcircuitDescriptor,
} from "@icm/devices";
import {
  builtInSymbols,
  relocatedPin,
  type SymbolDefinition,
  type SymbolVariant,
} from "@icm/symbols";
import { razaviTextbookProfile, visibleSymbolInkBounds } from "@icm/derived";

import { toRnlPoint } from "./place.js";
import { rnlLength, symbolShapes } from "./shapes.js";
import type { RnlSymbol } from "./symbol-map.js";
import type { RnlSymbolDefinitionView } from "./rnl-snapshot.js";

/**
 * The bodies no RNL package draws a symbol for. The first stencils list the
 * supplies last, as files written with them already do; the others keep
 * their body's own port order, which a call-only Spectre body cannot change.
 */
const SUPPLIES_LAST_TARGETS = new Set([
  DIFFERENTIAL_COMPARATOR_TARGET,
  "delay_cell",
]);
const INLINE_TARGETS = new Set([
  ...SUPPLIES_LAST_TARGETS,
  "adc_differential",
  "dac_differential",
]);

/** The pins a symbol's default variant hides. */
const hiddenByDefault = (symbol: (typeof builtInSymbols)[number]) =>
  new Set(
    symbol.variants.find(
      (candidate) => candidate.id === symbol.defaultVariantId,
    )?.hiddenPinNames,
  );

/** Artwork with new electrical interfaces is defined in the file itself. */
export const inlineRnlSymbols: readonly RnlSymbol[] = builtInSymbols.flatMap(
  (symbol): RnlSymbol[] => {
    const descriptor = subcircuitDescriptor(symbol.id);
    if (!descriptor || !INLINE_TARGETS.has(descriptor.target)) return [];
    const ports = SUPPLIES_LAST_TARGETS.has(descriptor.target)
      ? [
          ...descriptor.ports.filter((port) => !port.supply),
          ...descriptor.ports.filter((port) => port.supply),
        ]
      : descriptor.ports;
    const terminalName = (port: (typeof ports)[number]) =>
      port.supply === "VDD"
        ? "vp"
        : port.supply === "VSS"
          ? "vn"
          : port.name.toLowerCase();
    return [
      {
        symbol: `$CANVAS_${symbol.id.toUpperCase().replaceAll("-", "_")}`,
        package: "",
        inline: true,
        ac: symbol.id,
        variant: null,
        orient: "R0",
        importOnly: false,
        definition: null,
        offset: [0, 0],
        terminals: ports.map((port, index) => ({
          n: index + 1,
          name: terminalName(port),
          drawn: !port.supply,
        })),
        // A supply pin the default variant hides is its supply's undrawn
        // terminal, as on a library symbol (#1941).
        pins: symbol.pins
          .filter((pin) => !hiddenByDefault(symbol).has(pin.name))
          .map((pin) => ({
            terminal: ports.findIndex((port) => port.pinName === pin.name) + 1,
            acPin: pin.name,
            at: toRnlPoint(pin.at),
            dir: { east: 0, north: 90, west: 180, south: 270 }[pin.direction],
          })),
        undrawnPins: symbol.pins
          .filter((pin) => hiddenByDefault(symbol).has(pin.name))
          .flatMap((pin) => {
            const terminal =
              ports.findIndex((port) => port.supply === pin.name) + 1;
            return terminal ? [{ terminal, acPin: pin.name }] : [];
          }),
        acNetlistOrder: descriptor.ports.map(terminalName),
      },
    ];
  },
);

/**
 * The variants a package row draws in their base form, defined in the file
 * itself instead, since the published package is fixed: the wide chopper
 * (#2170). Each keeps its row's terminals, its pins where the variant moves
 * them.
 */
const INLINE_VARIANTS: Readonly<Record<string, readonly string[]>> = {
  chopper: ["wide"],
};

const DIRECTION_DEGREES = { east: 0, north: 90, west: 180, south: 270 };

function variantOf(row: Pick<RnlSymbol, "ac" | "variant">): {
  symbol: SymbolDefinition;
  variant: SymbolVariant | undefined;
} {
  const symbol = builtInSymbols.find((candidate) => candidate.id === row.ac)!;
  return {
    symbol,
    variant: row.variant
      ? symbol.variants.find((candidate) => candidate.id === row.variant)
      : undefined,
  };
}

export function inlineRnlVariantSymbols(
  rows: readonly RnlSymbol[],
): RnlSymbol[] {
  return Object.entries(INLINE_VARIANTS).flatMap(([ac, variants]) => {
    const base = rows.find(
      (row) => row.ac === ac && row.variant === null && !row.importOnly,
    );
    if (
      !base ||
      base.offset.some((value) => value !== 0) ||
      base.orient !== "R0"
    )
      throw new Error(`No plain RNL row to draw ${ac}'s variants from`);
    return variants.map((id) => {
      const { variant } = variantOf({ ac, variant: id });
      if (!variant) throw new Error(`Unknown variant ${ac}/${id}`);
      return {
        ...base,
        symbol: `${base.symbol}_${id.toUpperCase().replaceAll("-", "_")}`,
        package: "",
        inline: true,
        variant: id,
        pins: base.pins.map((pin) => {
          const moved = relocatedPin(variant, pin.acPin);
          return moved
            ? {
                ...pin,
                at: toRnlPoint(moved.at),
                dir: DIRECTION_DEGREES[moved.direction],
              }
            : pin;
        }),
      };
    });
  });
}

/**
 * A symbol the file defines for a body's own interface, binding the call's
 * terminals in its own order; a package row's variant binds them as its row
 * does.
 */
export function inlineInterface(row: RnlSymbol): boolean {
  return row.inline === true && row.variant === null;
}

/**
 * Exact candidate artwork and positional pins, using the existing define-symbol
 * op: the artwork as the row's variant draws it, with no lead of a hidden
 * supply. `withHiddenLeads` keeps them, as files written from #1939 to #1941
 * draw an op-amp's call symbol. A variant the file defines in its own right,
 * as the wide chopper, draws its own art in its own box (#2170).
 */
export function inlineRnlDefinition(row: RnlSymbol, withHiddenLeads = false) {
  const { symbol, variant } = variantOf(row);
  const own =
    variant && INLINE_VARIANTS[symbol.id]?.includes(variant.id)
      ? variant
      : undefined;
  const hidden = own
    ? (own.hiddenPrimitiveParts ?? [])
    : withHiddenLeads
      ? []
      : (symbol.variants.find(
          (candidate) =>
            candidate.id === (row.variant ?? symbol.defaultVariantId),
        )?.hiddenPrimitiveParts ?? []);
  const drawn = [
    ...symbol.primitives,
    ...(own?.additionalPrimitives ?? []),
  ].filter((primitive) => !primitive.part || !hidden.includes(primitive.part));
  const prims = drawn.flatMap((primitive) => {
    const shapes = symbolShapes([primitive]);
    if (!shapes)
      throw new Error(`Cannot define inline RNL symbol ${symbol.id}`);
    const width =
      primitive.style?.strokeWidth ??
      razaviTextbookProfile.strokes[primitive.style?.strokeRole ?? "normal"];
    return shapes.map((shape) => ({
      ...shape,
      style: { ...shape.style, linewidth: rnlLength(width) },
    }));
  });
  // A variant's box is its ink with its symbol's own viewBox margin.
  const { x, y, width, height } = own
    ? variantBox(symbol, own)
    : symbol.viewBox;
  const [left, top] = toRnlPoint({ x, y });
  const [right, bottom] = toRnlPoint({ x: x + width, y: y + height });
  return {
    name: row.symbol,
    box: [left, bottom, right, top] as [number, number, number, number],
    pins: row.pins.map((pin) => ({
      terminals: [pin.terminal],
      at: pin.at,
      direction: { 0: "right", 90: "up", 180: "left", 270: "down" }[
        pin.dir!
      ] as "right" | "up" | "left" | "down",
    })),
    prims,
  };
}

/** A local name alone is not evidence that an edited stencil is our symbol. */
export function matchesInlineRnlSymbol(
  row: RnlSymbol,
  actual: RnlSymbolDefinitionView | null | undefined,
): boolean {
  if (!actual) return false;
  // As written now, or with the hidden supply leads files written from
  // #1939 to #1941 drew (#1941).
  return [inlineRnlDefinition(row), inlineRnlDefinition(row, true)].some(
    (expected) => matches(row, expected, actual),
  );
}

function matches(
  row: RnlSymbol,
  expected: ReturnType<typeof inlineRnlDefinition>,
  actual: RnlSymbolDefinitionView,
): boolean {
  return (
    actual.pins.length === expected.pins.length &&
    actual.prims.length === expected.prims.length &&
    expected.pins.every((pin, index) => {
      const found = actual.pins[index]!;
      return (
        JSON.stringify(found.terminals) ===
          JSON.stringify(pin.terminals.map(String)) &&
        JSON.stringify(found.at) === JSON.stringify(pin.at) &&
        found.dir === row.pins[index]!.dir
      );
    }) &&
    expected.prims.every((primitive, index) => {
      const found = actual.prims[index]!;
      return (
        primitive.shape === found.shape &&
        JSON.stringify(primitive.points) === JSON.stringify(found.points) &&
        sameProperties(primitive.params, found.params) &&
        sameProperties(primitive.style, found.style)
      );
    })
  );
}

/** Snapshot records may reorder keys or represent absent properties as {}. */
function sameProperties(
  expected: Readonly<Record<string, string | number | boolean>> | undefined,
  actual: Readonly<Record<string, string | number | boolean>> | undefined,
): boolean {
  const entries = Object.entries(expected ?? {});
  return (
    entries.length === Object.keys(actual ?? {}).length &&
    entries.every(([key, value]) => actual?.[key] === value)
  );
}

/** A variant's ink, its pins included, inside its symbol's viewBox margin. */
function variantBox(symbol: SymbolDefinition, variant: SymbolVariant) {
  const ink = visibleSymbolInkBounds({ definition: symbol, variant });
  const base = visibleSymbolInkBounds({ definition: symbol });
  const left = base.x - symbol.viewBox.x;
  const top = base.y - symbol.viewBox.y;
  const right = symbol.viewBox.x + symbol.viewBox.width - (base.x + base.width);
  const bottom =
    symbol.viewBox.y + symbol.viewBox.height - (base.y + base.height);
  return {
    x: ink.x - left,
    y: ink.y - top,
    width: ink.width + left + right,
    height: ink.height + top + bottom,
  };
}
