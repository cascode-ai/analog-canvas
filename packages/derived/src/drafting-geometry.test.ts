import { createEmptyDocument } from "@icm/model";
import type { DraftingObject, SchematicDocument } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import {
  draftTextLayoutContent,
  resolveDraftingObjectGeometry,
} from "./drafting-geometry.js";
import {
  measureRichTextDocument,
  richTextMetrics,
} from "./rich-text-layout.js";
import { resolveDocumentStyleProfile } from "./style-profile.js";

/** The metrics a label lays out with, so a test measures what the app does. */
const labelMetrics = (document: SchematicDocument) =>
  richTextMetrics(resolveDocumentStyleProfile(document.presentation), "label");

const resolver = new InMemorySymbolResolver(builtInSymbols);

function rectangle(
  id: string,
  center: { x: number; y: number },
  width = 80,
  height = 40,
): Extract<DraftingObject, { kind: "rectangle" }> {
  return {
    id,
    kind: "rectangle",
    locked: false,
    zIndex: 0,
    anchor: { kind: "free", position: center },
    center,
    width,
    height,
    rotation: 0,
    lineStyle: "solid",
  };
}

function circle(
  id: string,
  center: { x: number; y: number },
  radius = 40,
): Extract<DraftingObject, { kind: "circle" }> {
  return {
    id,
    kind: "circle",
    locked: false,
    zIndex: 0,
    anchor: { kind: "free", position: center },
    center,
    radius,
    lineStyle: "solid",
  };
}

function anchoredLabel(
  id: string,
  rectangleId: string,
  fallbackPosition: { x: number; y: number },
): Extract<DraftingObject, { kind: "text" }> {
  return {
    id,
    kind: "text",
    locked: false,
    zIndex: 0,
    anchor: {
      kind: "object",
      objectId: rectangleId,
      localOffset: { x: 0, y: 0 },
      fallbackPosition,
    },
    content: { runs: [{ kind: "text", value: "PFD" }] },
    alignment: "middle",
    rotation: 0,
    typographyToken: "label",
  };
}

function documentWith(objects: DraftingObject[]): SchematicDocument {
  const document = createEmptyDocument("doc", "Drafting");
  document.drafting = { objects };
  return document;
}

