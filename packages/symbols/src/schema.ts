import {
  StableIdSchema,
  SymbolLocalPointSchema,
  SymbolLocalRectSchema,
} from "@icm/model";
import { z } from "zod";

export const SYMBOL_CONNECTION_GRID = 10;
const SymbolGeometryPointSchema = SymbolLocalPointSchema;

function routingLandingIssue(pin: {
  at: { x: number; y: number };
  direction: "north" | "east" | "south" | "west";
  routing?:
    { preferredLanding?: { x: number; y: number } | undefined } | undefined;
}): string | null {
  const landing = pin.routing?.preferredLanding;
  if (!landing) return null;
  const delta = { x: landing.x - pin.at.x, y: landing.y - pin.at.y };
  const outward =
    (pin.direction === "east" && delta.y === 0 && delta.x >= 0) ||
    (pin.direction === "west" && delta.y === 0 && delta.x <= 0) ||
    (pin.direction === "south" && delta.x === 0 && delta.y >= 0) ||
    (pin.direction === "north" && delta.x === 0 && delta.y <= 0);
  return outward
    ? null
    : "Preferred routing landing must lie on the pin's outward axis";
}

/**
 * Symbol-local authoring intent for a terminal whose calibrated artwork
 * contact does not itself lie on the connection grid. The preferred landing
 * is geometry only: electrical identity remains the canonical pin name.
 */
export const SymbolPinRoutingSchema = z.strictObject({
  escape: z.literal("outward"),
  preferredLanding: SymbolLocalPointSchema.optional(),
});

export const SymbolPinSchema = z.strictObject({
  name: z.string().min(1),
  role: z.string().min(1),
  at: SymbolLocalPointSchema,
  direction: z.enum(["north", "east", "south", "west"]),
  routing: SymbolPinRoutingSchema.optional(),
  presentation: z.strictObject({
    visibility: z.enum(["visible", "implicit", "conditional"]),
    leadLength: z.number().int().nonnegative().optional(),
    showName: z.boolean().optional(),
    // Keeps the canonical electrical pin name stable while allowing a source-
    // faithful glyph such as Q with a separately drawn complement bar.
    displayName: z.string().min(1).optional(),
    textStyle: z.enum(["plain", "math-symbol"]).optional(),
    textSizeScale: z.number().positive().optional(),
  }),
});
export const SymbolStrokeRoleSchema = z.enum([
  "normal",
  "emphasis",
  "ground",
  "supply",
  "annotation",
]);
const SymbolPrimitiveStyleSchema = z
  .strictObject({
    strokeRole: SymbolStrokeRoleSchema.optional(),
    strokeWidth: z.number().positive().optional(),
    lineCap: z.enum(["butt", "round", "square"]).optional(),
    lineJoin: z.enum(["miter", "round", "bevel"]).optional(),
    miterLimit: z.number().positive().optional(),
  })
  .superRefine((style, context) => {
    if (style.strokeRole !== undefined && style.strokeWidth !== undefined) {
      context.addIssue({
        code: "custom",
        message: "Primitive style cannot set both strokeRole and strokeWidth",
        path: ["strokeWidth"],
      });
    }
  });
