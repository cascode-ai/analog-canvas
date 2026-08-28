import { createEmptyDocument } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import {
  draftingGroupBounds,
  draftingGroupScaleRange,
  scaleDraftingGroup,
} from "./drafting-group-scale";

const resolver = new InMemorySymbolResolver(builtInSymbols);

describe("drafting group scale", () => {
  it("scales waveform geometry and ordinary Text typography about one pivot", () => {
    const document = createEmptyDocument("main", "Waveform");
    document.drafting = {
      objects: [
        {
          id: "label",
          kind: "text",
          locked: false,
          zIndex: 0,
          anchor: { kind: "free", position: { x: 20, y: 20 } },
          content: { runs: [{ kind: "text", value: "CK" }] },
          alignment: "start",
          rotation: 0,
          typographyToken: "label",
        },
        {
          id: "trace",
          kind: "construction-line",
          locked: false,
          zIndex: 0,
          anchor: { kind: "free", position: { x: 100, y: 20 } },
          points: [
            { x: 100, y: 20 },
            { x: 200, y: 20 },
            { x: 200, y: 40 },
          ],
          lineStyle: "solid",
        },
      ],
    };

    const scaled = scaleDraftingGroup(
      document,
      ["label", "trace"],
      { x: 20, y: 20 },
      1.5,
    );
    expect(scaled).not.toBeNull();
    expect(scaled?.[0]).toMatchObject({
      id: "label",
      anchor: { position: { x: 20, y: 20 } },
      styleOverride: { sizeScale: 1.5 },
    });
    expect(scaled?.[1]).toMatchObject({
      id: "trace",
      styleOverride: { strokeScale: 1.5 },
      points: [
        { x: 140, y: 20 },
        { x: 290, y: 20 },
        { x: 290, y: 50 },
      ],
    });
  });

  it("keeps geometry, text, and every waveform stroke on one scale factor", () => {
    const document = createEmptyDocument("main", "Waveform strokes");
    document.drafting = {
      objects: [
        {
          id: "trace",
          kind: "construction-line",
          locked: false,
          zIndex: 0,
          anchor: { kind: "free", position: { x: 20, y: 20 } },
          points: [
            { x: 20, y: 20 },
            { x: 120, y: 20 },
          ],
          lineStyle: "solid",
          styleOverride: { strokeScale: 1.5 },
        },
        {
          id: "guide",
          kind: "construction-line",
          locked: false,
          zIndex: 0,
          anchor: { kind: "free", position: { x: 40, y: 20 } },
          points: [
            { x: 40, y: 20 },
            { x: 40, y: 80 },
          ],
          lineStyle: "dashed",
          styleOverride: { strokeScale: 0.75 },
        },
      ],
    };

    expect(draftingGroupScaleRange(document, ["trace", "guide"])).toEqual({
      min: 1 / 3,
      max: 8 / 3,
    });
    const scaled = scaleDraftingGroup(
      document,
      ["trace", "guide"],
      { x: 20, y: 20 },
      2,
    );
    expect(scaled?.map((object) => object.styleOverride?.strokeScale)).toEqual([
      3, 1.5,
    ]);
  });

  it("resolves one selection box for every object in the snapshot", () => {
    const document = createEmptyDocument("main", "Waveform bounds");
    document.drafting = {
      objects: [
        {
          id: "a",
          kind: "construction-line",
          locked: false,
          zIndex: 0,
          anchor: { kind: "free", position: { x: 20, y: 20 } },
          points: [
            { x: 20, y: 20 },
            { x: 100, y: 20 },
          ],
          lineStyle: "solid",
        },
        {
          id: "b",
          kind: "construction-line",
          locked: false,
          zIndex: 0,
          anchor: { kind: "free", position: { x: 20, y: 80 } },
          points: [
            { x: 20, y: 80 },
            { x: 160, y: 80 },
          ],
          lineStyle: "solid",
        },
      ],
    };

    const bounds = draftingGroupBounds(document, resolver, ["a", "b"]);
    expect(bounds).not.toBeNull();
    expect(bounds!.width).toBeGreaterThan(130);
    expect(bounds!.height).toBeGreaterThan(50);
  });
});
