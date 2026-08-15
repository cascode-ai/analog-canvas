import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { builtInSymbols } from "./builtins.js";
import {
  getRazaviCatalogEntry,
  getRazaviCatalogSymbol,
  isRazaviProductCatalogEntry,
  requireRazaviCatalogSymbol,
  razaviCatalogSymbols,
  razaviProductSymbols,
  razaviSemanticPrimitives,
  razaviSymbolCatalogEntries,
  razaviSymbolCatalogIdentity,
} from "./razavi-catalog.js";
import { SymbolDefinitionSchema } from "./schema.js";

const assetRoot = resolve(process.cwd(), "packages/symbols/assets/razavi-v1");
const mosGeometry = JSON.parse(
  readFileSync(
    resolve(
      process.cwd(),
      "fixtures/visual-reference/razavi-reference-v1/mos-geometry.json",
    ),
    "utf8",
  ),
) as {
  symbols: Record<
    "nmos" | "pmos",
    {
      pixelsPerLogical: number;
      originPx: { x: number; y: number };
      gateBarsPx: Array<{
        left: number;
        top: number;
        right: number;
        bottom: number;
      }>;
      channelsPx: Record<
        "upper" | "lower",
        {
          from: { x: number; y: number };
          to: { x: number; y: number };
        }
      >;
      leadsPx: Record<
        "D" | "G" | "S",
        {
          from: { x: number; y: number };
          to: { x: number; y: number };
        }
      >;
      sourceArrowPx: {
        support: {
          from: { x: number; y: number };
          to: { x: number; y: number };
        };
        tip: { x: number; y: number };
        baseTop: { x: number; y: number };
        baseBottom: { x: number; y: number };
      };
    }
  >;
};
const closedSwitchEvidence = JSON.parse(
  readFileSync(
    resolve(
      process.cwd(),
      "fixtures/visual-reference/razavi-reference-v1/closed-switch-vector-source.json",
    ),
    "utf8",
  ),
) as {
  selection: { nativeObjectCount: number };
  rasterWitness: {
    kind: string;
    window: { width: number; height: number; minX: number; minY: number };
  };
};
const normalize = (value: string) =>
  `${value.replaceAll("\r\n", "\n").trimEnd()}\n`;
const logicalPoint = (
  measurement: (typeof mosGeometry.symbols)["nmos"],
  point: { x: number; y: number },
) => ({
  x:
    Math.round(
      ((point.x - measurement.originPx.x) / measurement.pixelsPerLogical) *
        1_000_000,
    ) / 1_000_000,
  y:
    Math.round(
      ((point.y - measurement.originPx.y) / measurement.pixelsPerLogical) *
        1_000_000,
    ) / 1_000_000,
});

const canonicalMosBodyPrimitives = (symbolId: "nmos" | "pmos") =>
  requireRazaviCatalogSymbol(symbolId)
    .primitives.filter((primitive) => primitive.part !== "bulk-lead")
    .map(({ part: _part, ...primitive }) => primitive)
    .sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right)),
    );