export const SymbolPrimitiveSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("line"),
    from: SymbolGeometryPointSchema,
    to: SymbolGeometryPointSchema,
    part: StableIdSchema.optional(),
    style: SymbolPrimitiveStyleSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal("polyline"),
    points: z.array(SymbolGeometryPointSchema).min(2),
    part: StableIdSchema.optional(),
    style: SymbolPrimitiveStyleSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal("circle"),
    center: SymbolGeometryPointSchema,
    radius: z.number().positive(),
    fill: z.enum(["none", "foreground"]).optional(),
    stroke: z.enum(["none", "foreground"]).optional(),
    part: StableIdSchema.optional(),
    style: SymbolPrimitiveStyleSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal("path"),
    data: z.string().min(1),
    part: StableIdSchema.optional(),
    style: SymbolPrimitiveStyleSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal("polygon"),
    points: z.array(SymbolGeometryPointSchema).min(3),
    fill: z.enum(["none", "foreground"]),
    stroke: z.enum(["none", "foreground"]).optional(),
    part: StableIdSchema.optional(),
    style: SymbolPrimitiveStyleSchema.optional(),
  }),
]);
export const SymbolFormulaPresentationSchema = z.strictObject({
  /** Canonical source text used when the instance has no formula override. */
  defaultFormula: z.string().min(1).max(256),
  /**
   * Whether the editor may prepend an independent coefficient to the formula.
   * True for the transfer-function blocks, where `k·H(s)` is the notation.
   * False for a body letter such as an amplifier's gain mark, which names the
   * stage rather than scaling it: offering a coefficient there would advertise
   * an operation the drawing does not mean.
   */
  supportsCoefficient: z.boolean(),
  /** Symbol-local visual center for the renderer-owned formula. */
  center: SymbolGeometryPointSchema,
  fontSize: z.number().finite().positive(),
  /** Optional calibrated width for a stacked fraction bar. */
  fractionBarWidth: z.number().finite().positive().optional(),
  /**
   * Shared Transfer Function frame contract. Formula text keeps a fixed font
   * size; the frame and horizontal pin span expand when content needs room.
   */
  adaptiveFrame: z
    .strictObject({
      /** Body outline. Omitted preserves the historical rectangular frame. */
      shape: z.enum(["rectangle", "right-tapered-trapezoid"]).optional(),
      minBodyWidth: z.number().int().positive().multipleOf(10),
      minBodyHeight: z.number().int().positive().multipleOf(10),
      horizontalPadding: z.number().finite().nonnegative(),
      verticalPadding: z.number().finite().nonnegative(),
      leadLength: z.number().int().nonnegative().multipleOf(10),
    })
    .optional(),
});