describe("object-anchored drafting text on rectangles", () => {
  it("resolves circle geometry from its center and radius", () => {
    const object = circle("circle-1", { x: 100, y: 60 }, 30);
    const geometry = resolveDraftingObjectGeometry(
      documentWith([object]),
      resolver,
      object,
    );
    expect(geometry).toMatchObject({
      kind: "circle",
      center: { x: 100, y: 60 },
      radius: 30,
      bounds: { x: 64, y: 24, width: 72, height: 72 },
    });
  });
  it("resolves the label at the rectangle center", () => {
    const document = documentWith([
      rectangle("box-1", { x: 100, y: 60 }),
      anchoredLabel("label-1", "box-1", { x: 0, y: 0 }),
    ]);
    const geometry = resolveDraftingObjectGeometry(
      document,
      resolver,
      document.drafting!.objects[1]!,
    );
    expect(geometry.kind).toBe("text");
    if (geometry.kind !== "text") return;
    expect(geometry.position).toEqual({ x: 100, y: 60 });
    expect(geometry.diagnostics).toEqual([]);
    // Bounds stay centered on the resolved anchor.
    expect(geometry.bounds.x + geometry.bounds.width / 2).toBeCloseTo(100);
    expect(geometry.bounds.y + geometry.bounds.height / 2).toBeCloseTo(60);
  });

  it("wraps a long label inside its box instead of running past the edges", () => {
    const label = anchoredLabel("label-1", "box-1", { x: 0, y: 0 });
    label.content = {
      runs: [{ kind: "text", value: "A very long bias network label indeed" }],
    };
    const document = documentWith([
      rectangle("box-1", { x: 100, y: 60 }, 120, 80),
      label,
    ]);
    const geometry = resolveDraftingObjectGeometry(
      document,
      resolver,
      document.drafting!.objects[1]!,
    );
    if (geometry.kind !== "text") throw new Error("expected text geometry");

    // The label is inside a box, so it wraps to that box rather than spilling
    // out both sides of it.
    expect(geometry.bounds.width).toBeLessThanOrEqual(120);
    const laidOut = draftTextLayoutContent(
      document,
      label,
      labelMetrics(document),
    );
    expect(
      laidOut.runs.filter((run) => run.kind === "line-break").length,
    ).toBeGreaterThan(0);
    // Wrapping is a layout act, not an edit: every word survives, in order.
    const words = laidOut.runs
      .map((run) => (run.kind === "text" ? run.value : " "))
      .join("")
      .split(/\s+/u)
      .filter(Boolean);
    expect(words.join(" ")).toBe("A very long bias network label indeed");
    // The stored content is untouched; only the laid-out copy carries breaks.
    expect(label.content.runs).toHaveLength(1);
  });

  it("leaves a label that already fits on one line", () => {
    const document = documentWith([
      rectangle("box-1", { x: 100, y: 60 }, 120, 80),
      anchoredLabel("label-1", "box-1", { x: 0, y: 0 }),
    ]);
    const geometry = resolveDraftingObjectGeometry(
      document,
      resolver,
      document.drafting!.objects[1]!,
    );
    if (geometry.kind !== "text") throw new Error("expected text geometry");
    const laidOut = draftTextLayoutContent(
      document,
      document.drafting!.objects[1] as Extract<
        DraftingObject,
        { kind: "text" }
      >,
      labelMetrics(document),
    );
    expect(laidOut.runs.some((run) => run.kind === "line-break")).toBe(false);
  });

  it("keeps the resolved center in sync with a moved rectangle", () => {
    const moved = documentWith([
      rectangle("box-1", { x: 250, y: -30 }),
      anchoredLabel("label-1", "box-1", { x: 0, y: 0 }),
    ]);
    const geometry = resolveDraftingObjectGeometry(
      moved,
      resolver,
      moved.drafting!.objects[1]!,
    );
    if (geometry.kind !== "text") throw new Error("expected text geometry");
    expect(geometry.position).toEqual({ x: 250, y: -30 });
  });

  it("applies the local offset relative to the rectangle center", () => {
    const label = anchoredLabel("label-1", "box-1", { x: 0, y: 0 });
    label.anchor = {
      kind: "object",
      objectId: "box-1",
      localOffset: { x: 10, y: -5 },
      fallbackPosition: { x: 0, y: 0 },
    };
    const document = documentWith([
      rectangle("box-1", { x: 100, y: 60 }),
      label,
    ]);
    const geometry = resolveDraftingObjectGeometry(document, resolver, label);
    if (geometry.kind !== "text") throw new Error("expected text geometry");
    expect(geometry.position).toEqual({ x: 110, y: 55 });
  });

  it("falls back with a missing-target diagnostic when the rectangle is gone", () => {
    const document = documentWith([
      anchoredLabel("label-1", "box-gone", { x: 40, y: 20 }),
    ]);
    const geometry = resolveDraftingObjectGeometry(
      document,
      resolver,
      document.drafting!.objects[0]!,
    );
    if (geometry.kind !== "text") throw new Error("expected text geometry");
    expect(geometry.position).toEqual({ x: 40, y: 20 });
    expect(geometry.diagnostics).toHaveLength(1);
    expect(geometry.diagnostics[0]).toMatchObject({
      code: "DRAFTING_ANCHOR_TARGET_MISSING",
      anchorRole: "anchor",
      targetObjectIds: ["box-gone"],
    });
  });

  it("does not resolve non-rectangle drafting targets", () => {
    const otherText: Extract<DraftingObject, { kind: "text" }> = {
      id: "note-1",
      kind: "text",
      locked: false,
      zIndex: 0,
      anchor: { kind: "free", position: { x: 5, y: 5 } },
      content: { runs: [{ kind: "text", value: "free" }] },
      alignment: "start",
      rotation: 0,
    };
    const document = documentWith([
      otherText,
      anchoredLabel("label-1", "note-1", { x: 40, y: 20 }),
    ]);
    const geometry = resolveDraftingObjectGeometry(
      document,
      resolver,
      document.drafting!.objects[1]!,
    );
    if (geometry.kind !== "text") throw new Error("expected text geometry");
    expect(geometry.position).toEqual({ x: 40, y: 20 });
    expect(geometry.diagnostics[0]?.code).toBe(
      "DRAFTING_ANCHOR_TARGET_MISSING",
    );
  });
});

