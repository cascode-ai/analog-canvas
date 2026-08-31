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
const deltaSigmaGeometry = JSON.parse(
  readFileSync(
    resolve(
      process.cwd(),
      "fixtures/visual-reference/razavi-reference-v1/delta-sigma-geometry.json",
    ),
    "utf8",
  ),
) as {
  witnesses: Array<{ id: string; witnessPath: string }>;
  symbols: Record<
    string,
    {
      evidenceStatus: "direct-raster" | "family-derived-provisional";
      witnessId?: string;
      derivedFrom?: string;
    }
  >;
};
const normalize = (value: string) =>
  `${value.replaceAll("\r\n", "\n").trimEnd()}\n`;
const pathPoints = (data: string) => {
  const numbers = [...data.matchAll(/-?\d+(?:\.\d+)?/gu)].map((match) =>
    Number(match[0]),
  );
  const points: Array<{ x: number; y: number }> = [];
  for (let index = 0; index < numbers.length; index += 2) {
    const x = numbers[index];
    const y = numbers[index + 1];
    if (x === undefined || y === undefined) {
      throw new Error(`Malformed path coordinate list: ${data}`);
    }
    points.push({ x, y });
  }
  return points;
};
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
        // A house primitive has no visual authority and reports its
        // provenance instead, so the table shows what each entry answers to.
        entry.visualAuthority?.kind ?? entry.provenance,
      ]),
    ).toEqual([
      ["and-gate", "reviewed", "razavi-reference-v1"],
      ["buffer", "reviewed", "razavi-reference-v1"],
      ["capacitor", "reviewed", "razavi-reference-v1"],
      ["closed-switch", "reviewed", "razavi-reference-v1"],
      ["comparator", "reviewed", "razavi-reference-v1"],
      ["comparator-inputs-swapped", "reviewed", "razavi-reference-v1"],
      ["comparator-unmarked", "reviewed", "razavi-reference-v1"],
      ["current-source", "reviewed", "razavi-reference-v1"],
      ["d-flip-flop", "reviewed", "razavi-reference-v1"],
      ["d-flip-flop-q", "reviewed", "razavi-reference-v1"],
      ["delay-cell", "reviewed", "razavi-reference-v1"],
      ["adder", "reviewed", "razavi-reference-v1"],
      ["multiplier", "reviewed", "razavi-reference-v1"],
      ["transconductance", "reviewed", "razavi-reference-v1"],
      ["integrator", "reviewed", "razavi-reference-v1"],
      ["unit-delay", "reviewed", "razavi-reference-v1"],
      ["discrete-time-integrator", "reviewed", "razavi-reference-v1"],
      ["quantizer", "reviewed", "razavi-reference-v1"],
      ["diode", "reviewed", "razavi-reference-v1"],
      ["ground", "reviewed", "razavi-reference-v1"],
      ["ideal-switch", "reviewed", "razavi-reference-v1"],
      ["inductor", "reviewed", "razavi-reference-v1"],
      ["inductor-compact", "reviewed", "razavi-reference-v1"],
      ["inverter", "reviewed", "razavi-reference-v1"],
      ["nand-gate", "reviewed", "razavi-reference-v1"],
      ["nmos", "reviewed", "razavi-reference-v1"],
      ["nor-gate", "reviewed", "razavi-reference-v1"],
      ["npn", "reviewed", "razavi-reference-v1"],
      ["opamp", "reviewed", "razavi-reference-v1"],
      ["opamp-inputs-swapped", "reviewed", "razavi-reference-v1"],
      ["opamp-differential", "reviewed", "razavi-reference-v1"],
      ["opamp-differential-inputs-swapped", "reviewed", "razavi-reference-v1"],
      ["opamp-differential-crossed", "reviewed", "razavi-reference-v1"],
      [
        "opamp-differential-crossed-inputs-swapped",
        "reviewed",
        "razavi-reference-v1",
      ],
      ["or-gate", "reviewed", "razavi-reference-v1"],
      ["pmos", "reviewed", "razavi-reference-v1"],
      ["pnp", "reviewed", "razavi-reference-v1"],
      ["port", "reviewed", "razavi-reference-v1"],
      ["port-filled", "reviewed", "razavi-reference-v1"],
      ["resistor", "reviewed", "razavi-reference-v1"],
      ["variable-capacitor", "reviewed", "razavi-reference-v1"],
      ["variable-inductor", "reviewed", "razavi-reference-v1"],
      ["variable-resistor", "reviewed", "razavi-reference-v1"],
      ["vdd-port", "reviewed", "razavi-reference-v1"],
      ["voltage-amplifier", "reviewed", "razavi-reference-v1"],
      ["pulse-voltage-source", "reviewed", "razavi-reference-v1"],
      ["voltage-controlled-switch", "reviewed", "house"],
      ["voltage-source", "reviewed", "razavi-reference-v1"],
      ["xnor-gate", "reviewed", "razavi-reference-v1"],
      ["xor-gate", "reviewed", "razavi-reference-v1"],
      ["zener-diode", "reviewed", "razavi-reference-v1"],
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

  it("uses semantic roles except where pinned PDF evidence requires an exact stroke", () => {
    const figure1348Symbols = new Set([
      "opamp-differential",
      "opamp-differential-inputs-swapped",
      "opamp-differential-crossed",
      "opamp-differential-crossed-inputs-swapped",
    ]);
    const figure1348StrokeWidths = new Set([0.625137, 1.250273]);
    for (const symbol of razaviCatalogSymbols) {
      const primitives = [
        ...symbol.primitives,
        ...symbol.variants.flatMap(
          (variant) => variant.additionalPrimitives ?? [],
        ),
      ];
      for (const primitive of primitives) {
        if (!primitive.style) continue;
        if (primitive.style.strokeWidth !== undefined) {
          expect(figure1348Symbols.has(symbol.id)).toBe(true);
          expect(figure1348StrokeWidths.has(primitive.style.strokeWidth)).toBe(
            true,
          );
          expect(primitive.style.strokeRole).toBeUndefined();
        } else {
          expect(primitive.style.strokeRole).toMatch(
            /^(normal|emphasis|ground)$/u,
          );
        }
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

  it("keeps the PDF-derived Buffer seams and generic DFF pin contract", () => {
    const buffer = requireRazaviCatalogSymbol("buffer");
    const [inputLead, triangle, outputLead] = buffer.primitives;
    if (
      inputLead?.kind !== "line" ||
      triangle?.kind !== "path" ||
      outputLead?.kind !== "line"
    ) {
      throw new Error("Buffer must retain lead/triangle/lead ordering");
    }
    const trianglePoints = pathPoints(triangle.data);
    const basePoints = trianglePoints.filter(
      (point) => point.x === Math.min(...trianglePoints.map(({ x }) => x)),
    );
    const apex = trianglePoints.find(
      (point) => point.x === Math.max(...trianglePoints.map(({ x }) => x)),
    );
    expect(inputLead.to.x).toBe(basePoints[0]?.x);
    expect(inputLead.to.y).toBe(0);
    expect(apex).toBeDefined();
    expect(outputLead.from.x).toBe(apex?.x);
    expect(outputLead.from.y).toBeCloseTo(apex?.y ?? Number.NaN, 8);
    expect(buffer.pins.map((pin) => pin.name)).toEqual(["A", "Y"]);

    const dff = requireRazaviCatalogSymbol("d-flip-flop");
    expect(dff.pins.map((pin) => pin.name)).toEqual(["D", "CK", "Q", "QBAR"]);
    expect(dff.pins.at(-1)?.presentation).toMatchObject({
      showName: true,
      displayName: "Q",
      textStyle: "math-symbol",
      textSizeScale: 0.68,
    });
    expect(
      dff.primitives.filter((primitive) => primitive.kind === "line"),
    ).toHaveLength(4);
    expect(dff.viewBox).toEqual({ x: -42, y: -27, width: 84, height: 54 });
    expect(dff.pins.map((pin) => pin.at)).toEqual([
      { x: -40, y: -10 },
      { x: -40, y: 10 },
      { x: 40, y: -10 },
      { x: 40, y: 10 },
    ]);
    expect(dff.pins.map((pin) => pin.presentation.leadLength)).toEqual([
      15, 15, 15, 15,
    ]);
    expect(dff.primitives[2]).toMatchObject({
      kind: "path",
      data: "M -25.000855 -25.0 L 25.000855 -25.0 L 25.000855 25.0 L -25.000855 25.0 Z",
    });
    expect(
      dff.primitives.some((primitive) => primitive.part === "pin-name-overbar"),
    ).toBe(false);
  });

  it("puts the Q-only flip-flop's output on the body centre line", () => {
    const dff = requireRazaviCatalogSymbol("d-flip-flop");
    const q = requireRazaviCatalogSymbol("d-flip-flop-q");

    expect(q.pins.map((pin) => pin.name)).toEqual(["D", "CK", "Q"]);
    // With no complement to pair with, an output left at the pair's height
    // reads as lopsided and hangs its name beside an empty corner. The body
    // spans -25..25, so the centre line is y = 0.
    expect(q.pins.map((pin) => pin.at)).toEqual([
      { x: -40, y: -10 },
      { x: -40, y: 10 },
      { x: 40, y: 0 },
    ]);
    const outputLead = q.primitives.find(
      (primitive) => primitive.kind === "line" && primitive.to.x === 40,
    );
    expect(outputLead).toMatchObject({
      from: { y: 0 },
      to: { x: 40, y: 0 },
    });

    // Deriving the sibling must not reshape the reviewed part it came from.
    expect(dff.pins.map((pin) => pin.at)).toEqual([
      { x: -40, y: -10 },
      { x: -40, y: 10 },
      { x: 40, y: -10 },
      { x: 40, y: 10 },
    ]);
    // Same body, one fewer wire: the two must read as the same block.
    expect(q.viewBox).toEqual(dff.viewBox);
    expect(q.primitives.find((primitive) => primitive.kind === "path")).toEqual(
      dff.primitives.find((primitive) => primitive.kind === "path"),
    );
  });

  it("keeps the page-331 Delay Cell proportions and source glyph outlines", () => {
    const delayCell = requireRazaviCatalogSymbol("delay-cell");
    expect(delayCell.pins.map((pin) => pin.name)).toEqual(["A", "Y"]);
    expect(delayCell.pins.map((pin) => pin.at)).toEqual([
      { x: -40, y: 0 },
      { x: 40, y: 0 },
    ]);
    const [inputLead, body, outputLead, ...glyphPolygons] =
      delayCell.primitives;
    expect(inputLead).toMatchObject({
      kind: "line",
      from: { x: -40, y: 0 },
      to: { x: -24, y: 0 },
      style: { strokeRole: "normal" },
    });
    expect(body).toMatchObject({
      kind: "path",
      data: "M -24 -12 L 24 -12 L 24 12 L -24 12 Z",
      style: { strokeRole: "emphasis" },
    });
    expect(outputLead).toMatchObject({
      kind: "line",
      from: { x: 24, y: 0 },
      to: { x: 40, y: 0 },
      style: { strokeRole: "normal" },
    });
    expect(glyphPolygons).toHaveLength(4);
    expect(
      glyphPolygons.every(
        (primitive) =>
          primitive.kind === "polygon" &&
          primitive.fill === "foreground" &&
          primitive.stroke === "none",
      ),
    ).toBe(true);
  });

  it("keeps the enlarged FD Amp angle, pair spacing, and joined leads", () => {
    const opampTriangle = requireRazaviCatalogSymbol("opamp").primitives.find(
      (primitive) => primitive.kind === "path",
    );
    if (opampTriangle?.kind !== "path") {
      throw new Error("Op Amp must retain its triangle path");
    }
    const pathPoints = (data: string) => {
      const values = [...data.matchAll(/-?\d+(?:\.\d+)?/gu)].map((match) =>
        Number(match[0]),
      );
      return {
        leftTop: { x: values[0]!, y: values[1]! },
        leftBottom: { x: values[2]!, y: values[3]! },
        apex: { x: values[4]!, y: values[5]! },
      };
    };
    const opampPoints = pathPoints(opampTriangle.data);
    const opampWidth = opampPoints.apex.x - opampPoints.leftTop.x;
    const originalFdAspect = (14.9998 - -20) / (14.9993 - -15.0002);
    const distanceToEdge = (
      point: { x: number; y: number },
      from: { x: number; y: number },
      to: { x: number; y: number },
    ) =>
      Math.abs(
        (to.y - from.y) * point.x -
          (to.x - from.x) * point.y +
          to.x * from.y -
          to.y * from.x,
      ) / Math.hypot(to.y - from.y, to.x - from.x);
    for (const symbolId of [
      "opamp-differential",
      "opamp-differential-crossed",
    ]) {
      const symbol = requireRazaviCatalogSymbol(symbolId);
      expect(symbol.pins).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "IN+",
            at: { x: -50, y: 20 },
          }),
          expect.objectContaining({
            name: "IN-",
            at: { x: -50, y: -20 },
          }),
          expect.objectContaining({
            at: { x: 10, y: -20 },
          }),
          expect.objectContaining({
            at: { x: 10, y: 20 },
          }),
        ]),
      );
      for (const primitive of symbol.primitives.slice(0, 4)) {
        expect(primitive).toMatchObject({
          kind: "line",
          style: { strokeRole: "normal" },
        });
      }
      const triangle = symbol.primitives[4];
      if (triangle?.kind !== "path") {
        throw new Error("FD Amp must retain its triangle path");
      }
      const points = pathPoints(triangle.data);
      const width = points.apex.x - points.leftTop.x;
      const height = points.leftBottom.y - points.leftTop.y;
      expect(width).toBeCloseTo(opampWidth * 1.4, 6);
      expect((points.leftTop.x + points.apex.x) / 2).toBeCloseTo(
        (opampPoints.leftTop.x + opampPoints.apex.x) / 2,
        6,
      );
      expect(width / height).toBeCloseTo(originalFdAspect, 5);
      expect(triangle.style).toEqual(opampTriangle.style);
      const edgeXAtY = (y: number) =>
        y <= points.apex.y
          ? points.leftTop.x +
            ((y - points.leftTop.y) / (points.apex.y - points.leftTop.y)) *
              width
          : points.leftBottom.x +
            ((points.leftBottom.y - y) /
              (points.leftBottom.y - points.apex.y)) *
              width;
      for (const primitive of symbol.primitives.filter(
        (candidate) => candidate.part === "output-polarity",
      )) {
        if (primitive.kind !== "line") continue;
        expect(primitive.from.x).toBeLessThan(edgeXAtY(primitive.from.y));
        expect(primitive.to.x).toBeLessThan(edgeXAtY(primitive.to.y));
      }
      const lowerInputMark = symbol.primitives.find(
        (primitive) =>
          primitive.kind === "line" &&
          primitive.part === "input-polarity" &&
          primitive.from.y === primitive.to.y &&
          primitive.from.y > 0,
      );
      const lowerOutputMark = symbol.primitives.find(
        (primitive) =>
          primitive.kind === "line" &&
          primitive.part === "output-polarity" &&
          primitive.from.y === primitive.to.y &&
          primitive.from.y > 0,
      );
      if (lowerInputMark?.kind !== "line" || lowerOutputMark?.kind !== "line") {
        throw new Error("FD Amp lower polarity marks must remain line pairs");
      }
      expect(lowerInputMark.from.y).toBeGreaterThan(15);
      expect(lowerInputMark.from.y).toBeLessThan(16);
      expect(lowerOutputMark.from.y).toBeGreaterThan(15);
      expect(lowerOutputMark.from.y).toBeLessThan(16);
      const lowerInputCenterX =
        (lowerInputMark.from.x + lowerInputMark.to.x) / 2;
      const lowerOutputCenterX =
        (lowerOutputMark.from.x + lowerOutputMark.to.x) / 2;
      expect(lowerOutputCenterX - lowerInputCenterX).toBeGreaterThan(10);
      const [topInput, bottomInput, topOutput, bottomOutput] =
        symbol.primitives.slice(0, 4);
      if (
        topInput?.kind !== "line" ||
        bottomInput?.kind !== "line" ||
        topOutput?.kind !== "line" ||
        bottomOutput?.kind !== "line"
      ) {
        throw new Error("FD Amp leads must remain line primitives");
      }
      const triangleHalfStroke = 1.2;
      expect(topInput.to.x - topInput.from.x).toBeCloseTo(12.0521, 6);
      expect(bottomInput.to.x - bottomInput.from.x).toBeCloseTo(12.0521, 6);
      expect(topInput.to.x).toBeLessThan(points.leftTop.x);
      expect(bottomInput.to.x).toBeLessThan(points.leftBottom.x);
      expect(
        topInput.to.x - (points.leftTop.x - triangleHalfStroke),
      ).toBeCloseTo(0.05, 6);
      expect(
        bottomInput.to.x - (points.leftBottom.x - triangleHalfStroke),
      ).toBeCloseTo(0.05, 6);
      const topCenterX =
        points.leftTop.x +
        ((topOutput.from.y - points.leftTop.y) /
          (points.apex.y - points.leftTop.y)) *
          (points.apex.x - points.leftTop.x);
      const bottomCenterX =
        points.leftBottom.x +
        ((points.leftBottom.y - bottomOutput.from.y) /
          (points.leftBottom.y - points.apex.y)) *
          (points.apex.x - points.leftBottom.x);
      expect(topOutput.from.x).toBeCloseTo(topCenterX, 5);
      expect(bottomOutput.from.x).toBeCloseTo(bottomCenterX, 5);
      expect(
        distanceToEdge(topOutput.from, points.leftTop, points.apex),
      ).toBeCloseTo(0, 5);
      expect(
        distanceToEdge(bottomOutput.from, points.leftBottom, points.apex),
      ).toBeCloseTo(0, 5);
    }
  });

  it("uses reviewed catalog objects as the sole built-in product library", () => {
    expect(razaviCatalogSymbols).toHaveLength(51);
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
      "and-gate",
      "buffer",
      "capacitor",
      "closed-switch",
      "comparator",
      "comparator-unmarked",
      "current-source",
      "d-flip-flop",
      "d-flip-flop-q",
      "delay-cell",
      "adder",
      "multiplier",
      "transconductance",
      "integrator",
      "unit-delay",
      "discrete-time-integrator",
      "quantizer",
      "diode",
      "ground",
      "ideal-switch",
      "inductor",
      "inductor-compact",
      "inverter",
      "nand-gate",
      "nmos",
      "nor-gate",
      "npn",
      "opamp",
      "opamp-differential",
      "opamp-differential-crossed",
      "or-gate",
      "pmos",
      "pnp",
      "port",
      "port-filled",
      "resistor",
      "variable-capacitor",
      "variable-inductor",
      "variable-resistor",
      "vdd-port",
      "voltage-amplifier",
      "pulse-voltage-source",
      "voltage-controlled-switch",
      "voltage-source",
      "xnor-gate",
      "xor-gate",
      "zener-diode",
    ]);
    for (const entry of razaviSymbolCatalogEntries) {
      expect(isRazaviProductCatalogEntry(entry)).toBe(
        razaviProductSymbols.some((symbol) => symbol.id === entry.symbolId),
      );
    }
  });

  it("keeps Delta-Sigma evidence honest and formula blocks renderer-owned", () => {
    const calibrationPath =
      "fixtures/visual-reference/razavi-reference-v1/delta-sigma-geometry.json";
    const directWitnesses = [
      ["adder", "delta-sigma-figure-21-38-reference.png"],
      ["transconductance", "transconductance-reference.png"],
      ["integrator", "delta-sigma-figure-21-38-reference.png"],
      ["discrete-time-integrator", "delta-sigma-figure-21-33-reference.png"],
    ] as const;
    for (const [symbolId, witnessPath] of directWitnesses) {
      const measurement = deltaSigmaGeometry.symbols[symbolId];
      expect(measurement).toMatchObject({ evidenceStatus: "direct-raster" });
      expect(
        deltaSigmaGeometry.witnesses.find(
          (witness) => witness.id === measurement?.witnessId,
        )?.witnessPath,
      ).toBe(witnessPath);
    }
    for (const symbolId of ["multiplier", "unit-delay", "quantizer"]) {
      expect(deltaSigmaGeometry.symbols[symbolId]).toMatchObject({
        evidenceStatus: "family-derived-provisional",
        derivedFrom: expect.any(String),
      });
    }
    for (const symbolId of [
      "adder",
      "multiplier",
      "transconductance",
      "integrator",
      "unit-delay",
      "discrete-time-integrator",
      "quantizer",
    ]) {
      const entry = getRazaviCatalogEntry(symbolId);
      expect(entry?.visualAuthority).toMatchObject({
        referencePaths: [calibrationPath],
        calibrationPath,
      });
      expect(entry?.generation).toBeUndefined();
      expect(entry?.manualOnlyReason).toContain("structural netlists");
      expect(entry?.manualOnlyReason).not.toMatch(
        /family-derived|provisional|evidence|screenshot/iu,
      );
    }

    const sharedTransferFunctionPresentation = {
      supportsCoefficient: true,
      center: { x: 0, y: 0 },
      fontSize: 12,
      adaptiveFrame: {
        minBodyWidth: 40,
        minBodyHeight: 30,
        horizontalPadding: 8,
        verticalPadding: 4,
        leadLength: 20,
      },
    } as const;
    const expectedFormulas = {
      integrator: "1/s",
      "unit-delay": "z^-1",
      "discrete-time-integrator": "z^-1/(1-z^-1)",
    } as const;
    for (const [symbolId, defaultFormula] of Object.entries(expectedFormulas)) {
      const symbol = requireRazaviCatalogSymbol(symbolId);
      expect(symbol.formulaPresentation).toEqual({
        defaultFormula,
        ...sharedTransferFunctionPresentation,
      });
      expect(symbol.primitives.map((primitive) => primitive.part)).toEqual([
        "input-a-lead",
        "body",
        "output-y-lead",
      ]);
      expect(
        symbol.primitives.some((primitive) =>
          primitive.part?.startsWith("formula-"),
        ),
      ).toBe(false);
    }

    const transconductance = requireRazaviCatalogSymbol("transconductance");
    expect(transconductance.pins.map((pin) => pin.name)).toEqual(["A", "Y"]);
    expect(transconductance.formulaPresentation).toEqual({
      defaultFormula: "+g_m",
      supportsCoefficient: true,
      center: { x: 0, y: 0 },
      fontSize: 12,
      adaptiveFrame: {
        shape: "right-tapered-trapezoid",
        minBodyWidth: 40,
        minBodyHeight: 70,
        horizontalPadding: 4,
        verticalPadding: 4,
        leadLength: 20,
      },
    });
    expect(transconductance.primitives).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "path",
          part: "body",
          data: "M -20 -35 L 20 -17.5 L 20 17.5 L -20 35 Z",
        }),
      ]),
    );
  });

  it("keeps the variable resistor electrically two-terminal with one diagonal adjustment arrow", () => {
    const symbol = requireRazaviCatalogSymbol("variable-resistor");

    expect(symbol.pins.map((pin) => pin.name)).toEqual(["P1", "P2"]);
    expect(symbol.primitives).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "line",
          part: "adjustment-arrow-shaft",
          from: expect.objectContaining({ x: -12, y: 12 }),
          to: expect.objectContaining({ x: 9, y: -9 }),
        }),
        expect.objectContaining({
          kind: "polygon",
          part: "adjustment-arrow-head",
          fill: "foreground",
        }),
      ]),
    );
  });

  it("does not publish removed standalone three-terminal MOS or VDD assets", () => {
    for (const symbolId of ["nmos3", "pmos3", "vdd"]) {
      expect(getRazaviCatalogEntry(symbolId)).toBeUndefined();
      expect(getRazaviCatalogSymbol(symbolId)).toBeUndefined();
    }
  });

  it("restores the VDD power port with a seam-closed bar and stem", () => {
    const vddPort = requireRazaviCatalogSymbol("vdd-port");
    expect(vddPort.name).toBe("VDD Power Port");
    expect(vddPort.pins).toHaveLength(1);
    expect(vddPort.pins[0]).toMatchObject({
      name: "P",
      role: "power",
      at: { x: 0, y: 20 },
      direction: "south",
    });
    const stem = vddPort.primitives.find(
      (primitive) => primitive.kind === "line",
    );
    const bar = vddPort.primitives.find(
      (primitive) => primitive.kind === "polygon",
    );
    expect(stem).toMatchObject({
      from: { x: 0, y: 20 },
      to: { x: 0, y: 1.5 },
    });
    expect(bar?.points).toEqual([
      { x: -10, y: -0.88 },
      { x: 10, y: -0.88 },
      { x: 10, y: 2.36 },
      { x: -10, y: 2.36 },
    ]);
    // Butt-capped primitives need a real interior overlap, not a merely
    // coincident endpoint, to avoid an anti-aliased VDD T-junction seam.
    const stemLine = stem as Extract<typeof stem, { kind: "line" }>;
    const barBottom = Math.max(...bar!.points.map((point) => point.y));
    expect(stemLine.to.y).toBeLessThan(barBottom);
    expect(vddPort.labelVisibility).toBe("hidden");
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
      "zener-diode",
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
    const zener = requireRazaviCatalogSymbol("zener-diode");
    expect(zener.pins).toMatchObject([
      { name: "A", at: { x: -20, y: 0 }, direction: "west" },
      { name: "K", at: { x: 20, y: 0 }, direction: "east" },
    ]);
    expect(zener.primitives).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "polygon",
          fill: "none",
          stroke: "foreground",
          style: expect.objectContaining({ strokeRole: "normal" }),
        }),
        expect.objectContaining({
          kind: "polyline",
          points: [
            { x: -0.639331, y: -8.506555 },
            { x: 6.666666, y: -8.406137 },
            { x: 6.666666, y: 8.2053 },
            { x: 13.870013, y: 8.2053 },
          ],
          style: expect.objectContaining({ strokeRole: "emphasis" }),
        }),
      ]),
    );
    expect(getRazaviCatalogEntry("zener-diode")).toMatchObject({
      automaticMappings: [],
      manualOnlyReason: expect.stringContaining(
        "does not distinguish a Zener presentation",
      ),
      generation: {
        kind: "razavi-pdf-vector-reference",
        converterPath: "scripts/generate-razavi-zener-asset.mjs",
      },
    });
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
    expect(idealSwitch.pins.map((pin) => pin.at.x)).toEqual([-20, 20]);
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
          from: { x: -20, y: 0 },
          to: { x: -12.726917, y: 0 },
        }),
        expect.objectContaining({
          kind: "line",
          from: { x: 14.403348, y: 0 },
          to: { x: 20, y: 0 },
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
    expect(closedSwitch.pins.map((pin) => pin.at.x)).toEqual([-20, 20]);
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
          from: { x: -20, y: 0 },
          to: { x: -13.562064, y: 0 },
        }),
        expect.objectContaining({
          kind: "line",
          from: { x: 13.562064, y: 0 },
          to: { x: 20, y: 0 },
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

    const pulse = requireRazaviCatalogSymbol("pulse-voltage-source");
    expect(pulse.pins.map((pin) => pin.name)).toEqual(["+", "-"]);
    expect(pulse.primitives).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "circle", radius: 10.755814 }),
        expect.objectContaining({
          kind: "polyline",
          points: [
            { x: 4, y: 7 },
            { x: 4, y: 4 },
            { x: -4, y: 4 },
            { x: -4, y: -4 },
            { x: 4, y: -4 },
            { x: 4, y: -7 },
          ],
          style: expect.objectContaining({ lineJoin: "miter" }),
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

describe("logic-gate and comparator family", () => {
  const twoInputGates = [
    "and-gate",
    "or-gate",
    "nand-gate",
    "nor-gate",
    "xor-gate",
    "xnor-gate",
  ];
  const invertingShapes = new Set([
    "inverter",
    "nand-gate",
    "nor-gate",
    "xnor-gate",
  ]);
  const family = [
    "inverter",
    ...twoInputGates,
    "comparator",
    "comparator-unmarked",
  ];

  it("keeps gate pin identities and the comparator op-amp pinout", () => {
    expect(
      requireRazaviCatalogSymbol("inverter").pins.map((pin) => pin.name),
    ).toEqual(["A", "Y"]);
    for (const symbolId of twoInputGates) {
      expect(
        requireRazaviCatalogSymbol(symbolId).pins.map((pin) => pin.name),
      ).toEqual(["A", "B", "Y"]);
    }
    expect(
      requireRazaviCatalogSymbol("comparator").pins.map((pin) => pin.name),
    ).toEqual(["IN+", "IN-", "OUT"]);
    expect(
      requireRazaviCatalogSymbol("comparator-unmarked").pins.map(
        (pin) => pin.name,
      ),
    ).toEqual(["IN+", "IN-", "OUT"]);
  });

  it("centres the unmarked comparator glyph without drawing polarity marks", () => {
    const marked = requireRazaviCatalogSymbol("comparator");
    const unmarked = requireRazaviCatalogSymbol("comparator-unmarked");
    const body = unmarked.primitives.find(
      (primitive) =>
        primitive.kind === "path" && primitive.part !== "hysteresis-step",
    );
    const glyph = unmarked.primitives.find(
      (primitive) => primitive.part === "hysteresis-step",
    );
    const markedGlyph = marked.primitives.find(
      (primitive) => primitive.part === "hysteresis-step",
    );
    if (
      !body ||
      body.kind !== "path" ||
      !glyph ||
      glyph.kind !== "path" ||
      !markedGlyph ||
      markedGlyph.kind !== "path"
    ) {
      throw new Error("Comparator body or hysteresis glyph is missing");
    }

    const averageX = (points: readonly { x: number }[]) =>
      points.reduce((sum, point) => sum + point.x, 0) / points.length;
    const bodyCentreX = averageX(pathPoints(body.data));
    const glyphCentreX = averageX(pathPoints(glyph.data));
    const markedGlyphCentreX = averageX(pathPoints(markedGlyph.data));

    expect(
      unmarked.primitives.filter((primitive) => primitive.kind === "line"),
    ).toHaveLength(3);
    expect(glyphCentreX).toBeCloseTo(bodyCentreX, 0);
    expect(glyphCentreX).toBe(-10);
    expect(markedGlyphCentreX).toBe(0);
  });

  it("draws a negation bubble only on inverting shapes", () => {
    for (const symbolId of family) {
      const bubbles = requireRazaviCatalogSymbol(symbolId).primitives.filter(
        (primitive) =>
          primitive.kind === "circle" && primitive.part === "negation-bubble",
      );
      expect(bubbles).toHaveLength(invertingShapes.has(symbolId) ? 1 : 0);
    }
  });

  it("keeps source leads and negation bubbles joined to their gate bodies", () => {
    const inverter = requireRazaviCatalogSymbol("inverter");
    const inverterLead = inverter.primitives[0];
    const inverterBody = inverter.primitives[1];
    if (!inverterLead || inverterLead.kind !== "line") {
      throw new Error("Inverter input lead is missing");
    }
    if (!inverterBody || inverterBody.kind !== "path") {
      throw new Error("Inverter body path is missing");
    }
    const inverterBodyMinX = Math.min(
      ...pathPoints(inverterBody.data).map((point) => point.x),
    );
    expect(inverterLead.to.x).toBeCloseTo(inverterBodyMinX, 5);

    const nand = requireRazaviCatalogSymbol("nand-gate");
    const nandBody = nand.primitives.find(
      (primitive) => primitive.kind === "path",
    );
    const nandBubble = nand.primitives.find(
      (primitive) => primitive.part === "negation-bubble",
    );
    if (!nandBody || nandBody.kind !== "path") return;
    const nandBodyMinX = Math.min(
      ...pathPoints(nandBody.data).map((point) => point.x),
    );
    for (const lead of nand.primitives.slice(0, 2)) {
      expect(lead).toMatchObject({ kind: "line" });
      if (lead.kind !== "line") continue;
      expect(lead.to.x).toBeLessThanOrEqual(nandBodyMinX);
      expect(nandBodyMinX - lead.to.x).toBeLessThan(0.5);
    }
    expect(nandBubble).toMatchObject({
      kind: "circle",
      style: { strokeRole: "emphasis" },
    });
  });

  it("keeps logic gates in the reviewed component-family scale", () => {
    const nand = requireRazaviCatalogSymbol("nand-gate");
    const resistor = requireRazaviCatalogSymbol("resistor");
    const capacitor = requireRazaviCatalogSymbol("capacitor");
    const nmos = requireRazaviCatalogSymbol("nmos");
    const inputPitch = Math.abs(
      (nand.pins.find((pin) => pin.name === "B")?.at.y ?? 0) -
        (nand.pins.find((pin) => pin.name === "A")?.at.y ?? 0),
    );
    const resistorTop = resistor.pins.find((pin) => pin.name === "1");
    const resistorBottom = resistor.pins.find((pin) => pin.name === "2");
    const capacitorTop = capacitor.pins.find((pin) => pin.name === "1");
    const capacitorBottom = capacitor.pins.find((pin) => pin.name === "2");
    if (!resistorTop || !resistorBottom || !capacitorTop || !capacitorBottom) {
      throw new Error("Reviewed passive pin geometry is incomplete");
    }
    const resistorSpan = Math.abs(resistorBottom.at.y - resistorTop.at.y);
    const capacitorSpan = Math.abs(capacitorBottom.at.y - capacitorTop.at.y);
    const mosSpan = Math.abs(
      (nmos.pins.find((pin) => pin.name === "S")?.at.y ?? 0) -
        (nmos.pins.find((pin) => pin.name === "D")?.at.y ?? 0),
    );
    expect(inputPitch).toBe(20);
    expect([resistorSpan, capacitorSpan, mosSpan]).toEqual([40, 40, 40]);
    expect(inputPitch * 2).toBe(resistorSpan);
  });

  it("stays manual-only for netlist mapping like the op-amp", () => {
    for (const symbolId of family) {
      const entry = getRazaviCatalogEntry(symbolId);
      expect(entry?.palette).toBe(true);
      expect(entry?.reviewStatus).toBe("reviewed");
      expect(entry?.automaticMappings).toEqual([]);
      expect(entry?.manualOnlyReason).toBeTruthy();
    }
  });

  it("keeps OR/XNOR as exact compositions of direct textbook evidence", () => {
    const nor = requireRazaviCatalogSymbol("nor-gate");
    const or = requireRazaviCatalogSymbol("or-gate");
    expect(
      or.primitives.filter((primitive) => primitive.kind === "path"),
    ).toEqual(nor.primitives.filter((primitive) => primitive.kind === "path"));
    expect(
      or.primitives.some((primitive) => primitive.part === "negation-bubble"),
    ).toBe(false);

    const xor = requireRazaviCatalogSymbol("xor-gate");
    const xnor = requireRazaviCatalogSymbol("xnor-gate");
    expect(
      xnor.primitives.filter((primitive) => primitive.kind === "path"),
    ).toEqual(xor.primitives.filter((primitive) => primitive.kind === "path"));
    const xnorBubble = xnor.primitives.find(
      (primitive) => primitive.part === "negation-bubble",
    );
    const norBubble = nor.primitives.find(
      (primitive) => primitive.part === "negation-bubble",
    );
    expect(xnorBubble).toMatchObject({
      kind: "circle",
      radius: norBubble?.kind === "circle" ? norBubble.radius : undefined,
    });
  });
});

describe("switch port leads", () => {
  /**
   * Switches take a different normalization from the logic family. The logic
   * helper snaps the connection point outward, so a body contact on a
   * half-grid keeps a 1.5-cell lead — deliberate there, and the library is
   * full of the 15s it yields. A switch body contacts at roughly ±13, and
   * rounding outward left its anchor at ±30 with a stub the grid could not
   * explain. These round to the nearest cell and step one out.
   */
  const throughPath: Array<[string, string]> = [
    ["closed-switch", "1"],
    ["closed-switch", "2"],
    ["ideal-switch", "1"],
    ["ideal-switch", "2"],
    ["voltage-controlled-switch", "P"],
    ["voltage-controlled-switch", "N"],
  ];

  it("anchors every through-path terminal one cell from the body", () => {
    for (const [symbolId, pinName] of throughPath) {
      const symbol = requireRazaviCatalogSymbol(symbolId);
      const pin = symbol.pins.find((candidate) => candidate.name === pinName);
      expect(pin, `${symbolId}.${pinName}`).toBeDefined();
      if (!pin) continue;
      expect(Math.abs(pin.at.x), `${symbolId}.${pinName} anchor`).toBe(20);
      expect(
        pin.presentation.leadLength,
        `${symbolId}.${pinName} declared lead`,
      ).toBe(10);

      const attached = symbol.primitives.filter(
        (primitive) =>
          primitive.kind === "line" &&
          ((primitive.from.x === pin.at.x && primitive.from.y === pin.at.y) ||
            (primitive.to.x === pin.at.x && primitive.to.y === pin.at.y)),
      );
      expect(attached, `${symbolId}.${pinName} lead count`).toHaveLength(1);
      const lead = attached[0];
      if (!lead || lead.kind !== "line") continue;
      // The declared length is the grid promise; the drawn segment runs from
      // the anchor to wherever the calibrated body actually begins, so it is
      // shorter. What must never happen again is the drawn lead exceeding the
      // promise, which is the stub the report was about.
      const drawn = Math.hypot(
        lead.to.x - lead.from.x,
        lead.to.y - lead.from.y,
      );
      const declared = pin.presentation.leadLength;
      expect(declared, `${symbolId}.${pinName} declares a lead`).toBeDefined();
      expect(drawn, `${symbolId}.${pinName} drawn lead`).toBeLessThanOrEqual(
        declared ?? 0,
      );
    }
  });

  it("keeps the control rail a rail, at the switch path's own width", () => {
    // CP/CN are the two ends of ONE horizontal control line, split by the gap
    // at ±4 that the dashed coupling crosses. #470 shortened the switched
    // path to ±20 and left these at ±30, which is what made the symbol read
    // as narrow on top and wide underneath. They now match the path above —
    // the anchor AND the drawn end move together, so the line stays a rail
    // instead of becoming the two stubs that pulling the anchors alone (to
    // ±10, by the through-path formula) would have produced. That stub is
    // the outcome this test exists to prevent; the reach is a means to it.
    const symbol = requireRazaviCatalogSymbol("voltage-controlled-switch");
    const switchedReach = Math.abs(
      symbol.pins.find((candidate) => candidate.name === "P")!.at.x,
    );
    for (const pinName of ["CP", "CN"]) {
      const pin = symbol.pins.find((candidate) => candidate.name === pinName);
      expect(pin, pinName).toBeDefined();
      if (!pin) continue;
      // One envelope: the control port is as wide as the path it controls.
      expect(Math.abs(pin.at.x), `${pinName} anchor`).toBe(switchedReach);

      // The rail is drawn from the anchor inward to the coupling gap, and it
      // must stay long enough to read as a rail rather than a stub.
      const rail = symbol.primitives.find(
        (primitive) =>
          primitive.kind === "line" &&
          primitive.from.y === pin.at.y &&
          primitive.to.y === pin.at.y &&
          (primitive.from.x === pin.at.x || primitive.to.x === pin.at.x),
      );
      expect(rail, `${pinName} rail segment`).toBeDefined();
      if (!rail || rail.kind !== "line") continue;
      const drawn = Math.abs(rail.to.x - rail.from.x);
      expect(drawn, `${pinName} rail length`).toBeGreaterThanOrEqual(12);
      const innerEnd = Math.min(Math.abs(rail.from.x), Math.abs(rail.to.x));
      expect(innerEnd, `${pinName} coupling gap`).toBe(4);
    }
  });
});

describe("logic-library port leads", () => {
  const logicIds = [
    "and-gate",
    "buffer",
    "d-flip-flop",
    "d-flip-flop-q",
    "delay-cell",
    "inverter",
    "nand-gate",
    "nor-gate",
    "or-gate",
    "xnor-gate",
    "xor-gate",
  ];

  it("uses only one-cell or half-grid-adjusted 1.5-cell port leads", () => {
    for (const symbolId of logicIds) {
      const symbol = requireRazaviCatalogSymbol(symbolId);
      for (const pin of symbol.pins) {
        const attached = symbol.primitives.filter(
          (primitive) =>
            primitive.kind === "line" &&
            ((primitive.from.x === pin.at.x && primitive.from.y === pin.at.y) ||
              (primitive.to.x === pin.at.x && primitive.to.y === pin.at.y)),
        );
        expect(attached, `${symbolId}.${pin.name}`).toHaveLength(1);
        const lead = attached[0];
        if (!lead || lead.kind !== "line") continue;
        const bodyContact =
          lead.from.x === pin.at.x && lead.from.y === pin.at.y
            ? lead.to
            : lead.from;
        const outwardSign = pin.direction === "west" ? -1 : 1;
        const nominalBodyX = Math.round(bodyContact.x / 5) * 5;
        const oneCellOut = nominalBodyX + outwardSign * 10;
        const expectedX =
          outwardSign < 0
            ? Math.floor(oneCellOut / 10) * 10
            : Math.ceil(oneCellOut / 10) * 10;
        const nominalLeadLength = Math.abs(expectedX - nominalBodyX);

        expect(pin.at.x, `${symbolId}.${pin.name}`).toBe(expectedX);
        expect(Math.abs(pin.at.x % 10), `${symbolId}.${pin.name}`).toBe(0);
        expect([10, 15], `${symbolId}.${pin.name}`).toContain(
          nominalLeadLength,
        );
        expect(pin.presentation.leadLength, `${symbolId}.${pin.name}`).toBe(
          nominalLeadLength,
        );
      }
    }
  });
});
