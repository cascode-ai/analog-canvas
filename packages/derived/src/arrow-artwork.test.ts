import { describe, expect, it } from "vitest";
import type { ArrowEndStyle } from "@icm/model";
import {
  arrowArtwork,
  arrowArtworkBounds,
  arrowEndStyles,
} from "./arrow-artwork.js";
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
      const head = result.heads[index]!.points;
      expect(result.shaft[index]!.x).toBeCloseTo((head[1]!.x + head[2]!.x) / 2);
      expect(result.shaft[index]!.y).toBeCloseTo((head[1]!.y + head[2]!.y) / 2);
    }
  });
  it("combines every endpoint style independently and bounds the complete artwork", () => {
    const styles: ArrowEndStyle[] = [
      "small-arrow",
      "medium-arrow",
      "large-arrow",
      "dot",
      "none",
      "open-arrow",
    ];
    for (const start of styles)
      for (const end of styles) {
        const art = arrowArtwork(
          { styleOverride: { arrowStart: start, arrowEnd: end } },
          points,
          [],
          profile,
        );
        const active = [start, end].filter((s) => s !== "dot" && s !== "none");
        expect(art.heads).toHaveLength(active.length);
        expect(art.heads.map((h) => h.style)).toEqual(
          active.map((s) => (s === "open-arrow" ? "open" : "filled")),
        );
        expect(art.dots.map((d) => d.center)).toEqual(
          points.filter((_, i) => [start, end][i] === "dot"),
        );
        const bounds = arrowArtworkBounds(art);
        for (const { center, radius } of art.dots) {
          expect(bounds.x).toBeLessThanOrEqual(center.x - radius);
          expect(bounds.y).toBeLessThanOrEqual(center.y - radius);
          expect(bounds.x + bounds.width).toBeGreaterThanOrEqual(
            center.x + radius,
          );
          expect(bounds.y + bounds.height).toBeGreaterThanOrEqual(
            center.y + radius,
          );
        }
        for (const head of art.heads) {
          const width = Math.hypot(
            head.points[1]!.x - head.points[2]!.x,
            head.points[1]!.y - head.points[2]!.y,
          );
          const style = head.points[0]!.x === 0 ? start : end;
          expect(width).toBeCloseTo(
            profile.annotations.arrowHeadWidth *
              (style === "small-arrow"
                ? 0.75
                : style === "large-arrow"
                  ? 1.5
                  : 1),
          );
        }
      }
  });
  it("keeps the unedited legacy end's exact scale and applies explicit overrides over legacy none", () => {
    expect(
      arrowEndStyles({
        styleOverride: {
          arrowHeadAt: "both",
          arrowHeadScale: 1.25,
          arrowStart: "dot",
        },
      }),
    ).toEqual({
      start: { style: "dot", scale: 1 },
      end: { style: "medium-arrow", scale: 1.25 },
    });
    const art = arrowArtwork(
      {
        styleOverride: {
          arrowHead: "none",
          arrowStart: "small-arrow",
          arrowEnd: "large-arrow",
        },
      },
      points,
      [{ x: 50, y: 50 }],
      profile,
    );
    expect(art.heads).toHaveLength(2);
    for (let i = 0; i < 2; i++) {
      const head = art.heads[i]!.points;
      expect(art.shaft[i]!.x).toBeCloseTo((head[1]!.x + head[2]!.x) / 2);
      expect(art.shaft[i]!.y).toBeCloseTo((head[1]!.y + head[2]!.y) / 2);
      expect(Math.abs(head[0]!.x - art.shaft[i]!.x)).toBeCloseTo(
        Math.abs(head[0]!.y - art.shaft[i]!.y),
      );
    }
  });
  it("supports independently sized outline heads, dots, and bare ends", () => {
    const art = arrowArtwork(
      {
        outline: { width: 30 },
        styleOverride: { arrowStart: "small-arrow", arrowEnd: "large-arrow" },
      },
      points,
      [],
      profile,
    );
    expect(art.outline).toContainEqual({ x: 19.125, y: -11.25 });
    expect(art.outline).toContainEqual({ x: 61.75, y: 22.5 });
    const dotted = arrowArtwork(
      {
        outline: { width: 30 },
        styleOverride: { arrowStart: "dot", arrowEnd: "none" },
      },
      points,
      [],
      profile,
    );
    expect(dotted.outline).toEqual([
      { x: 0, y: -6 },
      { x: 100, y: -6 },
      { x: 100, y: 6 },
      { x: 0, y: 6 },
    ]);
    expect(dotted.dots).toEqual([{ center: points[0], radius: 9 }]);
    expect(arrowArtworkBounds(dotted).x).toBeLessThan(-9);
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
