import { resolveDraftingObjectGeometry } from "@icm/derived";
import { createEmptyDocument, defaultDraftTextDocument } from "@icm/model";
import type { DraftingObject } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import {
  annotationPolarity,
  isAnnotationPaletteSymbol,
  isBarePolaritySign,
} from "./annotation-preview-symbols";

const resolver = new InMemorySymbolResolver(builtInSymbols);

/** The + and − strokes a drafting object actually commits to the canvas. */
function polarityMarks(
  polarity: "both" | "positive" | "negative",
  content: DraftingObject extends never
    ? never
    : ReturnType<typeof defaultDraftTextDocument>,
) {
  const document = createEmptyDocument("main", "Main");
  const object = {
    id: "mark",
    kind: "text" as const,
    locked: false,
    zIndex: 0,
    anchor: { kind: "free" as const, position: { x: 0, y: 0 } },
    content,
    alignment: "middle" as const,
    rotation: 0 as const,
    typographyToken: "label" as const,
    polarity,
  };
  document.drafting = { objects: [object] };
  const geometry = resolveDraftingObjectGeometry(document, resolver, object);
  if (geometry.kind !== "text") throw new Error("expected text geometry");
  return geometry.polarityLines;
}

/** Arm half-length, which is what "the same size" means for these marks. */
function armSpan(line: { from: { x: number }; to: { x: number } }): number {
  return Math.abs(line.to.x - line.from.x);
}

const emptyCentre = { runs: [{ kind: "line-break" as const }] };

describe("polarity annotations", () => {
  it("treats a lone sign as a polarity mark, not as text", () => {
    expect(annotationPolarity("annotation-polarity-both")).toBe("both");
    expect(annotationPolarity("annotation-text-plus")).toBe("positive");
    expect(annotationPolarity("annotation-text-minus")).toBe("negative");
    expect(isBarePolaritySign("annotation-text-plus")).toBe(true);
    expect(isBarePolaritySign("annotation-polarity-both")).toBe(false);
    expect(isAnnotationPaletteSymbol("annotation-text-minus")).toBe(true);
  });

  it("draws a lone sign at exactly the size the pair draws it", () => {
    const pair = polarityMarks("both", defaultDraftTextDocument("V_x"));
    const lonePlus = polarityMarks("positive", emptyCentre);
    const loneMinus = polarityMarks("negative", emptyCentre);

    const pairPlus = pair.find((line) => line.role === "positive-horizontal")!;
    const pairMinus = pair.find((line) => line.role === "negative")!;
    const solePlus = lonePlus.find(
      (line) => line.role === "positive-horizontal",
    )!;
    const soleMinus = loneMinus.find((line) => line.role === "negative")!;

    // The whole point: a sign standing on its own is the same mark as the
    // one the pair brackets a name with. Drawn as a font glyph it never was.
    expect(armSpan(solePlus)).toBe(armSpan(pairPlus));
    expect(armSpan(soleMinus)).toBe(armSpan(pairMinus));
    // And the plus stays square — arms of equal length, not a glyph's shape.
    const soleVertical = lonePlus.find(
      (line) => line.role === "positive-vertical",
    )!;
    expect(Math.abs(soleVertical.to.y - soleVertical.from.y)).toBeCloseTo(
      armSpan(solePlus),
      10,
    );
  });

  it("puts a lone sign on the spot, with no second mark beside it", () => {
    expect(polarityMarks("positive", emptyCentre).map((l) => l.role)).toEqual([
      "positive-horizontal",
      "positive-vertical",
    ]);
    expect(polarityMarks("negative", emptyCentre).map((l) => l.role)).toEqual([
      "negative",
    ]);
  });
});