describe("the box of free drafting text", () => {
  it("sits on the glyphs above the baseline, as a label's box does", () => {
    // Free text stands on its anchor by its first baseline. Its box used to
    // be centered on that baseline, leaving half of it empty below R_P.
    const note: Extract<DraftingObject, { kind: "text" }> = {
      id: "note-rp",
      kind: "text",
      locked: false,
      zIndex: 0,
      anchor: { kind: "free", position: { x: 430, y: 185 } },
      content: {
        runs: [
          { kind: "text", value: "R" },
          {
            kind: "span",
            style: "subscript",
            children: [{ kind: "text", value: "P" }],
          },
        ],
      },
      alignment: "middle",
      rotation: 0,
      typographyToken: "label",
    };
    const document = documentWith([note]);
    const geometry = resolveDraftingObjectGeometry(document, resolver, note);
    const fontSize = labelMetrics(document).fontSize;
    expect(geometry.bounds.y).toBeCloseTo(185 - fontSize * 1.05);
    // Past the baseline only by a descent, not by half the box.
    const below = geometry.bounds.y + geometry.bounds.height - 185;
    expect(below).toBeGreaterThan(0);
    expect(below).toBeLessThan(fontSize * 0.5);
    // Centered text keeps a box centered on its anchor.
    const box = rectangle("box-1", { x: 100, y: 60 });
    const centered: Extract<DraftingObject, { kind: "text" }> = {
      ...note,
      id: "note-centered",
      anchor: {
        kind: "object",
        objectId: box.id,
        localOffset: { x: 0, y: 0 },
        fallbackPosition: { x: 100, y: 60 },
      },
    };
    const inBox = resolveDraftingObjectGeometry(
      documentWith([box, centered]),
      resolver,
      centered,
    );
    expect(inBox.bounds.y + inBox.bounds.height / 2).toBeCloseTo(60);
  });
});

