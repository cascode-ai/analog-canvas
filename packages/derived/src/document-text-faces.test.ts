import { describe, expect, it } from "vitest";

import type { RichTextDocument } from "@icm/model";

import { schematicTextAdvanceEm } from "./fraction-text-metrics.js";
import { measureLabelText, richTextMetrics } from "./rich-text-layout.js";
import {
  DOCUMENT_TEXT_FACE_FONT_FAMILIES,
  objectStyleProfile,
  razaviTextbookProfile,
  resolveDocumentStyleProfile,
  SERIF_FONT_FAMILY,
} from "./style-profile.js";

const presentation = { styleProfileId: "razavi-textbook-v1" };

describe("the Document's Arial and LaTeX faces (#1725)", () => {
  it("measures Liberation Sans's own advances, Arial's metrics", () => {
    // Liberation Sans Regular at 2048 units per em: space 569, i 455,
    // M 1706, Ω 1531; Bold M 1706.
    expect(schematicTextAdvanceEm(" iMΩ", "plain", false, "sans")).toBeCloseTo(
      (569 + 455 + 1706 + 1531) / 2048,
      9,
    );
    expect(schematicTextAdvanceEm("M", "bold", false, "sans")).toBeCloseTo(
      1706 / 2048,
      9,
    );
  });

  it("measures Latin Modern Roman's own advances", () => {
    // Latin Modern Roman 10 Regular at 1000 units per em: space 333, i 278,
    // M 917, Ω 722; Bold M 1092.
    expect(
      schematicTextAdvanceEm(" iMΩ", "plain", false, "latin-modern"),
    ).toBeCloseTo((333 + 278 + 917 + 722) / 1000, 9);
    expect(
      schematicTextAdvanceEm("M", "bold", false, "latin-modern"),
    ).toBeCloseTo(1092 / 1000, 9);
  });

  it("measures lowercase Greek, which Latin Modern Roman lacks, in DejaVu", () => {
    expect(
      schematicTextAdvanceEm("αβ", "plain", false, "latin-modern"),
    ).toBeCloseTo(schematicTextAdvanceEm("αβ", "plain"), 9);
  });

  it.each(["sans", "latin-modern"] as const)(
    "keeps the %s face's own full stop, not the round period",
    (face) => {
      expect(schematicTextAdvanceEm(".", "plain", false, face)).not.toBe(0.36);
      expect(schematicTextAdvanceEm(".", "plain")).toBe(0.36);
    },
  );

  it.each([
    ["sans", "'ICM Sans','Liberation Sans',Arial,"],
    ["latin-modern", "'ICM Modern','Latin Modern Roman',"],
  ] as const)(
    "sets the whole %s profile in its stack, with a copy's kept style too",
    (face, stack) => {
      const profile = resolveDocumentStyleProfile({
        ...presentation,
        textFace: face,
      });
      expect(DOCUMENT_TEXT_FACE_FONT_FAMILIES[face].startsWith(stack)).toBe(
        true,
      );
      expect(profile.typography).toEqual({
        ...razaviTextbookProfile.typography,
        face,
        fontFamily: DOCUMENT_TEXT_FACE_FONT_FAMILIES[face],
      });
      expect(
        resolveDocumentStyleProfile({ ...presentation, textFace: face }),
      ).toBe(profile);
      expect(
        resolveDocumentStyleProfile({ ...presentation, textFace: "serif" })
          .typography.fontFamily,
      ).toBe(SERIF_FONT_FAMILY);
      const kept = objectStyleProfile(profile, {
        documentStyle: { fontScale: 1.5 },
      });
      expect(kept.typography.face).toBe(face);
      expect(kept.typography.fontFamily).toBe(
        DOCUMENT_TEXT_FACE_FONT_FAMILIES[face],
      );
    },
  );

  it.each(["sans", "latin-modern"] as const)(
    "lays a label out in the %s face its Document draws it in",
    (face) => {
      const label = {
        runs: [{ kind: "text", value: "Vout" }],
      } as RichTextDocument;
      const metrics = {
        ...richTextMetrics(
          resolveDocumentStyleProfile({ ...presentation, textFace: face }),
        ),
        bold: true,
      };
      expect(metrics.face).toBe(face);
      expect(measureLabelText(label, metrics).width).toBeCloseTo(
        metrics.fontSize * schematicTextAdvanceEm("Vout", "bold", false, face),
        9,
      );
    },
  );
});
