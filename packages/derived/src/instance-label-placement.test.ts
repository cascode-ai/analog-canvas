import { createEmptyDocument } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import {
  defaultInstanceLabelPlacement,
  isBjtSymbol,
  isMosSymbol,
} from "./instance-label-placement.js";
import { resolveSchematicStyleProfile } from "./style-profile.js";
import { visibleSymbolInkBounds } from "./visual.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
const profile = resolveSchematicStyleProfile("razavi-textbook-v1");

function placedInstance(symbolId: "nmos" | "npn" | "pnp", rotation = 0) {
  return {
    id: "Q1",
    symbolId,
    placement: {
      position: { x: 100, y: 100 },
      rotation: rotation as 0 | 90 | 180 | 270,
      mirror: "none" as const,
    },
    properties: {},
  };
}

function placedDefaultLabel(
  symbolId: string,
  rotation: 0 | 90 | 180 | 270 = 0,
  mirror: "none" | "x" = "none",
  symbolVariantId?: string,
) {
  const resolved = resolver.resolve(symbolId, symbolVariantId);
  if (!resolved) throw new Error(`Missing symbol: ${symbolId}`);
  const placement = defaultInstanceLabelPlacement(
    {
      id: `${symbolId}-1`,
      symbolId,
      ...(symbolVariantId ? { symbolVariantId } : {}),
      placement: { position: { x: 100, y: 100 }, rotation, mirror },
      properties: {},
    },
    resolved,
    profile,
    10,
  );
  if (!placement) throw new Error("Placed instance must receive a label");
  return placement;
}

describe("instance label placement", () => {
  it("uses the MOS channel-side rule for NPN and PNP names", () => {
    const document = createEmptyDocument("labels", "Labels");
    for (const symbolId of ["npn", "pnp"] as const) {
      const instance = placedInstance(symbolId);
      document.instances = [instance];
      const resolved = resolver.resolve(symbolId);
      if (!resolved) throw new Error(`missing ${symbolId}`);

      expect(isBjtSymbol(resolved)).toBe(true);
      expect(isMosSymbol(resolved)).toBe(false);
      const label = defaultInstanceLabelPlacement(
        instance,
        resolved,
        profile,
        10,
      );
      expect(label).toMatchObject({
        alignment: "start",
        position: {
          x: expect.any(Number),
          y: expect.any(Number),
        },
      });
      const localBounds = visibleSymbolInkBounds(resolved);
      expect(label!.position.x).toBe(
        Math.round(
          (instance.placement.position.x +
            localBounds.x +
            localBounds.width +
            10) /
            10,
        ) * 10,
      );
    }
  });

  it("keeps BJT labels upright and outside the symbol after rotation", () => {
    const instance = placedInstance("npn", 90);
    const resolved = resolver.resolve("npn");
    if (!resolved) throw new Error("missing npn");

    expect(
      defaultInstanceLabelPlacement(instance, resolved, profile, 10),
    ).toEqual(
      expect.objectContaining({
        alignment: "middle",
        position: expect.objectContaining({ y: expect.any(Number) }),
      }),
    );
    expect(
      defaultInstanceLabelPlacement(instance, resolved, profile, 10)!.position
        .y,
    ).toBeGreaterThan(instance.placement.position.y);
  });

  it("places passive, source, and Port labels on their semantic sides", () => {
    expect(placedDefaultLabel("resistor")).toMatchObject({
      position: { x: 120, y: 110 },
      alignment: "start",
    });
    expect(placedDefaultLabel("voltage-source")).toMatchObject({
      position: { x: 120, y: 110 },
      alignment: "start",
    });
    expect(placedDefaultLabel("capacitor", 90)).toMatchObject({
      position: { x: 90, y: 130 },
      alignment: "middle",
    });
    expect(placedDefaultLabel("port")).toMatchObject({
      position: { x: 80, y: 110 },
      alignment: "end",
    });
  });

  it("uses visible MOS edges through variants, rotations, and mirrors", () => {
    expect(placedDefaultLabel("nmos")).toMatchObject({
      position: { x: 120, y: 110 },
      alignment: "start",
    });
    expect(
      placedDefaultLabel("nmos", 0, "none", "textbook-3terminal"),
    ).toMatchObject({ position: { x: 120, y: 110 }, alignment: "start" });
    expect(
      placedDefaultLabel("nmos", 90, "none", "textbook-3terminal"),
    ).toMatchObject({
      position: { x: 90, y: 140 },
      alignment: "middle",
    });
    expect(
      placedDefaultLabel("nmos", 270, "none", "textbook-3terminal"),
    ).toMatchObject({
      position: { x: 110, y: 70 },
      alignment: "middle",
    });
    expect(placedDefaultLabel("nmos", 0, "x")).toMatchObject({
      position: { x: 80, y: 110 },
      alignment: "end",
    });
  });
});