describe("polarity drafting text", () => {
  function polarityText(
    polarity: "both" | "positive" | "negative",
    rotation: 0 | 90 | 180 | 270 = 0,
  ): Extract<DraftingObject, { kind: "text" }> {
    return {
      id: `polarity-${polarity}`,
      kind: "text",
      locked: false,
      zIndex: 0,
      anchor: { kind: "free", position: { x: 100, y: 80 } },
      content: { runs: [{ kind: "text", value: "V_x" }] },
      alignment: "middle",
      rotation,
      typographyToken: "label",
      polarity,
    };
  }

  it("includes fixed plus and minus strokes in shared bounds", () => {
    const object = polarityText("both");
    const geometry = resolveDraftingObjectGeometry(
      documentWith([object]),
      resolver,
      object,
    );
    if (geometry.kind !== "text") throw new Error("expected text geometry");

    expect(geometry.textPosition).toEqual({ x: 100, y: 80 });
    expect(geometry.polarityLines.map((line) => line.role)).toEqual([
      "positive-horizontal",
      "positive-vertical",
      "negative",
    ]);
    expect(geometry.bounds.y).toBeLessThan(geometry.polarityLines[0]!.from.y);
    expect(geometry.bounds.y + geometry.bounds.height).toBeGreaterThan(
      geometry.polarityLines[2]!.from.y,
    );
  });

  it("centers each fixed one-sided mark exactly on its placement anchor", () => {
    const positive = polarityText("positive");
    const negative = polarityText("negative");
    const positiveGeometry = resolveDraftingObjectGeometry(
      documentWith([positive]),
      resolver,
      positive,
    );
    const negativeGeometry = resolveDraftingObjectGeometry(
      documentWith([negative]),
      resolver,
      negative,
    );
    if (positiveGeometry.kind !== "text" || negativeGeometry.kind !== "text") {
      throw new Error("expected text geometry");
    }

    expect(positiveGeometry.textPosition).toEqual({ x: 100, y: 80 });
    expect(negativeGeometry.textPosition).toEqual({ x: 100, y: 80 });
    expect(positiveGeometry.polarityLines).toHaveLength(2);
    expect(negativeGeometry.polarityLines).toHaveLength(1);
    expect(
      positiveGeometry.polarityLines.every(
        (line) => line.from.y <= 80 && line.to.y >= 80,
      ),
    ).toBe(true);
    expect(negativeGeometry.polarityLines[0]).toMatchObject({
      from: { y: 80 },
      to: { y: 80 },
    });
    expect(positiveGeometry.position).toEqual({ x: 100, y: 80 });
    expect(negativeGeometry.position).toEqual({ x: 100, y: 80 });
    // Hidden placeholder content must not inflate the hit/selection box.
    for (const geometry of [positiveGeometry, negativeGeometry]) {
      expect(geometry.bounds.x + geometry.bounds.width / 2).toBeCloseTo(100);
      expect(geometry.bounds.y + geometry.bounds.height / 2).toBeCloseTo(80);
      expect(geometry.bounds.width).toBeLessThan(15);
      expect(geometry.bounds.height).toBeLessThan(15);
    }
  });

  it("rotates the polarity layout while keeping every mark upright", () => {
    const horizontal = polarityText("both", 0);
    const vertical = polarityText("both", 90);
    const horizontalGeometry = resolveDraftingObjectGeometry(
      documentWith([horizontal]),
      resolver,
      horizontal,
    );
    const verticalGeometry = resolveDraftingObjectGeometry(
      documentWith([vertical]),
      resolver,
      vertical,
    );
    if (
      horizontalGeometry.kind !== "text" ||
      verticalGeometry.kind !== "text"
    ) {
      throw new Error("expected text geometry");
    }

    const horizontalPositive = horizontalGeometry.polarityLines[0]!;
    const horizontalNegative = horizontalGeometry.polarityLines[2]!;
    const verticalPositive = verticalGeometry.polarityLines[0]!;
    const verticalPositiveStem = verticalGeometry.polarityLines[1]!;
    const verticalNegative = verticalGeometry.polarityLines[2]!;

    expect(horizontalPositive.from.y).toBeLessThan(80);
    expect(horizontalNegative.from.y).toBeGreaterThan(80);
    expect(verticalPositive.from.x).toBeGreaterThan(100);
    expect(verticalNegative.from.x).toBeLessThan(100);
    expect(verticalPositive.from.y).toBeCloseTo(verticalPositive.to.y);
    expect(verticalNegative.from.y).toBeCloseTo(verticalNegative.to.y);
    expect(verticalPositiveStem.from.x).toBeCloseTo(verticalPositiveStem.to.x);
    expect(verticalGeometry.position).toEqual({ x: 100, y: 80 });
    expect(verticalGeometry.textPosition).toEqual({ x: 100, y: 80 });
  });

  it("moves marks beside the text out with a longer name", () => {
    const beside = (value: string) => {
      const object = {
        ...polarityText("both", 270),
        content: { runs: [{ kind: "text" as const, value }] },
      };
      const document = documentWith([object]);
      const geometry = resolveDraftingObjectGeometry(
        document,
        resolver,
        object,
      );
      if (geometry.kind !== "text") throw new Error("expected text geometry");
      const [positive, , negative] = geometry.polarityLines;
      // Measured as drafting text draws by default: bold, upright.
      const textWidth = measureRichTextDocument(
        object.content,
        richTextMetrics(
          resolveDocumentStyleProfile(document.presentation),
          "label",
          1,
          { bold: true, italic: false },
        ),
      ).width;
      return { positive: positive!, negative: negative!, textWidth };
    };
    const short = beside("Q");
    const long = beside("Qin0long");
    expect(long.textWidth).toBeGreaterThan(short.textWidth);
    // + on the left and − on the right, each clear of the text's side.
    for (const { positive, negative, textWidth } of [short, long]) {
      expect(Math.max(positive.from.x, positive.to.x)).toBeLessThan(
        100 - textWidth / 2,
      );
      expect(Math.min(negative.from.x, negative.to.x)).toBeGreaterThan(
        100 + textWidth / 2,
      );
    }
    expect(long.negative.from.x - short.negative.from.x).toBeCloseTo(
      (long.textWidth - short.textWidth) / 2,
    );
  });
});
