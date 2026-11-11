import { z } from "zod";
import { cellSymbolPinFitsBody } from "../cell-symbol-layout.js";

import { StableIdSchema } from "./common.js";

/** Symbol-local grid used by derived hierarchical Cell block geometry. */
const CELL_SYMBOL_CONNECTION_GRID = 10;

function symbolGridMultiple(value: number): boolean {
  return value % CELL_SYMBOL_CONNECTION_GRID === 0;
}

export const CellSymbolSideSchema = z.enum(["north", "east", "south", "west"]);

export const CellSymbolPinPlacementSchema = z.strictObject({
  /** Stable formal-terminal identity; never a mutable pin name. */
  terminalId: StableIdSchema,
  side: CellSymbolSideSchema,
  /** Signed symbol-local distance from the stable origin along `side`. */
  offset: z
    .number()
    .int()
    .refine(symbolGridMultiple, {
      message: `Cell symbol pin offset must align to the ${CELL_SYMBOL_CONNECTION_GRID}-unit connection grid`,
    }),
});

const CellSymbolBodySizeSchema = z.strictObject({
  width: z
    .number()
    .int()
    .positive()
    .refine(symbolGridMultiple, {
      message: `Cell symbol body width must align to the ${CELL_SYMBOL_CONNECTION_GRID}-unit connection grid`,
    }),
  height: z
    .number()
    .int()
    .positive()
    .refine(symbolGridMultiple, {
      message: `Cell symbol body height must align to the ${CELL_SYMBOL_CONNECTION_GRID}-unit connection grid`,
    }),
});

/**
 * Definition-level hierarchy block intent. The renderer derives artwork and
 * pin coordinates from this compact data; callers never persist a copy.
 */
const CellSymbolCoordinateSchema = z.number().int().refine(symbolGridMultiple, {
  message: "Cell symbol bounds must align to the 10-unit connection grid",
});

const CellSymbolBodyBoundsSchema = z
  .strictObject({
    left: CellSymbolCoordinateSchema,
    right: CellSymbolCoordinateSchema,
    top: CellSymbolCoordinateSchema,
    bottom: CellSymbolCoordinateSchema,
  })
  .refine(
    (bounds) =>
      bounds.right - bounds.left >= 20 && bounds.bottom - bounds.top >= 20,
    {
      message: "Cell symbol body must be at least 20 units wide and high",
    },
  );

export const CellSymbolPresentationSchema = z
  .strictObject({
    minimumBodySize: CellSymbolBodySizeSchema.optional(),
    /** Explicit edited edges; never fitted to text or recentered. */
    bodyBounds: CellSymbolBodyBoundsSchema.optional(),
    pinPlacements: z.array(CellSymbolPinPlacementSchema).max(256).optional(),
  })
  .superRefine((presentation, context) => {
    const terminals = new Set<string>(),
      slots = new Set<string>();
    for (const [index, pin] of (presentation.pinPlacements ?? []).entries()) {
      if (terminals.has(pin.terminalId))
        context.addIssue({
          code: "custom",
          path: ["pinPlacements", index, "terminalId"],
          message: `Cell symbol terminal is placed more than once: ${pin.terminalId}`,
        });
      const slot = `${pin.side}:${pin.offset}`;
      if (slots.has(slot))
        context.addIssue({
          code: "custom",
          path: ["pinPlacements", index],
          message: `Cell symbol pin slot is occupied: ${slot}`,
        });
      terminals.add(pin.terminalId);
      slots.add(slot);
    }
    const bounds = presentation.bodyBounds;
    if (!bounds) return;
    for (const [index, pin] of (presentation.pinPlacements ?? []).entries()) {
      if (!cellSymbolPinFitsBody(pin, bounds))
        context.addIssue({
          code: "custom",
          path: ["pinPlacements", index, "offset"],
          message:
            "Cell symbol pin must stay inside its edge, 10 units from a corner",
        });
    }
  });

/**
 * Bounded per-document scale factor over the resolved style profile. The
 * approved profiles stay the single base-value authority; an absent factor
 * means exactly 1.0, so a document without overrides renders byte-identical.
 */
const StyleScaleSchema = z.number().min(0.5).max(2);

