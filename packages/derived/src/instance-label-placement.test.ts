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
  instanceLabelRowOffset,
  instanceValueRowOffset,
  uniformRowDefaultInstanceLabelPlacement,
  previousDefaultInstanceLabelPlacement,
  previousInstanceLabelRowOffset,
  instanceLabelInkBounds,
  instanceLabelMetrics,
  isBjtSymbol,
  isMosSymbol,
  outwardDefaultInstanceLabelPlacement,
  placeUprightInstanceLabel,
  previousPortLabelPlacement,
  shallowPortLabelPlacement,
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
  const metrics = instanceLabelMetrics(profile);
  // Every family a label is drawn for: Analog Blocks, gates, registers, delay
  // cells, converters and the devices.
  const families = [
    ...new Set([
      ...builtInSymbols
        .filter(
          (symbol) =>
            getRazaviCatalogEntry(symbol.id)?.category === "analog-block",
        )
        .map((symbol) => symbol.id),
      "nmos",
      "pmos",
      "npn",
      "resistor",
      "capacitor",
      "inductor",
      "inverter",
      "buffer",
      "or-gate",
      "nand-gate",
      "d-flip-flop",
      "delay-cell",
      "adc",
      "dac",
    ]),
  ];
  it.each(families)(
    "keeps the %s label one gap from the artwork on every side",
    (symbolId) => {
      const bounds = instanceLabelInkBounds(resolver.resolve(symbolId)!);
      for (const rotation of [0, 90, 180, 270] as const) {
        for (const mirror of [
          "none",
          "horizontal",
          "vertical",
          "both",
        ] as const) {
          const corners = [
            { x: bounds.x, y: bounds.y },
            { x: bounds.x + bounds.width, y: bounds.y },
            { x: bounds.x, y: bounds.y + bounds.height },
            { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
          ].map((point) =>
            transformPoint(point, { x: 100, y: 100 }, { rotation, mirror }),
          );
          const left = Math.min(...corners.map((point) => point.x));
          const right = Math.max(...corners.map((point) => point.x));
          const top = Math.min(...corners.map((point) => point.y));
          const bottom = Math.max(...corners.map((point) => point.y));
          const label = placedDefaultLabel(symbolId, rotation, mirror);
          // The label's ink: capitals above its baseline, a subscript below.
          const gap =
            label.alignment === "start"
              ? label.position.x - right
              : label.alignment === "end"
                ? left - label.position.x
                : label.position.y > bottom
                  ? label.position.y - metrics.capHeight - bottom
                  : top - (label.position.y + metrics.subscriptDrop);
          expect(
            Math.abs(gap - metrics.gap),
            `${rotation} ${mirror}`,
          ).toBeLessThanOrEqual(0.5);
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
      const localBounds = instanceLabelInkBounds(resolved);
      const gap =
        label!.position.x -
        (instance.placement.position.x + localBounds.x + localBounds.width);
      expect(Math.abs(gap - metrics.gap)).toBeLessThanOrEqual(0.5);
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
      position: { x: 109, y: 105 },
      alignment: "start",
    });
    expect(placedDefaultLabel("inductor-compact")).toMatchObject({
      position: { x: 112, y: 105 },
      alignment: "start",
    });
    expect(placedDefaultLabel("variable-resistor")).toMatchObject({
      position: { x: 116, y: 105 },
      alignment: "start",
    });
    expect(placedDefaultLabel("voltage-source")).toMatchObject({
      position: { x: 115, y: 105 },
      alignment: "start",
    });
    expect(placedDefaultLabel("battery")).toMatchObject({
      position: { x: expect.any(Number), y: 105 },
      alignment: "start",
    });
    expect(placedDefaultLabel("battery").position.x).toBeGreaterThan(115);
    expect(placedDefaultLabel("battery", 90)).toMatchObject({
      position: { x: 100, y: expect.any(Number) },
      alignment: "middle",
    });
    expect(placedDefaultLabel("capacitor", 90)).toMatchObject({
      position: { x: 100, y: 123 },
      alignment: "middle",
    });
    expect(placedDefaultLabel("port")).toMatchObject({
      position: { x: 80, y: 105 },
      alignment: "end",
    });
  });

  it.each(["port", "port-filled"])(
    "puts a %s name squarely beside it, away from its wire",
    (symbolId) => {
      // The Pin sits at (100, 100) with its wire at the Symbol origin; the
      // capitals are centred on it (baseline 0.35 em low) and not snapped.
      expect(placedDefaultLabel(symbolId, 0)).toEqual({
        position: { x: 80, y: 105 },
        alignment: "end",
      });
      expect(placedDefaultLabel(symbolId, 180)).toEqual({
        position: { x: 120, y: 105 },
        alignment: "start",
      });
      // Vertical Pins take the name directly above or below, centred, half
      // a grid step off the Pin: a whole step read as drifting off its tip.
      expect(placedDefaultLabel(symbolId, 90)).toEqual({
        position: { x: 100, y: 81 },
        alignment: "middle",
      });
      // Below, 0.9 em under the gap leaves room for capitals and an
      // overbar; at 0.7 em they touched the circle (#1529).
      expect(placedDefaultLabel(symbolId, 270)).toEqual({
        position: { x: 100, y: 128 },
        alignment: "middle",
      });
      const resolved = resolver.resolve(symbolId)!;
      expect(
        shallowPortLabelPlacement(
          {
            id: "P1",
            symbolId,
            placement: {
              position: { x: 100, y: 100 },
              rotation: 270,
              mirror: "none",
            },
          },
          resolved,
          profile,
          10,
        ),
      ).toEqual({ position: { x: 100, y: 125 }, alignment: "middle" });
      // The rule before stays recognisable, a whole step away.
      for (const [rotation, y] of [
        [90, 76],
        [270, 130],
      ] as const)
        expect(
          previousPortLabelPlacement(
            {
              id: "P1",
              symbolId,
              placement: {
                position: { x: 100, y: 100 },
                rotation,
                mirror: "none",
              },
            },
            resolved,
            profile,
            10,
          ),
        ).toEqual({ position: { x: 100, y }, alignment: "middle" });
    },
  );

  it("centers quarter-turned passive labels with the same clearance", () => {
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
        const bounds = instanceLabelInkBounds(resolver.resolve(symbolId)!);
        const edge = bounds.x + bounds.width;
        // Below, the capitals keep the gap; above, the subscript does, so
        // R₂ over a part never touches it.
        const gap =
          rotation === 90
            ? label.position.y - metrics.capHeight - (100 + edge)
            : 100 - edge - (label.position.y + metrics.subscriptDrop);
        expect(Math.abs(gap - metrics.gap)).toBeLessThanOrEqual(0.5);
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
      position: { x: 115, y: 105 },
      alignment: "start",
    });
    expect(
      placedDefaultLabel("nmos", 0, "none", "textbook-3terminal"),
    ).toMatchObject({ position: { x: 115, y: 105 }, alignment: "start" });
    expect(
      placedDefaultLabel("nmos", 90, "none", "textbook-3terminal"),
    ).toMatchObject({
      position: { x: 100, y: 125 },
      alignment: "middle",
    });
    expect(
      placedDefaultLabel("nmos", 270, "none", "textbook-3terminal"),
    ).toMatchObject({
      position: { x: 100, y: 80 },
      alignment: "middle",
    });
    expect(placedDefaultLabel("nmos", 0, "horizontal")).toMatchObject({
      position: { x: 85, y: 105 },
      alignment: "end",
    });
  });

  it("places the value slot one quantized text row below the reference", () => {
    const reference = placedDefaultLabel("resistor");
    const value = placedDefaultLabel("resistor", 0, "none", undefined, "value");
    expect(value.alignment).toBe(reference.alignment);
    expect(value.position.x).toBe(reference.position.x);
    expect(value.position.y - reference.position.y).toBe(20);
  });

  it("keeps the value next to its part: rows a little over one line apart (#1105)", () => {
    // 1.2 em of the 15.1-unit label font, rounded up to the grid.
    expect(instanceLabelRowOffset(profile, 10)).toBe(20);
    expect(instanceLabelRowOffset(profile, 5)).toBe(20);
    // A larger font keeps at least 1.2 em between the rows.
    const large = {
      ...profile,
      typography: { ...profile.typography, instanceFontSize: 20 },
    };
    expect(instanceLabelRowOffset(large, 10)).toBe(30);
    // A resistor turned a quarter shows its value under the Reference, not
    // two rows down beside whatever is drawn there.
    const reference = placedDefaultLabel("resistor", 90);
    const value = placedDefaultLabel(
      "resistor",
      90,
      "none",
      undefined,
      "value",
    );
    expect(reference.position).toEqual({ x: 100, y: 120 });
    expect(value.position).toEqual({ x: 100, y: 140 });
  });

  it("recognizes where the previous rule stacked a value", () => {
    expect(previousInstanceLabelRowOffset(profile, 10)).toBe(30);
    const resolved = resolver.resolve("resistor")!;
    const instance = {
      id: "R1",
      symbolId: "resistor",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 90 as const,
        mirror: "none" as const,
      },
    };
    const previous = previousDefaultInstanceLabelPlacement(
      instance,
      resolved,
      profile,
      10,
      "value",
    )!;
    expect(previous.position).toEqual({ x: 100, y: 150 });
    // The Reference's slot did not move.
    expect(
      previousDefaultInstanceLabelPlacement(instance, resolved, profile, 10),
    ).toEqual(defaultInstanceLabelPlacement(instance, resolved, profile, 10));
  });

  it("reads the name before its value above a part, the value nearest the part (#1384)", () => {
    // A resistor turned so its labels stand above it.
    const resolved = resolver.resolve("resistor")!;
    const instance = {
      id: "resistor-1",
      symbolId: "resistor",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 270 as const,
        mirror: "none" as const,
      },
    };
    const alone = placedDefaultLabel("resistor", 270);
    const value = placedDefaultLabel(
      "resistor",
      270,
      "none",
      undefined,
      "value",
    );
    const name = placedDefaultLabel(
      "resistor",
      270,
      "none",
      undefined,
      "reference-over-value",
    );
    // The name a row over its value, which takes the row nearest the part,
    // where a name or a value shown alone stands.
    expect(name.alignment).toBe("middle");
    expect(value.alignment).toBe("middle");
    expect(name.position.x).toBe(value.position.x);
    expect(value.position.y - name.position.y).toBe(20);
    expect(value.position).toEqual(alone.position);
    expect(value.position.y).toBeLessThan(100);
    // The outward rule's value, over its name, stands where the name does
    // now, and still reads as an untouched default.
    expect(
      outwardDefaultInstanceLabelPlacement(
        instance,
        resolved,
        profile,
        10,
        "value",
      )!.position,
    ).toEqual(name.position);
  });

  it("puts a name over its value on every side, and moves only a name above the part (#1384)", () => {
    // The arrangement places a group on each side of a part, however it is
    // turned, through the upright placer.
    const resolved = resolver.resolve("capacitor")!;
    const row = instanceValueRowOffset("capacitor", profile, 10);
    const facing = {
      right: { x: 1, y: 0 },
      left: { x: -1, y: 0 },
      top: { x: 0, y: -1 },
      bottom: { x: 0, y: 1 },
    } as const;
    for (const [rotation, mirror] of [
      [0, "none"],
      [90, "vertical"],
      [270, "none"],
    ] as const) {
      const instance = {
        id: "C1",
        symbolId: "capacitor",
        placement: { position: { x: 100, y: 100 }, rotation, mirror },
      };
      for (const side of ["right", "left", "top", "bottom"] as const) {
        const place = (slot: InstanceLabelSlot) =>
          placeUprightInstanceLabel(
            instance,
            resolved,
            profile,
            { x: 0, y: 0 },
            side,
            10,
            1,
            slot,
          )!;
        const alone = place("reference");
        const name = place("reference-over-value");
        const value = place("value");
        const where = `${rotation} ${mirror} ${side}`;
        expect(value.position.x, where).toBe(name.position.x);
        expect(value.position.y - name.position.y, where).toBe(row);
        // Above the part the value keeps a lone label's place; elsewhere
        // the name does. The side faces up the drawing when the turned and
        // mirrored part sends its outward direction up.
        const outward = transformPoint(
          facing[side],
          { x: 0, y: 0 },
          { rotation, mirror },
        );
        const above = Math.abs(outward.x) < 0.5 && outward.y < 0;
        expect(above ? value.position : name.position, where).toEqual(
          alone.position,
        );
      }
    }
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
    expect(value.position.y - reference.position.y).toBe(
      instanceValueRowOffset("nmos", profile, 10),
    );
  });

  it("drops a stacked W/L value far enough to clear the reference's subscript (#1299)", () => {
    // The numerator of 10u/150n rises 19 units above its baseline and M₂'s
    // subscript hangs 5 below its own, so one 20-unit text row overlapped.
    expect(instanceValueRowOffset("nmos", profile, 10)).toBe(30);
    expect(instanceValueRowOffset("pmos", profile, 5)).toBe(30);
    // Plain values keep one text row.
    expect(instanceValueRowOffset("resistor", profile, 10)).toBe(
      instanceLabelRowOffset(profile, 10),
    );
    // Where the rule until 2026-10-05 put a MOS value still counts as default.
    const resolved = resolver.resolve("nmos")!;
    const instance = placedInstance("nmos");
    expect(
      uniformRowDefaultInstanceLabelPlacement(
        instance,
        resolved,
        profile,
        10,
        "value",
      )!.position.y -
        defaultInstanceLabelPlacement(instance, resolved, profile, 10)!.position
          .y,
    ).toBe(20);
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
