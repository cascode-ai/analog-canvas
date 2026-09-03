import { describe, expect, it } from "vitest";
import { arrowArtwork, arrowArtworkBounds } from "./arrow-artwork.js";
import { razaviTextbookProfile as profile } from "./style-profile.js";

const points = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
];
describe("shared arrow artwork", () => {
  it("ends the legacy shaft on each head base plane and respects curved end tangents", () => {
    const result = arrowArtwork(
      { styleOverride: { arrowHeadAt: "both" } },
      points,
      [{ x: 50, y: 50 }],
      profile,
    );
    expect(result.heads).toHaveLength(2);
    for (let index = 0; index < 2; index++) {
      const head = result.heads[index]!;
      expect(result.shaft[index]!.x).toBeCloseTo((head[1]!.x + head[2]!.x) / 2);
      expect(result.shaft[index]!.y).toBeCloseTo((head[1]!.y + head[2]!.y) / 2);
    }
  });
  it("constructs one closed silhouette with no shaft and weight-independent dimensions", () => {
    const normal = arrowArtwork(
      { outline: { width: 30 } },
      points,
      [],
      profile,
    );
    const thick = arrowArtwork(
      { outline: { width: 30 }, styleOverride: { strokeScale: 2 } },
      points,
      [],
      profile,
    );
    expect(normal.outline).toHaveLength(7);
    expect(normal.shaft).toEqual([]);
    expect(normal.heads).toEqual([]);
    expect(thick.outline).toEqual(normal.outline);
    expect(thick.strokeWidth).toBe(normal.strokeWidth * 2);
    const bounds = arrowArtworkBounds(thick);
    for (const p of thick.outline!) {
      expect(p.x).toBeGreaterThanOrEqual(bounds.x);
      expect(p.x).toBeLessThanOrEqual(bounds.x + bounds.width);
      expect(p.y).toBeGreaterThanOrEqual(bounds.y);
      expect(p.y).toBeLessThanOrEqual(bounds.y + bounds.height);
    }
  });
  it("keeps short double outline arrows ordered rather than crossing their shoulders", () => {
    const art = arrowArtwork(
      { outline: { width: 90 }, styleOverride: { arrowHeadAt: "both" } },
      [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
      ],
      [],
      profile,
    );
    expect(art.outline![0]!.x).toBeLessThan(art.outline![1]!.x);
    expect(
      art.outline!.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
    ).toBe(true);
  });
});
