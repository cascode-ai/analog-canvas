import { describe, expect, it } from "vitest";

import {
  expandedDeviceCatalogEntries,
  expandedDeviceSymbols,
  EXTENDED_DEVICE_CATEGORY,
  HIGH_VOLTAGE_DEVICE_SUBCATEGORY,
  MOS_VARIANT_SUBCATEGORY,
} from "./expanded-device-catalog.js";
import { razaviProductSymbols } from "./razavi-catalog.js";
import { SymbolDefinitionSchema } from "./schema.js";

describe("Extended Devices catalog", () => {
  it("keeps optional MOS families outside the Razavi authority boundary", () => {
    expect(expandedDeviceCatalogEntries).toEqual([
      {
        symbolId: "depletion-nmos",
        category: EXTENDED_DEVICE_CATEGORY,
        subcategory: MOS_VARIANT_SUBCATEGORY,
      },
      {
        symbolId: "depletion-pmos",
        category: EXTENDED_DEVICE_CATEGORY,
        subcategory: MOS_VARIANT_SUBCATEGORY,
      },
      {
        symbolId: "ndmos",
        category: EXTENDED_DEVICE_CATEGORY,
        subcategory: HIGH_VOLTAGE_DEVICE_SUBCATEGORY,
      },
      {
        symbolId: "pdmos",
        category: EXTENDED_DEVICE_CATEGORY,
        subcategory: HIGH_VOLTAGE_DEVICE_SUBCATEGORY,
      },
    ]);
    for (const symbol of expandedDeviceSymbols) {
      expect(SymbolDefinitionSchema.parse(symbol)).toEqual(symbol);
    }
  });

  it.each([
    ["depletion-nmos", "Depletion NMOS", "nmos"],
    ["depletion-pmos", "Depletion PMOS", "pmos"],
  ] as const)(
    "keeps %s identical to %s except for one wire-width depletion channel",
    (id, name, baseId) => {
      const symbol = expandedDeviceSymbols.find(
        (candidate) => candidate.id === id,
      );
      const base = razaviProductSymbols.find(
        (candidate) => candidate.id === baseId,
      );
      expect(symbol).toMatchObject({
        id,
        name,
        defaultVariantId: "textbook-3terminal",
        pins: [{ name: "D" }, { name: "G" }, { name: "S" }, { name: "B" }],
      });
      expect(symbol?.viewBox).toEqual(base?.viewBox);
      expect(symbol?.pins).toEqual(base?.pins);
      expect(symbol?.primitives.slice(0, -1)).toEqual(base?.primitives);
      expect(symbol?.variants).toEqual(base?.variants);
      expect(symbol?.primitives.at(-1)).toMatchObject({
        kind: "line",
        from: { x: -0.368217, y: -7.776744 },
        to: { x: -0.368217, y: 7.776744 },
        part: "depletion-channel",
        style: { strokeRole: "normal", lineCap: "butt" },
      });
    },
  );

  it.each([
    ["ndmos", "N-channel DMOS"],
    ["pdmos", "P-channel DMOS"],
  ] as const)(
    "defines %s as a four-terminal MOS with a hidden body",
    (id, name) => {
      const symbol = expandedDeviceSymbols.find(
        (candidate) => candidate.id === id,
      );
      expect(symbol).toMatchObject({
        id,
        name,
        defaultVariantId: "standard-3terminal",
        pins: [{ name: "D" }, { name: "G" }, { name: "S" }, { name: "B" }],
        variants: [
          {
            id: "standard-3terminal",
            hiddenPinNames: ["B"],
            hiddenPrimitiveParts: ["bulk-lead", "source-arrow-host"],
          },
        ],
      });
    },
  );

  it.each([
    ["ndmos", "nmos"],
    ["pdmos", "pmos"],
  ] as const)(
    "keeps %s identical to %s except for one equal-length drift line",
    (dmosId, baseId) => {
      const dmos = expandedDeviceSymbols.find((symbol) => symbol.id === dmosId);
      const base = razaviProductSymbols.find((symbol) => symbol.id === baseId);
      expect(dmos?.viewBox).toEqual(base?.viewBox);
      expect(dmos?.pins).toEqual(base?.pins);
      expect(dmos?.primitives.slice(0, -1)).toEqual(base?.primitives);

      const extra = dmos?.primitives.at(-1);
      expect(extra).toMatchObject({
        kind: "polyline",
        part: "drift-region",
      });
      const drainBranch = base?.primitives.find(
        (primitive) =>
          primitive.kind === "polyline" &&
          primitive.points.at(-1)?.x ===
            base.pins.find((pin) => pin.name === "D")?.at.x &&
          primitive.points.at(-1)?.y ===
            base.pins.find((pin) => pin.name === "D")?.at.y,
      );
      if (extra?.kind !== "polyline" || drainBranch?.kind !== "polyline") {
        throw new Error("Missing DMOS drift line or base drain branch");
      }
      expect([extra.points[0]?.x, extra.points[1]?.x]).toEqual([
        drainBranch.points[0]?.x,
        drainBranch.points[1]?.x,
      ]);
      expect(
        Math.abs(extra.points[0]?.y ?? Number.POSITIVE_INFINITY),
      ).toBeLessThan(
        Math.abs(drainBranch.points[0]?.y ?? Number.POSITIVE_INFINITY),
      );
      expect(extra.points[2]).toEqual(drainBranch.points[1]);

      const dmosVariant = dmos?.variants.find(
        (variant) => variant.id === "standard-3terminal",
      );
      const baseVariant = base?.variants.find(
        (variant) => variant.id === base.defaultVariantId,
      );
      expect(
        dmosVariant ? { ...dmosVariant, id: baseVariant?.id } : undefined,
      ).toEqual(baseVariant);
    },
  );
});
