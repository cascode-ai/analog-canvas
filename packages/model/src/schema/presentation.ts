import { z } from "zod";

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
  /** Signed symbol-local distance from the body centre along `side`. */
  offset: z
    .number()
    .int()
    .refine(symbolGridMultiple, {
      message: `Cell symbol pin offset must align to the ${CELL_SYMBOL_CONNECTION_GRID}-unit connection grid`,
    }),
});

export const CellSymbolBodySizeSchema = z.strictObject({
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
export const CellSymbolPresentationSchema = z.strictObject({
  minimumBodySize: CellSymbolBodySizeSchema.optional(),
  pinPlacements: z.array(CellSymbolPinPlacementSchema).max(256).optional(),
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
