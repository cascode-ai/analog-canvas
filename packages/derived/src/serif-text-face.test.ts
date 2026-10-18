import { describe, expect, it } from "vitest";

import type { RichTextDocument } from "@icm/model";

import { schematicTextAdvanceEm } from "./fraction-text-metrics.js";
import { measureLabelText, richTextMetrics } from "./rich-text-layout.js";
import {
  objectStyleProfile,
  razaviTextbookProfile,
  resolveDocumentStyleProfile,
  SERIF_FONT_FAMILY,
} from "./style-profile.js";

const presentation = { styleProfileId: "razavi-textbook-v1" };

describe("the Document's serif face (#1725)", () => {
  it("measures Liberation Serif's own advances, Times New Roman's metrics", () => {
    // Liberation Serif Regular at 2048 units per em: space 512, i 569, M 1821;
    // Bold M 1933.
    expect(schematicTextAdvanceEm(" iM", "plain", false, "serif")).toBeCloseTo(
      (512 + 569 + 1821) / 2048,
      9,
    );
    expect(schematicTextAdvanceEm("M", "bold", false, "serif")).toBeCloseTo(
      1933 / 2048,
      9,
    );
    expect(schematicTextAdvanceEm("M", "bold")).not.toBeCloseTo(1933 / 2048);
  });

  it("measures Greek in the serif face too, not in DejaVu", () => {
    // Liberation Serif Regular draws Ω itself, 1522 units wide.
    expect(schematicTextAdvanceEm("Ω", "plain", false, "serif")).toBeCloseTo(
      1522 / 2048,
      9,
    );
  });

  it("sets the whole profile in the serif stack and keeps every size", () => {
    const serif = resolveDocumentStyleProfile({
      ...presentation,
      textFace: "serif",
    });
    expect(serif.typography).toEqual({
      ...razaviTextbookProfile.typography,
      face: "serif",
      fontFamily: SERIF_FONT_FAMILY,
    });
    expect(serif.strokes).toBe(razaviTextbookProfile.strokes);
    expect(
      resolveDocumentStyleProfile({ ...presentation, textFace: "serif" }),
    ).toBe(serif);
    expect(resolveDocumentStyleProfile(presentation)).toBe(
      razaviTextbookProfile,
    );
  });

  it("composes with the Document's scales and with a copy's kept style", () => {
    const styleOverrides = { fontScale: 2 };
    const serif = resolveDocumentStyleProfile({
      ...presentation,
      styleOverrides,
      textFace: "serif",
    });
    expect(serif.typography.face).toBe("serif");
    expect(serif.typography.annotationFontSize).toBe(
      2 * razaviTextbookProfile.typography.annotationFontSize,
    );
    const kept = objectStyleProfile(
      resolveDocumentStyleProfile({ ...presentation, textFace: "serif" }),
      { documentStyle: { fontScale: 1.5 } },
    );
    expect(kept.typography.face).toBe("serif");
    expect(kept.typography.fontFamily).toBe(SERIF_FONT_FAMILY);
  });

  it("lays a label out in the face its Document draws it in", () => {
    const label = {
      runs: [{ kind: "text", value: "Vout" }],
    } as RichTextDocument;
    const serif = resolveDocumentStyleProfile({
      ...presentation,
      textFace: "serif",
    });
    const metrics = { ...richTextMetrics(serif), bold: true };
    expect(metrics.face).toBe("serif");
    expect(measureLabelText(label, metrics).width).toBeCloseTo(
      metrics.fontSize * schematicTextAdvanceEm("Vout", "bold", false, "serif"),
      9,
    );
    expect(
      measureLabelText(label, {
        ...richTextMetrics(razaviTextbookProfile),
        bold: true,
      }).width,
    ).not.toBeCloseTo(measureLabelText(label, metrics).width);
  });
});
