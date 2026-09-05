import { createEmptyDocument } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
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
  mirror: "none" | "x" = "none",
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
    expect(placedDefaultLabel("variable-resistor")).toMatchObject({
      position: { x: 130, y: 110 },
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
    const reference = placedDefaultLabel("nmos", 0, "x");
    const value = placedDefaultLabel("nmos", 0, "x", undefined, "value");
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