export const SymbolVariantSchema = z.strictObject({
  id: StableIdSchema,
  hiddenPinNames: z.array(z.string().min(1)),
  // A hidden canonical pin may still expose a context-gated wiring anchor at
  // artwork-specific geometry. The electrical pin itself remains unique.
  auxiliaryPins: z
    .array(
      z.strictObject({
        name: z.string().min(1),
        at: SymbolLocalPointSchema,
        direction: z.enum(["north", "east", "south", "west"]),
        routing: SymbolPinRoutingSchema.optional(),
      }),
    )
    .optional(),
  hiddenPrimitiveParts: z.array(StableIdSchema).optional(),
  additionalPrimitives: z.array(SymbolPrimitiveSchema).optional(),
});
export const SymbolDefinitionSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    id: StableIdSchema,
    name: z.string().min(1),
    viewBox: SymbolLocalRectSchema,
    pins: z.array(SymbolPinSchema).min(0),
    primitives: z.array(SymbolPrimitiveSchema),
    variants: z.array(SymbolVariantSchema),
    defaultVariantId: StableIdSchema.optional(),
    labelVisibility: z.enum(["shown", "hidden"]).optional(),
    // ADR 0010: a decorative symbol is a non-electrical catalog entry usable
    // only as a DraftFloatingSymbol. It must carry no terminals (pins).
    decorative: z.boolean().optional(),
    // A derived subcircuit container may legitimately expose an empty formal
    // interface before ports are authored in its child Cell.
    hierarchicalBlock: z.literal(true).optional(),
    // One editable text inside the body, owned by the Instance. The Symbol
    // says where it sits and what it says by default; the Instance overrides
    // the text through `signalFlowParameters.formula`, so two copies of one
    // part on a sheet read differently without becoming different parts. The
    // renderer projects it, so an edit never changes Symbol identity.
    //
    // Any Symbol may declare it — the Signal Flow blocks named the field and
    // came first, the lettered amplifiers followed, and a converter block
    // labelled ADC or DAC needs nothing new. The default is a string, not a
    // character: declare `defaultFormula: "ADC"`, a `center` in symbol-local
    // geometry, a `fontSize`, and `supportsCoefficient: false` unless the
    // text really is a transfer function something may scale.
    formulaPresentation: SymbolFormulaPresentationSchema.optional(),
  })
  .superRefine((symbol, context) => {
    if (symbol.decorative && symbol.hierarchicalBlock) {
      context.addIssue({
        code: "custom",
        path: ["hierarchicalBlock"],
        message: "A decorative symbol cannot be a hierarchical block",
      });
    }
    if (symbol.decorative && symbol.pins.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["pins"],
        message: "A decorative symbol must contain no terminals (pins)",
      });
    }
    if (
      !symbol.decorative &&
      !symbol.hierarchicalBlock &&
      symbol.pins.length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["pins"],
        message:
          "A non-decorative symbol must contain at least one terminal (pin)",
      });
    }
    const pinNames = new Set<string>();
    for (const [pinIndex, pin] of symbol.pins.entries()) {
      if (pinNames.has(pin.name)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate symbol pin: ${pin.name}`,
          path: ["pins", pinIndex, "name"],
        });
      }
      pinNames.add(pin.name);
      for (const coordinate of ["x", "y"] as const) {
        if (pin.at[coordinate] % SYMBOL_CONNECTION_GRID !== 0) {
          context.addIssue({
            code: "custom",
            message: `Symbol pin anchors must use the ${SYMBOL_CONNECTION_GRID}-unit connection grid`,
            path: ["pins", pinIndex, "at", coordinate],
          });
        }
      }
      const routingIssue = routingLandingIssue(pin);
      if (routingIssue) {
        context.addIssue({
          code: "custom",
          message: routingIssue,
          path: ["pins", pinIndex, "routing", "preferredLanding"],
        });
      }
      for (const coordinate of ["x", "y"] as const) {
        const value = pin.routing?.preferredLanding?.[coordinate];
        if (value !== undefined && value % SYMBOL_CONNECTION_GRID !== 0) {
          context.addIssue({
            code: "custom",
            message: `Preferred routing landings must use the ${SYMBOL_CONNECTION_GRID}-unit connection grid`,
            path: ["pins", pinIndex, "routing", "preferredLanding", coordinate],
          });
        }
      }
    }
    if (
      symbol.defaultVariantId !== undefined &&
      !symbol.variants.some((variant) => variant.id === symbol.defaultVariantId)
    ) {
      context.addIssue({
        code: "custom",
        path: ["defaultVariantId"],
        message: `Unknown default Symbol variant: ${symbol.defaultVariantId}`,
      });
    }
    const variantIds = new Set<string>();
    for (const [variantIndex, variant] of symbol.variants.entries()) {
      if (variantIds.has(variant.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate symbol variant: ${variant.id}`,
          path: ["variants", variantIndex, "id"],
        });
      }
      variantIds.add(variant.id);
      for (const [pinIndex, pinName] of variant.hiddenPinNames.entries()) {
        if (!pinNames.has(pinName)) {
          context.addIssue({
            code: "custom",
            message: `Variant hides an unknown electrical pin: ${pinName}`,
            path: ["variants", variantIndex, "hiddenPinNames", pinIndex],
          });
        }
      }
      for (const [pinIndex, pin] of (variant.auxiliaryPins ?? []).entries()) {
        if (!pinNames.has(pin.name)) {
          context.addIssue({
            code: "custom",
            message: `Variant exposes an unknown auxiliary pin: ${pin.name}`,
            path: ["variants", variantIndex, "auxiliaryPins", pinIndex],
          });
        }
        for (const coordinate of ["x", "y"] as const) {
          const value = pin.routing?.preferredLanding?.[coordinate];
          if (value !== undefined && value % SYMBOL_CONNECTION_GRID !== 0) {
            context.addIssue({
              code: "custom",
              message: `Preferred routing landings must use the ${SYMBOL_CONNECTION_GRID}-unit connection grid`,
              path: [
                "variants",
                variantIndex,
                "auxiliaryPins",
                pinIndex,
                "routing",
                "preferredLanding",
                coordinate,
              ],
            });
          }
        }
        const routingIssue = routingLandingIssue(pin);
        if (routingIssue) {
          context.addIssue({
            code: "custom",
            message: routingIssue,
            path: [
              "variants",
              variantIndex,
              "auxiliaryPins",
              pinIndex,
              "routing",
              "preferredLanding",
            ],
          });
        }
      }
    }
  });

export const SymbolDefinitionJsonSchema = z.toJSONSchema(
  SymbolDefinitionSchema,
  {
    target: "draft-2020-12",
  },
);

export type SymbolPin = z.infer<typeof SymbolPinSchema>;
export type SymbolFormulaPresentation = z.infer<
  typeof SymbolFormulaPresentationSchema
>;
export type SymbolStrokeRole = z.infer<typeof SymbolStrokeRoleSchema>;
export type SymbolPrimitive = z.infer<typeof SymbolPrimitiveSchema>;
export type SymbolVariant = z.infer<typeof SymbolVariantSchema>;
export type SymbolDefinition = z.infer<typeof SymbolDefinitionSchema>;
