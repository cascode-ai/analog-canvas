import { describe, expect, it } from "vitest";

import {
  globalSchematicTypography,
  objectStyleProfile,
  razaviTextbookProfile,
  resolveDocumentStyleProfile,
  resolvePrimitiveStrokeWidth,
  resolveSchematicStyleProfile,
  sameDocumentStyle,
} from "./style-profile.js";

describe("schematic style profiles", () => {
  it("uses one calibrated typography system", () => {
    expect(razaviTextbookProfile.typography).toBe(globalSchematicTypography);
  });

  it("resolves the immutable profile and a stroke role over an explicit width", () => {
    expect(resolveSchematicStyleProfile("razavi-textbook-v1")).toBe(
      razaviTextbookProfile,
    );
    expect(
      resolvePrimitiveStrokeWidth(razaviTextbookProfile, "emphasis", 9),
    ).toBe(razaviTextbookProfile.strokes.emphasis);
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
