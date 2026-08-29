import type { SymbolDefinition } from "@icm/symbols";

import type { DrawingTool } from "../../interaction/interaction-state";

export const ANNOTATION_CATEGORY = "Annotations";

export type PolarityAnnotationKind = "both" | "positive" | "negative";

const drawingToolBySymbolId = {
  "annotation-arrow": "arrow",
  "annotation-line": "construction-line",
  "annotation-rectangle": "rectangle",
  "annotation-circle": "circle",
} as const satisfies Readonly<Record<string, DrawingTool>>;

// A standalone sign is the same mark as the one the pair draws, so it goes
// through the same polarity machinery. Drawn as a text glyph instead, it
// came out a different size beside the pair — a glyph is a font's drawing of
// a plus, while the mark is two strokes measured from the type size, and no
// amount of tuning makes those two agree.
const polarityBySymbolId = {
  "annotation-polarity-both": "both",
  "annotation-text-plus": "positive",
  "annotation-text-minus": "negative",
} as const satisfies Readonly<Record<string, PolarityAnnotationKind>>;

const textPresetBySymbolId = {
  "annotation-ellipsis": "...",
} as const satisfies Readonly<Record<string, string>>;

export function annotationDrawingTool(
  symbolId: string,
): DrawingTool | undefined {
  return drawingToolBySymbolId[symbolId as keyof typeof drawingToolBySymbolId];
}

export function annotationPolarity(
  symbolId: string,
): PolarityAnnotationKind | undefined {
  return polarityBySymbolId[symbolId as keyof typeof polarityBySymbolId];
}

export function annotationTextPreset(symbolId: string): string | undefined {
  return textPresetBySymbolId[symbolId as keyof typeof textPresetBySymbolId];
}

/** True for a lone + or −: a polarity mark with no centre text to write. */
export function isBarePolaritySign(symbolId: string): boolean {
  const polarity = annotationPolarity(symbolId);
  return polarity === "positive" || polarity === "negative";
}

export function isAnnotationPaletteSymbol(symbolId: string): boolean {
  return Boolean(
    annotationDrawingTool(symbolId) ??
    annotationPolarity(symbolId) ??
    annotationTextPreset(symbolId),
  );
}

const shared: Pick<
  SymbolDefinition,
  "schemaVersion" | "pins" | "variants" | "labelVisibility" | "decorative"
> = {
  schemaVersion: 1,
  pins: [],
  variants: [],
  labelVisibility: "hidden",
  decorative: true,
};

const annotationArrow = {
  ...shared,
  id: "annotation-arrow",
  name: "Arrow",
  viewBox: { x: -22, y: -12, width: 44, height: 24 },
  primitives: [
    { kind: "line", from: { x: -18, y: 0 }, to: { x: 13, y: 0 } },
    {
      kind: "polygon",
      points: [
        { x: 20, y: 0 },
        { x: 12, y: -5 },
        { x: 12, y: 5 },
      ],
      fill: "foreground",
      stroke: "none",
    },
  ],
} satisfies SymbolDefinition;

const annotationLine = {
  ...shared,
  id: "annotation-line",
  name: "Line",
  viewBox: { x: -22, y: -12, width: 44, height: 24 },
  primitives: [{ kind: "line", from: { x: -18, y: 0 }, to: { x: 18, y: 0 } }],
} satisfies SymbolDefinition;

const annotationRectangle = {
  ...shared,
  id: "annotation-rectangle",
  name: "Rectangle",
  viewBox: { x: -22, y: -16, width: 44, height: 32 },
  primitives: [
    {
      kind: "polyline",
      points: [
        { x: -18, y: -12 },
        { x: 18, y: -12 },
        { x: 18, y: 12 },
        { x: -18, y: 12 },
        { x: -18, y: -12 },
      ],
    },
  ],
} satisfies SymbolDefinition;

const annotationCircle = {
  ...shared,
  id: "annotation-circle",
  name: "Circle",
  viewBox: { x: -18, y: -18, width: 36, height: 36 },
  primitives: [
    {
      kind: "circle",
      center: { x: 0, y: 0 },
      radius: 14,
      fill: "none",
      stroke: "foreground",
    },
  ],
} satisfies SymbolDefinition;

function textStrokes(centerY: number): SymbolDefinition["primitives"] {
  return [
    {
      kind: "line",
      from: { x: -9, y: centerY - 5 },
      to: { x: -5, y: centerY + 5 },
    },
    {
      kind: "line",
      from: { x: -5, y: centerY + 5 },
      to: { x: -1, y: centerY - 5 },
    },
    {
      kind: "line",
      from: { x: 2, y: centerY + 2 },
      to: { x: 7, y: centerY + 7 },
    },
    {
      kind: "line",
      from: { x: 7, y: centerY + 2 },
      to: { x: 2, y: centerY + 7 },
    },
  ];
}

function plusStrokes(centerY: number): SymbolDefinition["primitives"] {
  return [
    { kind: "line", from: { x: -4, y: centerY }, to: { x: 4, y: centerY } },
    {
      kind: "line",
      from: { x: 0, y: centerY - 4 },
      to: { x: 0, y: centerY + 4 },
    },
  ];
}

function minusStrokes(centerY: number): SymbolDefinition["primitives"] {
  return [
    { kind: "line", from: { x: -4, y: centerY }, to: { x: 4, y: centerY } },
  ];
}

const annotationPolarityBoth = {
  ...shared,
  id: "annotation-polarity-both",
  name: "Polarity (+ / text / −)",
  viewBox: { x: -14, y: -25, width: 28, height: 50 },
  primitives: [...plusStrokes(-18), ...textStrokes(0), ...minusStrokes(18)],
} satisfies SymbolDefinition;

const annotationTextPlus = {
  ...shared,
  id: "annotation-text-plus",
  name: "Plus sign",
  viewBox: { x: -12, y: -12, width: 24, height: 24 },
  primitives: plusStrokes(0),
} satisfies SymbolDefinition;

const annotationTextMinus = {
  ...shared,
  id: "annotation-text-minus",
  name: "Minus sign",
  viewBox: { x: -12, y: -12, width: 24, height: 24 },
  primitives: minusStrokes(0),
} satisfies SymbolDefinition;

// Catalog-only artwork. Placement uses the canonical DraftText renderer with
// content "...", so its dots and selection bounds are exactly those of the
// current default label font rather than a second symbol geometry contract.
const annotationEllipsis = {
  ...shared,
  id: "annotation-ellipsis",
  name: "Three dots",
  viewBox: { x: -12, y: -8, width: 24, height: 16 },
  primitives: [-6, 0, 6].map((x) => ({
    kind: "circle" as const,
    center: { x, y: 0 },
    radius: 1.25,
    fill: "foreground" as const,
    stroke: "none" as const,
  })),
} satisfies SymbolDefinition;

/**
 * Editor-only catalog artwork. These definitions never enter the electrical
 * SymbolResolver: drawing entries activate an existing tool, while polarity
 * and sign entries create editable DraftText objects.
 */
export const annotationPreviewSymbols: readonly SymbolDefinition[] = [
  annotationArrow,
  annotationLine,
  annotationRectangle,
  annotationCircle,
  annotationPolarityBoth,
  annotationTextPlus,
  annotationTextMinus,
  annotationEllipsis,
];
