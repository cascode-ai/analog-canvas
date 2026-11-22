import { describe, expect, it } from "vitest";

import { expandedDeviceSymbols } from "./expanded-device-catalog.js";
import { razaviProductSymbols } from "./razavi-catalog.js";

describe("Extended Devices catalog", () => {
  it.each([
    ["depletion-nmos", "nmos"],
    ["depletion-pmos", "pmos"],
  ] as const)(
    "keeps %s identical to %s except for one wire-width depletion channel",
    (id, baseId) => {
      const symbol = expandedDeviceSymbols.find(
        (candidate) => candidate.id === id,
      );
      const base = razaviProductSymbols.find(
        (candidate) => candidate.id === baseId,
      );
      expect(symbol?.defaultVariantId).toBe("textbook-3terminal");
      expect(symbol?.viewBox).toEqual(base?.viewBox);
      expect(symbol?.pins).toEqual(base?.pins);
      expect(symbol?.primitives.slice(0, -1)).toEqual(base?.primitives);
      expect(symbol?.variants).toEqual(base?.variants);
      expect(symbol?.primitives.at(-1)).toMatchObject({
        kind: "line",
        part: "depletion-channel",
        style: { strokeRole: "normal", lineCap: "butt" },
      });
    },
  );

  it.each(["ndmos", "pdmos"] as const)(
    "defines %s as a four-terminal MOS with a hidden body",
    (id) => {
      const symbol = expandedDeviceSymbols.find(
        (candidate) => candidate.id === id,
      );
      expect(symbol).toMatchObject({
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
