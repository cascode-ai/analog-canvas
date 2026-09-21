import { createEmptyDocument, transformPoint } from "@icm/model";
import {
  InMemorySymbolResolver,
  builtInSymbols,
  getRazaviCatalogEntry,
} from "@icm/symbols";
import { describe, expect, it } from "vitest";

import {
  defaultInstanceLabelPlacement,
  hasDifferentialInputs,
  isBjtSymbol,
  isMosSymbol,
} from "./instance-label-placement.js";
import type { InstanceLabelSlot } from "./instance-label-placement.js";
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
  };
}

function placedDefaultLabel(
  symbolId: string,
  rotation: 0 | 90 | 180 | 270 = 0,
  mirror: "none" | "horizontal" | "vertical" | "both" = "none",
  symbolVariantId?: string,
  slot: InstanceLabelSlot = "reference",
) {
  const resolved = resolver.resolve(symbolId, symbolVariantId);
  if (!resolved) throw new Error(`Missing symbol: ${symbolId}`);
  const placement = defaultInstanceLabelPlacement(
    {
      id: `${symbolId}-1`,
      symbolId,
      ...(symbolVariantId ? { symbolVariantId } : {}),
      placement: { position: { x: 100, y: 100 }, rotation, mirror },
    },
    resolved,
    profile,
    10,
    slot,
  );
  if (!placement) throw new Error("Placed instance must receive a label");
  return placement;
}