describe("Razavi symbol catalog", () => {
  it("publishes the versioned catalog identity and visual authority", () => {
    expect(razaviSymbolCatalogIdentity).toMatchObject({
      schemaVersion: 2,
      id: "razavi-symbols",
      version: 1,
    });
    expect(
      razaviSymbolCatalogEntries.map((entry) => [
        entry.symbolId,
        entry.reviewStatus,
        entry.visualAuthority.kind,
      ]),
    ).toEqual([
      ["capacitor", "reviewed", "razavi-reference-v1"],
      ["closed-switch", "reviewed", "razavi-reference-v1"],
      ["current-source", "reviewed", "razavi-reference-v1"],
      ["diode", "reviewed", "razavi-reference-v1"],
      ["ground", "reviewed", "razavi-reference-v1"],
      ["ideal-switch", "reviewed", "razavi-reference-v1"],
      ["inductor", "reviewed", "razavi-reference-v1"],
      ["nmos", "reviewed", "razavi-reference-v1"],
      ["npn", "reviewed", "razavi-reference-v1"],
      ["opamp", "reviewed", "razavi-reference-v1"],
      ["pmos", "reviewed", "razavi-reference-v1"],
      ["pnp", "reviewed", "razavi-reference-v1"],
      ["port", "reviewed", "razavi-reference-v1"],
      ["port-filled", "reviewed", "razavi-reference-v1"],
      ["resistor", "reviewed", "razavi-reference-v1"],
      ["voltage-amplifier", "reviewed", "razavi-reference-v1"],
      ["voltage-source", "reviewed", "razavi-reference-v1"],
    ]);
  });

  it("validates every source asset, pin order, and byte hash", () => {
    for (const entry of razaviSymbolCatalogEntries) {
      const source = readFileSync(resolve(assetRoot, entry.assetPath), "utf8");
      const asset = SymbolDefinitionSchema.parse(JSON.parse(source));
      expect(asset.id).toBe(entry.symbolId);
      expect(asset.pins.map((pin) => pin.name)).toEqual(entry.pinOrder);
      expect(createHash("sha256").update(normalize(source)).digest("hex")).toBe(
        entry.assetHash,
      );
    }
  });

  it("uses semantic roles instead of raw VSS widths in migrated assets", () => {
    for (const symbol of razaviCatalogSymbols) {
      const primitives = [
        ...symbol.primitives,
        ...symbol.variants.flatMap(
          (variant) => variant.additionalPrimitives ?? [],
        ),
      ];
      for (const primitive of primitives) {
        if (!primitive.style) continue;
        expect(primitive.style.strokeWidth).toBeUndefined();
        expect(primitive.style.strokeRole).toMatch(
          /^(normal|emphasis|ground)$/u,
        );
      }
    }

    const invalid = SymbolDefinitionSchema.safeParse({
      ...requireRazaviCatalogSymbol("nmos"),
      primitives: [
        {
          kind: "line",
          from: { x: 0, y: 0 },
          to: { x: 10, y: 0 },
          style: { strokeRole: "normal", strokeWidth: 1.2 },
        },
      ],
    });
    expect(invalid.success).toBe(false);
  });

  it("uses reviewed catalog objects as the sole built-in product library", () => {
    expect(razaviCatalogSymbols).toHaveLength(17);
    for (const catalogSymbol of razaviProductSymbols) {
      expect(
        builtInSymbols.find((symbol) => symbol.id === catalogSymbol.id),
      ).toBe(catalogSymbol);
      expect(requireRazaviCatalogSymbol(catalogSymbol.id)).toBe(catalogSymbol);
      expect(getRazaviCatalogEntry(catalogSymbol.id)).toBeDefined();
    }
  });

  it("lists only reviewed Reference-calibrated assets in the product library", () => {
    expect(razaviProductSymbols.map((symbol) => symbol.id)).toEqual([
      "capacitor",
      "closed-switch",
      "current-source",
      "diode",
      "ground",
      "ideal-switch",
      "inductor",
      "nmos",
      "npn",
      "opamp",
      "pmos",
      "pnp",
      "port",
      "port-filled",
      "resistor",
      "voltage-amplifier",
      "voltage-source",
    ]);
    for (const entry of razaviSymbolCatalogEntries) {
      expect(isRazaviProductCatalogEntry(entry)).toBe(
        razaviProductSymbols.some((symbol) => symbol.id === entry.symbolId),
      );
    }
  });

  it("does not publish removed standalone three-terminal MOS or VDD assets", () => {
    for (const symbolId of ["nmos3", "pmos3", "vdd"]) {
      expect(getRazaviCatalogEntry(symbolId)).toBeUndefined();
      expect(getRazaviCatalogSymbol(symbolId)).toBeUndefined();
    }
  });

  it("contains no removed generic compatibility symbols", () => {
    for (const symbolId of ["poly-resistor", "generic-block-4"]) {
      expect(getRazaviCatalogEntry(symbolId)).toBeUndefined();
      expect(builtInSymbols.some((symbol) => symbol.id === symbolId)).toBe(
        false,
      );
    }
  });

  it("records Reference calibration for the complete active palette", () => {
    for (const symbolId of [
      "resistor",
      "capacitor",
      "inductor",
      "opamp",
      "diode",
      "closed-switch",
      "ideal-switch",
      "npn",
      "pnp",
      "voltage-amplifier",
      "port",
      "port-filled",
      "ground",
      "voltage-source",
      "current-source",
    ]) {
      expect(getRazaviCatalogEntry(symbolId)).toMatchObject({
        visualAuthority: {
          kind: "razavi-reference-v1",
          referenceManifestPath:
            "fixtures/visual-reference/razavi-reference-v1/manifest.json",
        },
      });
    }
  });

  it("keeps the calibrated active geometry and grid-pin orientation", () => {
    const runtimeResistor = builtInSymbols.find(
      (symbol) => symbol.id === "resistor",
    );
    expect(runtimeResistor).toBe(requireRazaviCatalogSymbol("resistor"));
    expect(runtimeResistor?.pins).toMatchObject([
      { name: "1", at: { x: 0, y: -20 }, direction: "north" },
      { name: "2", at: { x: 0, y: 20 }, direction: "south" },
    ]);
    expect(requireRazaviCatalogSymbol("resistor").pins).toMatchObject([
      { name: "1", at: { x: 0, y: -20 }, direction: "north" },
      { name: "2", at: { x: 0, y: 20 }, direction: "south" },
    ]);
    expect(requireRazaviCatalogSymbol("port").primitives).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "circle",
          fill: "none",
          stroke: "foreground",
        }),
      ]),
    );
    const hollowPort = requireRazaviCatalogSymbol("port");
    const filledPort = requireRazaviCatalogSymbol("port-filled");
    expect(filledPort.pins).toEqual(hollowPort.pins);
    expect(filledPort.viewBox).toEqual(hollowPort.viewBox);
    expect(filledPort.primitives[1]).toEqual(hollowPort.primitives[1]);
    expect(filledPort.primitives[0]).toMatchObject({
      kind: "circle",
      center: { x: -7.086614, y: 0 },
      radius: 2.47907,
      fill: "foreground",
      stroke: "foreground",
    });
    expect(requireRazaviCatalogSymbol("current-source").primitives).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "polygon", fill: "foreground" }),
      ]),
    );
    expect(requireRazaviCatalogSymbol("ground").labelVisibility).toBe("hidden");
  });

  it("keeps canonical MOS assets four-terminal and three-terminal mode visual-only", () => {
    for (const symbolId of ["nmos", "pmos"]) {
      const symbol = requireRazaviCatalogSymbol(symbolId);
      expect(symbol.pins.map((pin) => pin.name)).toEqual(["D", "G", "S", "B"]);
      expect(
        symbol.variants.find((variant) => variant.id === "textbook-3terminal"),
      ).toMatchObject({ hiddenPinNames: ["B"] });
      expect(symbol.defaultVariantId).toBe("textbook-3terminal");
    }
  });

  it("assigns PMOS source and drain to the Razavi-facing terminals", () => {
    const pmos = requireRazaviCatalogSymbol("pmos");
    expect(pmos.pins).toMatchObject([
      { name: "D", role: "drain", at: { x: 10, y: 20 } },
      { name: "G", role: "gate", at: { x: -20, y: 0 } },
      { name: "S", role: "source", at: { x: 10, y: -20 } },
      { name: "B", role: "bulk", at: { x: 20, y: 0 } },
    ]);
  });

  it("uses raster-authored Razavi MOS bodies without moving electrical pin anchors", () => {
    const nmos = requireRazaviCatalogSymbol("nmos");
    const measurement = mosGeometry.symbols.nmos;
    const outerGate = measurement.gateBarsPx[0]!;
    const upperChannel = measurement.channelsPx.upper;
    expect(nmos.pins).toMatchObject([
      { name: "D", at: { x: 10, y: -20 } },
      { name: "G", at: { x: -20, y: 0 } },
      { name: "S", at: { x: 10, y: 20 } },
      { name: "B", at: { x: 20, y: 0 } },
    ]);
    expect(nmos.primitives).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "polygon",
          points: [
            logicalPoint(measurement, {
              x: outerGate.left,
              y: outerGate.top,
            }),
            logicalPoint(measurement, {
              x: outerGate.left,
              y: outerGate.bottom,
            }),
            logicalPoint(measurement, {
              x: outerGate.right,
              y: outerGate.bottom,
            }),
            logicalPoint(measurement, {
              x: outerGate.right,
              y: outerGate.top,
            }),
          ],
          fill: "foreground",
          stroke: "none",
          part: "gate-bar",
        }),
        expect.objectContaining({
          kind: "polyline",
          points: [
            logicalPoint(measurement, {
              ...upperChannel.from,
              x: upperChannel.from.x - 1,
            }),
            logicalPoint(measurement, measurement.leadsPx.D.from),
            logicalPoint(measurement, measurement.leadsPx.D.to),
          ],
          style: {
            strokeRole: "normal",
            lineCap: "butt",
            lineJoin: "miter",
          },
        }),
      ]),
    );
  });

  it("uses NMOS canonical geometry for every non-arrow PMOS body primitive", () => {
    expect(canonicalMosBodyPrimitives("pmos")).toEqual(
      canonicalMosBodyPrimitives("nmos"),
    );
  });

  it("keeps the Razavi ground mark compact and lead-aligned", () => {
    const ground = requireRazaviCatalogSymbol("ground");
    expect(ground.pins).toMatchObject([
      { name: "0", at: { x: 0, y: -10 }, direction: "north" },
    ]);
    expect(ground.primitives).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "line",
          from: { x: -6.395349, y: 0 },
          to: { x: 6.395349, y: 0 },
        }),
        expect.objectContaining({
          kind: "line",
          from: { x: -4.069767, y: 5.813953 },
          to: { x: 4.069767, y: 5.813953 },
        }),
        expect.objectContaining({
          kind: "line",
          from: { x: -2.325581, y: 11.046512 },
          to: { x: 2.325581, y: 11.046512 },
        }),
      ]),
    );
  });

  it("uses one screenshot-authored sharp Razavi resistor path through both leads", () => {
    const resistor = requireRazaviCatalogSymbol("resistor");
    expect(resistor.primitives[0]).toMatchObject({
      kind: "path",
      data: "M 0 -20 L 0 -8.72093 L 5.372093 -6.395349 L -4.604651 -4.069767 L 5.372093 -1.162791 L -4.988372 1.744186 L 5.372093 4.651163 L -4.604651 7.55814 L 0 8.72093 L 0 20",
      style: {
        strokeRole: "normal",
        lineCap: "butt",
        lineJoin: "miter",
        miterLimit: 12,
      },
    });
    expect(resistor.primitives).toHaveLength(1);
  });

  it("uses one continuous PDF-derived inductor path through both grid pins", () => {
    const inductor = requireRazaviCatalogSymbol("inductor");
    expect(inductor.pins).toMatchObject([
      { name: "1", at: { x: 0, y: -30 }, direction: "north" },
      { name: "2", at: { x: 0, y: 30 }, direction: "south" },
    ]);
    expect(inductor.primitives).toHaveLength(1);
    expect(inductor.primitives[0]).toMatchObject({
      kind: "path",
      data: expect.stringMatching(/^M 0 -30 L 0 -29\.243 .* L 0 30$/u),
      style: {
        strokeRole: "normal",
        lineCap: "butt",
        lineJoin: "round",
      },
    });
    expect(getRazaviCatalogEntry("inductor")?.generation).toMatchObject({
      kind: "razavi-pdf-vector-reference",
      converterPath: "scripts/generate-razavi-inductor-asset.mjs",
    });
  });

  it("uses the PDF-derived three-terminal op-amp geometry and polarity marks", () => {
    const opamp = requireRazaviCatalogSymbol("opamp");
    expect(opamp.pins).toMatchObject([
      { name: "IN+", at: { x: -50, y: 10 }, direction: "west" },
      { name: "IN-", at: { x: -50, y: -10 }, direction: "west" },
      { name: "OUT", at: { x: 40, y: 0 }, direction: "east" },
    ]);
    expect(opamp.primitives).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "path",
          data: "M -26.7979 -24.9983 L -26.7979 25 L 23.2021 0 Z",
          style: expect.objectContaining({
            strokeRole: "emphasis",
            lineJoin: "miter",
          }),
        }),
        expect.objectContaining({
          kind: "line",
          from: { x: -21.796167, y: 12.5 },
          to: { x: -14.296167, y: 12.5 },
        }),
        expect.objectContaining({
          kind: "line",
          from: { x: -21.796167, y: -12.5 },
          to: { x: -14.296167, y: -12.5 },
        }),
      ]),
    );
    expect(getRazaviCatalogEntry("opamp")).toMatchObject({
      automaticMappings: [],
      manualOnlyReason: expect.stringContaining("Three-terminal textbook"),
      generation: {
        kind: "razavi-pdf-vector-reference",
        converterPath: "scripts/generate-razavi-opamp-asset.mjs",
      },
    });
  });

  it("keeps the directly normalized BJT arrows and outline diode geometry", () => {
    const npn = requireRazaviCatalogSymbol("npn");
    expect(npn.pins).toMatchObject([
      { name: "C", at: { x: 0, y: -30 }, direction: "north" },
      { name: "B", at: { x: -40, y: 0 }, direction: "west" },
      { name: "E", at: { x: 0, y: 30 }, direction: "south" },
    ]);
    const pnp = requireRazaviCatalogSymbol("pnp");
    expect(pnp.pins).toMatchObject([
      { name: "C", at: { x: 0, y: 30 }, direction: "south" },
      { name: "B", at: { x: -40, y: 0 }, direction: "west" },
      { name: "E", at: { x: 0, y: -30 }, direction: "north" },
    ]);
    const arrowPoints = (symbol: typeof npn) => {
      const arrow = symbol.primitives.at(-1);
      if (arrow?.kind !== "polygon") throw new Error("missing BJT arrow");
      expect(arrow).toMatchObject({ fill: "foreground", stroke: "none" });
      return arrow.points;
    };
    const npnArrow = arrowPoints(npn);
    const pnpArrow = arrowPoints(pnp);
    const squaredDistancesFromTip = (points: typeof npnArrow) =>
      points
        .slice(0, -1)
        .map((point) => {
          const tip = points.at(-1)!;
          return (
            Math.round(
              ((point.x - tip.x) ** 2 + (point.y - tip.y) ** 2) * 1_000_000,
            ) / 1_000_000
          );
        })
        .sort((left, right) => left - right);
    expect(squaredDistancesFromTip(pnpArrow)).toEqual(
      squaredDistancesFromTip(npnArrow),
    );
    expect(npnArrow.at(-1)).toEqual({ x: 0, y: 13.377859 });
    expect(pnpArrow.at(-1)).toEqual({ x: -16.868887, y: -6.401526 });
    expect(
      pnp.primitives.some(
        (primitive) =>
          (primitive.kind === "line" &&
            primitive.from.x === -16.868887 &&
            primitive.from.y === -6.401526) ||
          (primitive.kind === "polyline" &&
            primitive.points[0]?.x === -16.868887 &&
            primitive.points[0]?.y === -6.401526),
      ),
    ).toBe(false);

    const nmos = requireRazaviCatalogSymbol("nmos");
    const baseBar = pnp.primitives.find(
      (primitive) =>
        primitive.kind === "line" && primitive.style?.strokeRole === "emphasis",
    );
    const lowerBranch = pnp.primitives.find(
      (primitive) =>
        primitive.kind === "polyline" &&
        primitive.points[0]?.x === -16.868887 &&
        primitive.points[0]?.y > 0,
    );
    const mosGateBars = nmos.primitives.flatMap((primitive) =>
      primitive.kind === "polygon" && primitive.part === "gate-bar"
        ? [primitive]
        : [],
    );
    if (
      baseBar?.kind !== "line" ||
      lowerBranch?.kind !== "polyline" ||
      mosGateBars.length !== 2
    ) {
      throw new Error("missing calibrated BJT/MOS geometry");
    }
    const mosLongGateBar = Math.max(
      ...mosGateBars.map((bar) =>
        Math.abs(bar.points[1]!.y - bar.points[0]!.y),
      ),
    );
    const baseBarLength = Math.abs(baseBar.to.y - baseBar.from.y);
    const branchHorizontal = Math.abs(
      lowerBranch.points[1]!.x - lowerBranch.points[0]!.x,
    );
    const branchVertical = Math.abs(
      lowerBranch.points[1]!.y - lowerBranch.points[0]!.y,
    );
    expect(baseBarLength / mosLongGateBar).toBeCloseTo(1.067006, 5);
    expect(branchHorizontal / baseBarLength).toBeCloseTo(0.632382, 5);
    expect(branchVertical / baseBarLength).toBeCloseTo(0.261529, 5);

    const diode = requireRazaviCatalogSymbol("diode");
    expect(diode.primitives).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "polygon",
          fill: "none",
          stroke: "foreground",
          style: expect.objectContaining({ strokeRole: "normal" }),
        }),
        expect.objectContaining({
          kind: "line",
          from: { x: 6.666666, y: -7.333334 },
          to: { x: 6.666666, y: 7.333334 },
          style: expect.objectContaining({ strokeRole: "emphasis" }),
        }),
      ]),
    );
    expect(diode.pins.map((pin) => pin.at.x)).toEqual([-20, 20]);
    const voltageAmplifier = requireRazaviCatalogSymbol("voltage-amplifier");
    expect(voltageAmplifier.primitives).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "path",
          data: "M -23.63 -28.62 L -23.63 28.62 L 23.63 0 Z",
          style: expect.objectContaining({ strokeRole: "emphasis" }),
        }),
      ]),
    );
    expect(voltageAmplifier.pins.map((pin) => pin.at.x)).toEqual([-40, 40]);
    const idealSwitch = requireRazaviCatalogSymbol("ideal-switch");
    expect(idealSwitch.name).toBe("Open Switch");
    expect(idealSwitch.pins.map((pin) => pin.at.x)).toEqual([-30, 30]);
    expect(idealSwitch.primitives).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "circle",
          radius: 3.202789,
          style: expect.objectContaining({ strokeRole: "normal" }),
        }),
        expect.objectContaining({
          kind: "line",
          from: { x: -6.953731, y: -2.417959 },
          to: { x: 6.405579, y: -12.806695 },
          style: expect.objectContaining({ strokeRole: "normal" }),
        }),
        expect.objectContaining({
          kind: "line",
          from: { x: -30, y: 0 },
          to: { x: -12.726917, y: 0 },
        }),
        expect.objectContaining({
          kind: "line",
          from: { x: 14.403348, y: 0 },
          to: { x: 30, y: 0 },
        }),
      ]),
    );
    const idealPivot = idealSwitch.primitives.find(
      (primitive) =>
        primitive.kind === "circle" &&
        primitive.center.x === -9.524128 &&
        primitive.center.y === -0.020084,
    );
    const idealBlade = idealSwitch.primitives.find(
      (primitive) =>
        primitive.kind === "line" &&
        primitive.to.x === 6.405579 &&
        primitive.to.y === -12.806695,
    );
    if (
      !idealPivot ||
      idealPivot.kind !== "circle" ||
      !idealBlade ||
      idealBlade.kind !== "line"
    ) {
      throw new Error("missing ideal-switch pivot or blade");
    }
    expect(
      Math.hypot(
        idealBlade.from.x - idealPivot.center.x,
        idealBlade.from.y - idealPivot.center.y,
      ),
    ).toBeGreaterThanOrEqual(idealPivot.radius + 0.312427 - 0.000001);
    expect(
      Math.hypot(
        idealBlade.from.x - idealPivot.center.x,
        idealBlade.from.y - idealPivot.center.y,
      ),
    ).toBeLessThanOrEqual(idealPivot.radius + 0.312427 + 0.000001);
    const closedSwitch = requireRazaviCatalogSymbol("closed-switch");
    expect(closedSwitchEvidence).toMatchObject({
      selection: { nativeObjectCount: 5 },
      rasterWitness: {
        kind: "source-pdf-crop",
        window: { width: 96, height: 48, minX: -20, minY: -8 },
      },
    });
    expect(closedSwitch.pins.map((pin) => pin.at.x)).toEqual([-30, 30]);
    expect(closedSwitch.primitives).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "circle",
          center: { x: -10.36318, y: 0 },
          radius: 3.198884,
          fill: "none",
        }),
        expect.objectContaining({
          kind: "circle",
          center: { x: 10.36318, y: 0 },
          radius: 3.198884,
          fill: "none",
        }),
        expect.objectContaining({
          kind: "line",
          from: { x: -7.186611, y: -1.496234 },
          to: { x: 13.608926, y: -4.694003 },
          style: expect.objectContaining({ strokeRole: "normal" }),
        }),
        expect.objectContaining({
          kind: "line",
          from: { x: -30, y: 0 },
          to: { x: -13.562064, y: 0 },
        }),
        expect.objectContaining({
          kind: "line",
          from: { x: 13.562064, y: 0 },
          to: { x: 30, y: 0 },
        }),
      ]),
    );
    expect(getRazaviCatalogEntry("transformer")).toBeUndefined();
    expect(getRazaviCatalogEntry("vccs")).toBeUndefined();
  });

  it("uses calibrated MOS and source arrowheads with external voltage polarity marks", () => {
    const voltage = requireRazaviCatalogSymbol("voltage-source");
    expect(voltage.viewBox).toEqual({ x: -24, y: -24, width: 39, height: 48 });
    expect(voltage.primitives).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "circle",
          radius: 10.755814,
          style: expect.objectContaining({ strokeRole: "normal" }),
        }),
        expect.objectContaining({
          kind: "line",
          from: { x: -20.058139, y: -14.534884 },
          to: { x: -11.918605, y: -14.534884 },
        }),
        expect.objectContaining({
          kind: "line",
          from: { x: -15.988372, y: -18.604651 },
          to: { x: -15.988372, y: -10.465117 },
        }),
        expect.objectContaining({
          kind: "line",
          from: { x: -20.058139, y: 13.372093 },
          to: { x: -11.918605, y: 13.372093 },
        }),
      ]),
    );

    for (const symbolId of ["nmos", "pmos"] as const) {
      const mos = requireRazaviCatalogSymbol(symbolId);
      const measurement = mosGeometry.symbols[symbolId];
      const arrow = measurement.sourceArrowPx;
      const variant = mos.variants.find(
        (candidate) => candidate.id === "textbook-3terminal",
      );
      expect(variant?.hiddenPrimitiveParts).toEqual([
        "bulk-lead",
        "source-arrow-host",
      ]);
      expect(variant?.additionalPrimitives).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "polyline",
            points: [
              logicalPoint(measurement, arrow.support.from),
              logicalPoint(
                measurement,
                measurement.leadsPx[symbolId === "nmos" ? "S" : "D"].from,
              ),
              logicalPoint(
                measurement,
                measurement.leadsPx[symbolId === "nmos" ? "S" : "D"].to,
              ),
            ],
            style: expect.objectContaining({ lineCap: "butt" }),
          }),
          expect.objectContaining({
            kind: "polygon",
            points: [
              logicalPoint(measurement, arrow.tip),
              logicalPoint(measurement, arrow.baseTop),
              logicalPoint(measurement, arrow.baseBottom),
            ],
            part: "source-arrow",
            fill: "foreground",
          }),
        ]),
      );
    }

    const current = requireRazaviCatalogSymbol("current-source");
    expect(current.primitives).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "line",
          from: { x: 0, y: -6.976744 },
          to: { x: 0, y: -2.325581 },
        }),
        expect.objectContaining({
          kind: "polygon",
          points: [
            { x: 0, y: 6.976744 },
            { x: -4.651163, y: -2.325581 },
            { x: 4.651163, y: -2.325581 },
          ],
          fill: "foreground",
          stroke: "none",
        }),
      ]),
    );
  });

  it("derives each textbook MOS arrow from its screenshot pixel map", () => {
    for (const symbolId of ["nmos", "pmos"] as const) {
      const variant = requireRazaviCatalogSymbol(symbolId).variants.find(
        (candidate) => candidate.id === "textbook-3terminal",
      );
      const measurement = mosGeometry.symbols[symbolId];
      const arrow = measurement.sourceArrowPx;
      const support = variant?.additionalPrimitives?.find(
        (primitive) =>
          primitive.kind === "polyline" && primitive.part === "source-arrow",
      );
      const head = variant?.additionalPrimitives?.find(
        (primitive) =>
          primitive.kind === "polygon" && primitive.part === "source-arrow",
      );
      expect(support).toMatchObject({ kind: "polyline" });
      expect(head).toMatchObject({ kind: "polygon" });
      if (support?.kind !== "polyline" || head?.kind !== "polygon") {
        throw new Error(`${symbolId} has no textbook source arrow`);
      }
      expect(support).toMatchObject({
        points: [
          logicalPoint(measurement, arrow.support.from),
          logicalPoint(
            measurement,
            measurement.leadsPx[symbolId === "nmos" ? "S" : "D"].from,
          ),
          logicalPoint(
            measurement,
            measurement.leadsPx[symbolId === "nmos" ? "S" : "D"].to,
          ),
        ],
      });
      const elbow = support.points[1]!;
      const pin = support.points[2]!;
      expect(elbow.x).toBe(pin.x);
      expect(elbow.y).not.toBe(pin.y);
      expect(head).toMatchObject({
        points: [
          logicalPoint(measurement, arrow.tip),
          logicalPoint(measurement, arrow.baseTop),
          logicalPoint(measurement, arrow.baseBottom),
        ],
      });
    }
  });

  it("classifies the junction dot as a semantic primitive, not a component", () => {
    expect(razaviSemanticPrimitives).toEqual([
      expect.objectContaining({
        id: "junction-dot",
        disposition: "semantic-primitive",
        runtimeOwner: "presentation.nodes.junction",
      }),
    ]);
    expect(
      razaviCatalogSymbols.some((symbol) => symbol.id === "junction-dot"),
    ).toBe(false);
  });
});
