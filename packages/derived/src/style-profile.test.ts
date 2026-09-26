import { describe, expect, it } from "vitest";

import {
  globalSchematicTypography,
  objectStyleProfile,
  razaviTextbookProfile,
  resolveDocumentStyleProfile,
  resolvePrimitiveStrokeWidth,
  resolveSchematicStyleProfile,
  sameDocumentStyle,
  strokeWidthForRole,
} from "./style-profile.js";

describe("schematic style profiles", () => {
  it("uses one calibrated typography system", () => {
    expect(razaviTextbookProfile.typography).toBe(globalSchematicTypography);
  });

  it("uses the authority-calibrated Razavi text metrics", () => {
    expect(globalSchematicTypography).toMatchObject({
      fontFamily:
        "'ICM Round Period','DejaVu Sans',Arial,'Helvetica Neue',Helvetica,sans-serif",
      instanceFontSize: 15.116,
      subscriptScale: 0.76,
      subscriptBaselineShiftEm: 0.44,
      subscriptHorizontalGapEm: 0.046,
    });
  });

  it("resolves the immutable presentation and stroke tokens", () => {
    expect(resolveSchematicStyleProfile("razavi-textbook-v1")).toBe(
      razaviTextbookProfile,
    );
    expect(strokeWidthForRole(razaviTextbookProfile, "normal")).toBe(1.6);
    expect(strokeWidthForRole(razaviTextbookProfile, "emphasis")).toBe(2.4);
    expect(strokeWidthForRole(razaviTextbookProfile, "ground")).toBe(2.906977);
    expect(razaviTextbookProfile.nodes).toEqual({ junctionRadius: 3.77907 });
    expect(razaviTextbookProfile.annotations).toEqual({
      supplyBarWidth: 20,
      currentArrowLength: 53.488372,
      arrowHeadLength: 16.569767,
      arrowHeadWidth: 7.906977,
      currentLabelGap: 6.976744,
      polarityOffsetX: 12,
      polarityHalfGap: 8,
    });
    expect(
      resolvePrimitiveStrokeWidth(razaviTextbookProfile, undefined, 2),
    ).toBe(2);
  });

  it("rejects an unknown persisted profile instead of substituting", () => {
    expect(() => resolveSchematicStyleProfile("unknown-profile")).toThrow(
      "Unknown schematic style profile",
    );
  });
});

describe("resolveDocumentStyleProfile", () => {
  const presentation = (styleOverrides?: object) => ({
    styleProfileId: "razavi-textbook-v1",
    ...(styleOverrides ? { styleOverrides } : {}),
  });

  it("returns the base profile object itself without overrides", () => {
    expect(resolveDocumentStyleProfile(presentation())).toBe(
      razaviTextbookProfile,
    );
  });

  it("composes each bounded scale independently over the base profile", () => {
    const profile = resolveDocumentStyleProfile(
      presentation({
        fontScale: 1.5,
        wireStrokeScale: 2,
        symbolStrokeScale: 0.5,
        annotationStrokeScale: 1.25,
        junctionRadiusScale: 2,
      }),
    );
    expect(profile.typography.annotationFontSize).toBeCloseTo(
      razaviTextbookProfile.typography.annotationFontSize * 1.5,
    );
    expect(profile.typography.captionFontSize).toBeCloseTo(
      razaviTextbookProfile.typography.captionFontSize * 1.5,
    );
    expect(profile.strokes.wire).toBeCloseTo(
      razaviTextbookProfile.strokes.wire * 2,
    );
    expect(profile.strokes.emphasis).toBeCloseTo(
      razaviTextbookProfile.strokes.emphasis * 0.5,
    );
    expect(profile.strokes.powerRail).toBeCloseTo(
      razaviTextbookProfile.strokes.powerRail * 0.5,
    );
    expect(profile.strokes.annotation).toBeCloseTo(
      razaviTextbookProfile.strokes.annotation * 1.25,
    );
    expect(profile.nodes.junctionRadius).toBeCloseTo(
      razaviTextbookProfile.nodes.junctionRadius * 2,
    );
    // Untouched families keep their base values.
    expect(profile.typography.subscriptScale).toBe(
      razaviTextbookProfile.typography.subscriptScale,
    );
    expect(profile.lineCap).toBe(razaviTextbookProfile.lineCap);
  });

  it("treats absent factors as exactly one", () => {
    const profile = resolveDocumentStyleProfile(presentation({ fontScale: 2 }));
    expect(profile.strokes.wire).toBe(razaviTextbookProfile.strokes.wire);
    expect(profile.nodes.junctionRadius).toBe(
      razaviTextbookProfile.nodes.junctionRadius,
    );
  });

  it("stays referentially stable for one persisted overrides object", () => {
    const shared = presentation({ fontScale: 1.5 });
    expect(resolveDocumentStyleProfile(shared)).toBe(
      resolveDocumentStyleProfile(shared),
    );
  });
});

describe("objectStyleProfile", () => {
  const documentProfile = resolveDocumentStyleProfile({
    styleProfileId: "razavi-textbook-v1",
    styleOverrides: { fontScale: 2 },
  });

  it("draws an object without a kept style like its Document", () => {
    expect(objectStyleProfile(documentProfile, {})).toBe(documentProfile);
    expect(objectStyleProfile(documentProfile, undefined)).toBe(
      documentProfile,
    );
  });

  it("replaces the Document's factors with the kept ones", () => {
    const kept = { documentStyle: { wireStrokeScale: 1.5 } };
    const profile = objectStyleProfile(documentProfile, kept);
    expect(profile.typography.annotationFontSize).toBe(
      razaviTextbookProfile.typography.annotationFontSize,
    );
    expect(profile.strokes.wire).toBeCloseTo(
      razaviTextbookProfile.strokes.wire * 1.5,
    );
    // Resolving again from an object's own profile changes nothing.
    expect(objectStyleProfile(profile, kept)).toEqual(profile);
  });
});

describe("sameDocumentStyle", () => {
  it("compares kept factors with 1 for any left out", () => {
    expect(sameDocumentStyle(undefined, undefined)).toBe(true);
    expect(sameDocumentStyle({}, { fontScale: 1 })).toBe(true);
    expect(sameDocumentStyle({ fontScale: 2 }, { fontScale: 2 })).toBe(true);
    expect(sameDocumentStyle({ fontScale: 2 }, {})).toBe(false);
  });

  it("never equates a kept style with following the Document", () => {
    expect(sameDocumentStyle({}, undefined)).toBe(false);
    expect(sameDocumentStyle(undefined, { fontScale: 2 })).toBe(false);
  });
});