describe("instance label placement", () => {
  it.each(
    builtInSymbols
      .filter(
        (symbol) =>
          getRazaviCatalogEntry(symbol.id)?.category === "analog-block",
      )
      .map((symbol) => symbol.id),
  )(
    "keeps the %s label five units from the artwork through rotation and mirror",
    (symbolId) => {
      const bounds = visibleSymbolInkBounds(resolver.resolve(symbolId)!);
      for (const rotation of [0, 90, 180, 270] as const) {
        for (const mirror of [
          "none",
          "horizontal",
          "vertical",
          "both",
        ] as const) {
          const orientation = { rotation, mirror };
          const corners = [
            { x: bounds.x, y: bounds.y },
            { x: bounds.x + bounds.width, y: bounds.y },
            { x: bounds.x, y: bounds.y + bounds.height },
            { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
          ].map((point) =>
            transformPoint(point, { x: 100, y: 100 }, orientation),
          );
          const edgeDirection = transformPoint(
            { x: 0, y: 1 },
            { x: 0, y: 0 },
            orientation,
          );
          const label = placedDefaultLabel(symbolId, rotation, mirror);
          let gap: number;
          if (edgeDirection.y > 0) {
            gap =
              label.position.y -
              profile.typography.instanceFontSize * 0.7 -
              Math.max(...corners.map((p) => p.y));
            expect(label.alignment).toBe("middle");
          } else if (edgeDirection.y < 0) {
            gap = Math.min(...corners.map((p) => p.y)) - label.position.y;
            expect(label.alignment).toBe("middle");
          } else if (edgeDirection.x > 0) {
            gap = label.position.x - Math.max(...corners.map((p) => p.x));
            expect(label.alignment).toBe("start");
          } else {
            gap = Math.min(...corners.map((p) => p.x)) - label.position.x;
            expect(label.alignment).toBe("end");
          }
          expect(Math.abs(gap - 5)).toBeLessThanOrEqual(0.5);
        }
      }
    },
  );

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
      const gap =
        label!.position.x -
        (instance.placement.position.x + localBounds.x + localBounds.width);
      expect(Math.abs(gap - 5)).toBeLessThanOrEqual(0.5);
      expect(label!.position.y).toBe(105);
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
      position: { x: 110, y: 105 },
      alignment: "start",
    });
    expect(placedDefaultLabel("inductor-compact")).toMatchObject({
      position: { x: 113, y: 105 },
      alignment: "start",
    });
    expect(placedDefaultLabel("variable-resistor")).toMatchObject({
      position: { x: 117, y: 105 },
      alignment: "start",
    });
    expect(placedDefaultLabel("voltage-source")).toMatchObject({
      position: { x: 116, y: 105 },
      alignment: "start",
    });
    expect(placedDefaultLabel("capacitor", 90)).toMatchObject({
      position: { x: 100, y: 124 },
      alignment: "middle",
    });
    expect(placedDefaultLabel("port")).toMatchObject({
      position: { x: 80, y: 110 },
      alignment: "end",
    });
  });

  it("centers quarter-turned passive labels with the same five-unit clearance", () => {
    const resistor = resolver.resolve("resistor");
    if (!resistor) throw new Error("Missing resistor Symbol");
    expect(visibleSymbolInkBounds(resistor)).toEqual({
      x: -4.988372,
      y: -20,
      width: 10.360465,
      height: 40,
    });

    for (const rotation of [90, 270] as const) {
      for (const symbolId of ["resistor", "capacitor"]) {
        const label = placedDefaultLabel(symbolId, rotation);
        const bounds = visibleSymbolInkBounds(resolver.resolve(symbolId)!);
        const edge = bounds.x + bounds.width;
        const gap =
          rotation === 90
            ? label.position.y -
              profile.typography.instanceFontSize * 0.7 -
              (100 + edge)
            : 100 - edge - label.position.y;
        expect(Math.abs(gap - 5)).toBeLessThanOrEqual(0.5);
        expect(label.position.x).toBe(100);
      }
    }
  });

  it("places the T-coil reference above its routing corridor", () => {
    const resolved = resolver.resolve("tcoil");
    if (!resolved) throw new Error("missing tcoil");
    const bounds = visibleSymbolInkBounds(resolved);
    const label = placedDefaultLabel("tcoil");

    expect(label).toMatchObject({
      position: { x: 100 },
      alignment: "middle",
    });
    expect(label.position.y).toBeLessThan(100 + bounds.y);
  });

  it("uses visible MOS edges through variants, rotations, and mirrors", () => {
    expect(placedDefaultLabel("nmos")).toMatchObject({
      position: { x: 116, y: 105 },
      alignment: "start",
    });
    expect(
      placedDefaultLabel("nmos", 0, "none", "textbook-3terminal"),
    ).toMatchObject({ position: { x: 116, y: 105 }, alignment: "start" });
    expect(
      placedDefaultLabel("nmos", 90, "none", "textbook-3terminal"),
    ).toMatchObject({
      position: { x: 100, y: 126 },
      alignment: "middle",
    });
    expect(
      placedDefaultLabel("nmos", 270, "none", "textbook-3terminal"),
    ).toMatchObject({
      position: { x: 100, y: 84 },
      alignment: "middle",
    });
    expect(placedDefaultLabel("nmos", 0, "horizontal")).toMatchObject({
      position: { x: 84, y: 105 },
      alignment: "end",
    });
  });

  it("places the value slot one quantized text row below the reference", () => {
    const reference = placedDefaultLabel("resistor");
    const value = placedDefaultLabel("resistor", 0, "none", undefined, "value");
    expect(value.alignment).toBe(reference.alignment);
    expect(value.position.x).toBe(reference.position.x);
    expect(value.position.y - reference.position.y).toBe(30);
  });

  it("keeps the value slot on the transformed side after rotation", () => {
    const reference = placedDefaultLabel("capacitor", 90);
    const value = placedDefaultLabel(
      "capacitor",
      90,
      "none",
      undefined,
      "value",
    );
    expect(value.alignment).toBe("middle");
    expect(value.position.x).toBe(reference.position.x);
    expect(value.position.y - reference.position.y).toBe(30);
  });

  it("keeps a mirrored MOS value slot beside the mirrored channel side", () => {
    const reference = placedDefaultLabel("nmos", 0, "horizontal");
    const value = placedDefaultLabel(
      "nmos",
      0,
      "horizontal",
      undefined,
      "value",
    );
    expect(value.alignment).toBe("end");
    expect(value.position.x).toBe(reference.position.x);
    expect(value.position.y - reference.position.y).toBe(30);
  });
});

describe("differential input detection", () => {
  it("recognizes the polarity-marked pairs and nothing else", () => {
    for (const symbolId of ["opamp", "comparator"]) {
      const resolved = resolver.resolve(symbolId);
      expect(resolved).toBeDefined();
      expect(hasDifferentialInputs(resolved!)).toBe(true);
    }
    for (const symbolId of ["resistor", "nmos", "voltage-amplifier"]) {
      const resolved = resolver.resolve(symbolId);
      expect(resolved).toBeDefined();
      expect(hasDifferentialInputs(resolved!)).toBe(false);
    }
  });
});
