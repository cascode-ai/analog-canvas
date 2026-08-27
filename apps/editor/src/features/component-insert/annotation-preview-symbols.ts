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

const polarityBySymbolId = {
  "annotation-polarity-both": "both",
  "annotation-polarity-positive": "positive",
  "annotation-polarity-negative": "negative",
} as const satisfies Readonly<Record<string, PolarityAnnotationKind>>;

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

export function isAnnotationPaletteSymbol(symbolId: string): boolean {
  return Boolean(
    annotationDrawingTool(symbolId) ?? annotationPolarity(symbolId),
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

const annotationPolarityPositive = {
  ...shared,
  id: "annotation-polarity-positive",
  name: "Positive polarity (+ / text)",
  viewBox: { x: -14, y: -20, width: 28, height: 40 },
  primitives: [...plusStrokes(-11), ...textStrokes(7)],
} satisfies SymbolDefinition;

const annotationPolarityNegative = {
  ...shared,
  id: "annotation-polarity-negative",
  name: "Negative polarity (text / −)",
  viewBox: { x: -14, y: -20, width: 28, height: 40 },
  primitives: [...textStrokes(-7), ...minusStrokes(11)],
} satisfies SymbolDefinition;

/**
 * Editor-only catalog artwork. These definitions never enter the electrical
 * SymbolResolver: drawing entries activate an existing tool, while polarity
 * entries create editable DraftText objects.
 */
export const annotationPreviewSymbols: readonly SymbolDefinition[] = [
  annotationArrow,
  annotationLine,
  annotationRectangle,
  annotationCircle,
  annotationPolarityBoth,
  annotationPolarityPositive,
  annotationPolarityNegative,
];