/**
 * Optional document-wide style intent composed over the base profile:
 * uniform typography scale, wire stroke, symbol-artwork strokes, drafting
 * and annotation strokes, and the junction-dot radius.
 */
export const StyleOverridesSchema = z.strictObject({
  fontScale: StyleScaleSchema.optional(),
  wireStrokeScale: StyleScaleSchema.optional(),
  symbolStrokeScale: StyleScaleSchema.optional(),
  annotationStrokeScale: StyleScaleSchema.optional(),
  junctionRadiusScale: StyleScaleSchema.optional(),
});

/**
 * The Document style one object keeps from the drawing it was copied from.
 * It holds the same factors as `styleOverrides` and replaces its Document's
 * overrides for this object alone; an absent factor means 1. Copy writes it
 * only when the source and target style defaults differ, so a copy draws
 * exactly like its source. An object without it follows its Document.
 */
export const ObjectDocumentStyleSchema = StyleOverridesSchema;

/**
 * The faces a Document may set all its text in instead of Metropolis
 * (#1725): Times New Roman's metrics ("serif", Liberation Serif), Arial's
 * ("sans", Liberation Sans) or LaTeX's ("latin-modern", Latin Modern Roman).
 */
export const DOCUMENT_TEXT_FACES = ["serif", "sans", "latin-modern"] as const;
export type DocumentTextFace = (typeof DOCUMENT_TEXT_FACES)[number];

export const PresentationIntentSchema = z.strictObject({
  styleProfileId: StableIdSchema,
  grid: z.number().int().positive(),
  compactness: z.enum(["loose", "normal", "compact"]),
  styleOverrides: StyleOverridesSchema.optional(),
  /** Current-Cell label naming preference; never a browser-wide setting. */
  labelSubscriptCase: z.enum(["preserve", "uppercase", "lowercase"]).optional(),
  /** Default for generated label subscripts; explicit RichText stays editable. */
  labelSubscriptItalic: z.boolean().optional(),
  /** Whether an underscore introduces a subscript or remains literal text. */
  labelUnderscoreSubscript: z.boolean().optional(),
  /** Apply the leading-letter / subscript convention to unseparated names. */
  labelSubscriptAfterFirst: z.boolean().optional(),
  /** Slant of the leading character, independent of the subscript. */
  labelFirstLetterItalic: z.boolean().optional(),
  /** The one font of all the Document's text; absent means Metropolis. */
  textFace: z.enum(DOCUMENT_TEXT_FACES).optional(),
  /**
   * How a wire crossing that is not a connection draws: "hop" arcs the
   * horizontal wire over the vertical one; absent means a plain cross.
   */
  crossingStyle: z.enum(["hop"]).optional(),
  flow: z
    .strictObject({
      power: z.literal("top").optional(),
      ground: z.literal("bottom").optional(),
      input: z.literal("left").optional(),
      output: z.literal("right").optional(),
    })
    .optional(),
  cellSymbol: CellSymbolPresentationSchema.optional(),
});
export const MosBulkDefaultsSchema = z.strictObject({
  nmosNetId: StableIdSchema.optional(),
  pmosNetId: StableIdSchema.optional(),
});
export const LayoutGroupSchema = z.strictObject({
  id: StableIdSchema,
  kind: z.enum([
    "differential-pair",
    "current-mirror",
    "matched-pair",
    "custom",
  ]),
  objectIds: z.array(StableIdSchema).min(1),
  locked: z.boolean(),
});
export const LayoutConstraintSchema = z.strictObject({
  id: StableIdSchema,
  kind: z.enum([
    "align-x",
    "align-y",
    "symmetric",
    "equal-spacing",
    "keep-clear",
  ]),
  objectIds: z.array(StableIdSchema).min(2),
  locked: z.boolean(),
});

export type CellSymbolSide = z.infer<typeof CellSymbolSideSchema>;
export type CellSymbolPinPlacement = z.infer<
  typeof CellSymbolPinPlacementSchema
>;
export type CellSymbolPresentation = z.infer<
  typeof CellSymbolPresentationSchema
>;
export type StyleOverrides = z.infer<typeof StyleOverridesSchema>;
