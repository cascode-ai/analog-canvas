import {
  ADDER_SYMBOL_ID,
  adderInputSigns,
  type ADDER_SIGNED_INPUTS,
} from "@icm/devices";
import {
  inverseTransformPoint,
  type Orientation,
  type SymbolLocalPoint,
} from "@icm/model";

import type { ResolvedSymbol, SymbolResolver } from "./resolver.js";
import type { SymbolDefinition, SymbolPrimitive } from "./schema.js";

/**
 * Where the adder draws each input's sign: the centre of the mark, in the
 * Symbol's own coordinates. The marks are presentation the Instance owns,
 * drawn from its sign parameters; they are not Symbol artwork, and the
 * adder's definition and evidence carry none of them. Measured on the
 * adder's pinned witness, Razavi's Figure 21.38, at its calibration of
 * 1.3 px per unit about the circle's centre: both summing nodes there put
 * the plus over input A at (−21.4, −10.6) and the minus beside input B at
 * (−12.4, 18.4). The adder in Figure 21.33 agrees within 0.7 units.
 * input-signs.test.ts pins these positions.
 */
const ADDER_SIGN_CENTERS: Readonly<
  Record<(typeof ADDER_SIGNED_INPUTS)[number]["pinName"], SymbolLocalPoint>
> = {
  A: { x: -21.5, y: -10.5 },
  B: { x: -12.5, y: 18.5 },
};
/** Half a sign's bar: the witness's plus and minus are 7.6 units wide. */
const SIGN_HALF_WIDTH = 3.8;
/** Room the Symbol's box keeps around a sign's bars, as around its circle. */
const SIGN_BOX_MARGIN = 2;

/** The part of an Instance its signs read; a full Instance qualifies. */
export interface InputSignSource {
  readonly netlist?:
    { readonly parameters: Readonly<Record<string, string>> } | undefined;
  readonly placement?: Orientation | null | undefined;
}

function canonical(value: number): number {
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

const SIGN_PART = /^input-[a-z]+-sign-(?:plus|minus)$/u;

/**
 * The marks an Instance draws beside its inputs, in the Symbol's own
 * coordinates: a plus or a minus at each input of an adder once one of them
 * subtracts, as a textbook draws a summing node. An adder whose inputs all
 * add draws none, and so looks as it always has. The marks are notation:
 * they move with their inputs, and each bar is laid out against the
 * Instance's turn and mirror, so a minus stays level on the page.
 */
function inputSignPrimitives(
  definition: SymbolDefinition,
  instance: InputSignSource,
): SymbolPrimitive[] {
  if (
    definition.id !== ADDER_SYMBOL_ID ||
    // Already drawn: a Symbol this function extended stays as it is.
    definition.primitives.some((primitive) =>
      SIGN_PART.test(primitive.part ?? ""),
    )
  )
    return [];
  const signs = adderInputSigns(instance.netlist?.parameters);
  if (!signs.some((input) => input.sign === "-")) return [];
  const orientation: Orientation = instance.placement ?? {
    rotation: 0,
    mirror: "none",
  };
  const bar = (
    center: SymbolLocalPoint,
    along: SymbolLocalPoint,
    part: string,
  ): SymbolPrimitive => {
    // The bar's page direction, carried back into Symbol coordinates.
    const local = inverseTransformPoint(along, { x: 0, y: 0 }, orientation);
    return {
      kind: "line",
      from: {
        x: canonical(center.x - local.x),
        y: canonical(center.y - local.y),
      },
      to: {
        x: canonical(center.x + local.x),
        y: canonical(center.y + local.y),
      },
      part,
      style: { strokeRole: "normal", lineCap: "butt", lineJoin: "miter" },
    };
  };
  return signs.flatMap(({ pinName, sign }) => {
    const center = ADDER_SIGN_CENTERS[pinName];
    if (!definition.pins.some((pin) => pin.name === pinName)) return [];
    const part = `input-${pinName.toLowerCase()}-sign-${
      sign === "-" ? "minus" : "plus"
    }`;
    const level = bar(center, { x: SIGN_HALF_WIDTH, y: 0 }, part);
    return sign === "-"
      ? [level]
      : [level, bar(center, { x: 0, y: SIGN_HALF_WIDTH }, part)];
  });
}

/**
 * The Symbol as this Instance draws it: its definition and variant, with the
 * sign marks its parameters choose added to the artwork and to the box the
 * artwork occupies. Unchanged, and the same object, when there are none.
 */
export function withInputSigns(
  resolved: ResolvedSymbol,
  instance: InputSignSource,
): ResolvedSymbol {
  const marks = inputSignPrimitives(resolved.definition, instance);
  if (!marks.length) return resolved;
  const reach = SIGN_HALF_WIDTH + SIGN_BOX_MARGIN;
  const centers = marks.flatMap((mark) =>
    mark.kind === "line"
      ? [
          {
            x: (mark.from.x + mark.to.x) / 2,
            y: (mark.from.y + mark.to.y) / 2,
          },
        ]
      : [],
  );
  const { viewBox } = resolved.definition;
  const left = Math.min(viewBox.x, ...centers.map((c) => c.x - reach));
  const top = Math.min(viewBox.y, ...centers.map((c) => c.y - reach));
  const right = Math.max(
    viewBox.x + viewBox.width,
    ...centers.map((c) => c.x + reach),
  );
  const bottom = Math.max(
    viewBox.y + viewBox.height,
    ...centers.map((c) => c.y + reach),
  );
  return {
    ...resolved,
    definition: {
      ...resolved.definition,
      viewBox: { x: left, y: top, width: right - left, height: bottom - top },
      primitives: [...resolved.definition.primitives, ...marks],
    },
  };
}

/**
 * The Symbol an Instance draws, with its sign marks; see withInputSigns.
 * Whatever measures an Instance's ink resolves it here: the scene and its
 * bounds, the hit box and snapping, labels, visual diagnostics, the bodies
 * wire planning keeps clear of and the wire-under-symbol warning, and the
 * Agent Snapshot's bounds. A reader of pins alone may resolve the bare
 * Symbol, since the marks add no pin.
 */
export function resolveInstanceSymbol(
  resolver: SymbolResolver,
  instance: InputSignSource & {
    readonly symbolId: string;
    readonly symbolVariantId?: string | undefined;
  },
): ResolvedSymbol | undefined {
  const resolved = resolver.resolve(
    instance.symbolId,
    instance.symbolVariantId,
  );
  return resolved && withInputSigns(resolved, instance);
}
