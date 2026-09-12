import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { format } from "prettier";

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

const assetRoot = resolve(process.cwd(), "packages/components/definitions");
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
      ["comparator-unmarked-inputs-swapped", "reviewed", "razavi-reference-v1"],
      ["current-source", "reviewed", "razavi-reference-v1"],
      ["d-flip-flop", "reviewed", "razavi-reference-v1"],
      ["d-flip-flop-reset", "reviewed", "razavi-reference-v1"],
      ["d-flip-flop-q", "reviewed", "razavi-reference-v1"],
      ["delay-cell", "reviewed", "razavi-reference-v1"],
      ["adder", "reviewed", "razavi-reference-v1"],
      ["multiplier", "reviewed", "razavi-reference-v1"],
      ["transconductance", "reviewed", "razavi-reference-v1"],
      ["differential-transconductance", "reviewed", "house"],
      ["differential-transconductance-inputs-swapped", "reviewed", "house"],
      ["integrator", "reviewed", "razavi-reference-v1"],
      ["unit-delay", "reviewed", "razavi-reference-v1"],
      ["discrete-time-integrator", "reviewed", "razavi-reference-v1"],
      ["quantizer", "reviewed", "razavi-reference-v1"],
      ["diode", "reviewed", "razavi-reference-v1"],
      ["ground", "reviewed", "razavi-reference-v1"],
      ["ideal-switch", "reviewed", "razavi-reference-v1"],
      ["inductor", "reviewed", "razavi-reference-v1"],
      ["inductor-compact", "reviewed", "razavi-reference-v1"],
      ["tcoil", "reviewed", "razavi-reference-v1"],
      ["xfmr", "reviewed", "razavi-reference-v1"],
      ["inverter", "reviewed", "razavi-reference-v1"],
      ["nand-gate", "reviewed", "razavi-reference-v1"],
      ["nmos", "reviewed", "razavi-reference-v1"],
      ["nor-gate", "reviewed", "razavi-reference-v1"],
      ["npn", "reviewed", "razavi-reference-v1"],
      ["opamp", "reviewed", "razavi-reference-v1"],
      ["opamp-lettered", "reviewed", "razavi-reference-v1"],
      ["opamp-lettered-inputs-swapped", "reviewed", "razavi-reference-v1"],
      ["opamp-inputs-swapped", "reviewed", "razavi-reference-v1"],
      ["opamp-differential", "reviewed", "razavi-reference-v1"],
      ["opamp-differential-lettered", "reviewed", "razavi-reference-v1"],
      [
        "opamp-differential-lettered-inputs-swapped",
        "reviewed",
        "razavi-reference-v1",
      ],
      ["opamp-differential-inputs-swapped", "reviewed", "razavi-reference-v1"],
      ["opamp-differential-crossed", "reviewed", "razavi-reference-v1"],
      [
        "opamp-differential-crossed-lettered",
        "reviewed",
        "razavi-reference-v1",
      ],
      [
        "opamp-differential-crossed-lettered-inputs-swapped",
        "reviewed",
        "razavi-reference-v1",
      ],
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
      ["simple-spdt-switch", "reviewed", "house"],
      ["simple-switch", "reviewed", "house"],
      ["spdt-switch", "reviewed", "house"],
      ["variable-capacitor", "reviewed", "razavi-reference-v1"],
      ["variable-inductor", "reviewed", "razavi-reference-v1"],
      ["variable-resistor", "reviewed", "razavi-reference-v1"],
      ["vdd-port", "reviewed", "razavi-reference-v1"],
      ["voltage-amplifier", "reviewed", "razavi-reference-v1"],
      ["voltage-amplifier-lettered", "reviewed", "razavi-reference-v1"],
      ["pulse-voltage-source", "reviewed", "razavi-reference-v1"],
      ["voltage-controlled-switch", "reviewed", "house"],
      ["voltage-source", "reviewed", "razavi-reference-v1"],
      ["xnor-gate", "reviewed", "razavi-reference-v1"],
      ["xor-gate", "reviewed", "razavi-reference-v1"],
      ["zener-diode", "reviewed", "razavi-reference-v1"],
      ["adc", "reviewed", "house"],
      ["dac", "reviewed", "house"],
    ]);
  });

  it("validates every component Symbol projection, pin order, and byte hash", async () => {
    for (const entry of razaviSymbolCatalogEntries) {
      const component = JSON.parse(
        readFileSync(resolve(assetRoot, entry.assetPath), "utf8"),
      );
      const source = await format(JSON.stringify(component.symbol, null, 2), {
        parser: "json",
      });
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
      "opamp-differential-lettered",
      "opamp-differential-lettered-inputs-swapped",
      "opamp-differential-crossed",
      "opamp-differential-crossed-inputs-swapped",
      "opamp-differential-crossed-lettered",
      "opamp-differential-crossed-lettered-inputs-swapped",
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

  it("adds an active-high reset terminal without changing the reviewed DFF body", () => {
    const dff = requireRazaviCatalogSymbol("d-flip-flop");
    const resettable = requireRazaviCatalogSymbol("d-flip-flop-reset");

    expect(resettable.pins.map((pin) => [pin.name, pin.role])).toEqual([
      ["D", "input"],
      ["CK", "clock"],
      ["RST", "reset"],
      ["Q", "output"],
      ["QBAR", "output-complement"],
    ]);
    expect(resettable.pins.find((pin) => pin.name === "RST")).toMatchObject({
      at: { x: 0, y: 50 },
      direction: "south",
      presentation: {
        leadLength: 15,
        showName: true,
        textStyle: "math-symbol",
        textSizeScale: 0.68,
      },
    });
    expect(
      resettable.primitives.find(
        (primitive) => primitive.part === "reset-lead",
      ),
    ).toMatchObject({
      kind: "line",
      from: { x: 0, y: 35 },
      to: { x: 0, y: 50 },
    });
    expect(resettable.primitives[2]).toMatchObject({
      kind: "path",
      data: "M -25.000855 -25.0 L 25.000855 -25.0 L 25.000855 35.0 L -25.000855 35.0 Z",
    });
    expect(resettable.pins.filter((pin) => pin.name !== "RST")).toEqual(
      dff.pins,
    );
    expect(resettable.viewBox).toEqual({
      x: -42,
      y: -27,
      width: 84,
      height: 79,
    });
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

  it("uses one triangle, pair spacing, and visible leads across Analog Blocks", () => {
    const opamp = requireRazaviCatalogSymbol("opamp");
    const opampTriangle = opamp.primitives.find(
      (primitive) =>
        primitive.kind === "path" && primitive.style?.strokeRole === "emphasis",
    );
    if (opampTriangle?.kind !== "path") {
      throw new Error("Op Amp must retain its triangle path");
    }

    for (const symbolId of [
      "opamp-lettered",
      "opamp-differential",
      "opamp-differential-lettered",
      "voltage-amplifier",
      "voltage-amplifier-lettered",
      "comparator",
      "comparator-unmarked",
    ]) {
      const candidate = requireRazaviCatalogSymbol(symbolId);
      const triangle = candidate.primitives.find(
        (primitive) =>
          primitive.kind === "path" &&
          primitive.style?.strokeRole === "emphasis",
      );
      expect(triangle, `${symbolId} triangle`).toMatchObject({
        kind: "path",
        data: opampTriangle.data,
        style: opampTriangle.style,
      });
      expect(candidate.viewBox, `${symbolId} viewBox`).toEqual(opamp.viewBox);
    }

    for (const symbolId of [
      "opamp-differential",
      "opamp-differential-lettered",
    ]) {
      const symbol = requireRazaviCatalogSymbol(symbolId);
      expect(symbol.pins).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "IN+",
            at: { x: -40, y: 10 },
          }),
          expect.objectContaining({
            name: "IN-",
            at: { x: -40, y: -10 },
          }),
          expect.objectContaining({
            at: { x: 20, y: -10 },
          }),
          expect.objectContaining({
            at: { x: 20, y: 10 },
          }),
        ]),
      );
      const leads = symbol.primitives.slice(0, 4);
      for (const primitive of leads) {
        expect(primitive).toMatchObject({
          kind: "line",
          style: { strokeRole: "normal" },
        });
      }
      const triangle = symbol.primitives[4];
      expect(triangle).toEqual(opampTriangle);
      const [topInput, bottomInput, topOutput, bottomOutput] = leads;
      if (
        topInput?.kind !== "line" ||
        bottomInput?.kind !== "line" ||
        topOutput?.kind !== "line" ||
        bottomOutput?.kind !== "line"
      ) {
        throw new Error("FD Amp leads must remain line primitives");
      }
      expect(topInput.to.x - topInput.from.x).toBeCloseTo(13.2021, 6);
      expect(bottomInput.to.x - bottomInput.from.x).toBeCloseTo(13.2021, 6);
      expect(topOutput.to.x - topOutput.from.x).toBeCloseTo(16.79926, 4);
      expect(bottomOutput.to.x - bottomOutput.from.x).toBeCloseTo(16.7979, 4);
      expect(
        symbol.primitives.filter(
          (primitive) => primitive.part === "input-polarity",
        ),
      ).toHaveLength(2);
      expect(
        symbol.primitives.filter(
          (primitive) => primitive.part === "output-polarity",
        ),
      ).toHaveLength(2);
    }
  });

  it("uses reviewed catalog objects as the sole built-in product library", () => {
    expect(razaviCatalogSymbols).toHaveLength(69);
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
      "current-source",
      "d-flip-flop",
      "d-flip-flop-reset",
      "d-flip-flop-q",
      "delay-cell",
      "adder",
      "multiplier",
      "transconductance",
      "differential-transconductance",
      "integrator",
      "unit-delay",
      "discrete-time-integrator",
      "quantizer",
      "diode",
      "ground",
      "ideal-switch",
      "inductor",
      "inductor-compact",
      "tcoil",
      "xfmr",
      "inverter",
      "nand-gate",
      "nmos",
      "nor-gate",
      "npn",
      "opamp",
      "opamp-differential",
      "or-gate",
      "pmos",
      "pnp",
      "port",
      "port-filled",
      "resistor",
      "simple-switch",
      "spdt-switch",
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
      "adc",
      "dac",
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
        leadLength: 10,
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
      defaultFormula: "g_m",
      supportsCoefficient: true,
      center: { x: 0, y: 0 },
      fontSize: 12,
      adaptiveFrame: {
        shape: "right-tapered-trapezoid",
        minBodyWidth: 40,
        minBodyHeight: 70,
        horizontalPadding: 4,
        verticalPadding: 4,
        leadLength: 10,
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

    const differential = requireRazaviCatalogSymbol(
      "differential-transconductance",
    );
    expect(differential.pins.map((pin) => pin.name)).toEqual([
      "IN+",
      "IN-",
      "OUT",
    ]);
    expect(differential.formulaPresentation).toMatchObject({
      defaultFormula: "g_m",
    });
    expect(
      differential.primitives.filter(
        (primitive) =>
          primitive.part === "input-polarity" ||
          primitive.part === "upright-input-polarity-negative",
      ),
    ).toHaveLength(3);
    expect(differential.pins.map((pin) => pin.at)).toEqual([
      { x: -30, y: 10 },
      { x: -30, y: -10 },
      { x: 30, y: 0 },
    ]);
    expect(
      differential.primitives.filter(
        (primitive) =>
          primitive.part === "input-polarity" ||
          primitive.part === "upright-input-polarity-negative",
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "line",
          from: { x: -13, y: 10 },
          to: { x: -7, y: 10 },
        }),
        expect.objectContaining({
          kind: "line",
          from: { x: -10, y: 7 },
          to: { x: -10, y: 13 },
        }),
        expect.objectContaining({
          kind: "line",
          from: { x: -13, y: -10 },
          to: { x: -7, y: -10 },
        }),
      ]),
    );
  });

  it("keeps Analog Blocks on-grid with deliberate triangle leads", () => {
    const analogBlocks = [
      "opamp",
      "opamp-lettered",
      "opamp-differential",
      "opamp-differential-lettered",
      "voltage-amplifier",
      "voltage-amplifier-lettered",
      "transconductance",
      "differential-transconductance",
      "comparator",
      "comparator-unmarked",
      "adc",
      "dac",
    ];
    const triangleBlocks = new Set([
      "opamp",
      "opamp-lettered",
      "opamp-differential",
      "opamp-differential-lettered",
      "voltage-amplifier",
      "voltage-amplifier-lettered",
      "comparator",
      "comparator-unmarked",
    ]);

    for (const symbolId of analogBlocks) {
      const symbol = requireRazaviCatalogSymbol(symbolId);
      for (const pin of symbol.pins) {
        expect(Math.abs(pin.at.x % 10), `${symbolId}.${pin.name} x`).toBe(0);
        expect(Math.abs(pin.at.y % 10), `${symbolId}.${pin.name} y`).toBe(0);
        expect(
          pin.presentation.leadLength,
          `${symbolId}.${pin.name} declared lead`,
        ).toBeLessThanOrEqual(10);
        const attached = symbol.primitives.filter(
          (primitive) =>
            primitive.kind === "line" &&
            ((primitive.from.x === pin.at.x && primitive.from.y === pin.at.y) ||
              (primitive.to.x === pin.at.x && primitive.to.y === pin.at.y)),
        );
        expect(attached, `${symbolId}.${pin.name} lead count`).toHaveLength(1);
        const line = attached[0];
        if (!line || line.kind !== "line") continue;
        const drawnLength = Math.hypot(
          line.to.x - line.from.x,
          line.to.y - line.from.y,
        );
        if (triangleBlocks.has(symbolId)) {
          expect(
            drawnLength,
            `${symbolId}.${pin.name} drawn lead`,
          ).toBeGreaterThan(10);
          expect(
            drawnLength,
            `${symbolId}.${pin.name} drawn lead`,
          ).toBeLessThanOrEqual(20);
        } else {
          expect(
            drawnLength,
            `${symbolId}.${pin.name} drawn lead`,
          ).toBeLessThanOrEqual(10);
        }
      }
    }
  });

  it("keeps Signal Flow leads within one grid cell and closes circular seams", () => {
    const signalFlowFamily = [
      "adder",
      "multiplier",
      "transconductance",
      "integrator",
      "unit-delay",
      "discrete-time-integrator",
      "quantizer",
    ];

    for (const symbolId of signalFlowFamily) {
      const symbol = requireRazaviCatalogSymbol(symbolId);
      for (const pin of symbol.pins) {
        expect(Math.abs(pin.at.x % 10), `${symbolId}.${pin.name} x`).toBe(0);
        expect(Math.abs(pin.at.y % 10), `${symbolId}.${pin.name} y`).toBe(0);
        expect(
          pin.presentation.leadLength,
          `${symbolId}.${pin.name} declared lead`,
        ).toBe(10);

        const attached = symbol.primitives.filter(
          (primitive) =>
            primitive.kind === "line" &&
            ((primitive.from.x === pin.at.x && primitive.from.y === pin.at.y) ||
              (primitive.to.x === pin.at.x && primitive.to.y === pin.at.y)),
        );
        expect(attached, `${symbolId}.${pin.name} lead count`).toHaveLength(1);
        const line = attached[0];
        if (!line || line.kind !== "line") continue;
        expect(
          Math.hypot(line.to.x - line.from.x, line.to.y - line.from.y),
          `${symbolId}.${pin.name} drawn lead`,
        ).toBeLessThanOrEqual(10);
      }
    }

    const adder = requireRazaviCatalogSymbol("adder");
    const body = adder.primitives.find(
      (primitive) => primitive.kind === "circle" && primitive.part === "body",
    );
    if (!body || body.kind !== "circle") {
      throw new Error("Adder circle is missing");
    }
    for (const part of ["input-a-lead", "input-b-lead", "output-y-lead"]) {
      const line = adder.primitives.find(
        (primitive) => primitive.kind === "line" && primitive.part === part,
      );
      if (!line || line.kind !== "line") {
        throw new Error(`Adder ${part} is missing`);
      }
      const fromRadius = Math.hypot(
        line.from.x - body.center.x,
        line.from.y - body.center.y,
      );
      const toRadius = Math.hypot(
        line.to.x - body.center.x,
        line.to.y - body.center.y,
      );
      expect(Math.min(fromRadius, toRadius), part).toBeGreaterThan(body.radius);
    }
  });

  it("draws the quantizer on a square body with its staircase inset evenly", () => {
    // The body holds a transfer characteristic, so it needs the same room on
    // both axes; it is not the integrator's wide-and-short formula box it was
    // provisionally derived from. Assert the shape, not the size, so a later
    // resize cannot flatten it again.
    const symbol = requireRazaviCatalogSymbol("quantizer");
    const body = symbol.primitives.find(
      (primitive) => primitive.part === "body",
    );
    const staircase = symbol.primitives.find(
      (primitive) => primitive.part === "quantizer-staircase",
    );
    if (
      !body ||
      body.kind !== "path" ||
      !staircase ||
      staircase.kind !== "polyline"
    ) {
      throw new Error("Quantizer body or staircase is missing");
    }
    const extent = (points: readonly { x: number; y: number }[]) => {
      const xs = points.map((point) => point.x);
      const ys = points.map((point) => point.y);
      return {
        left: Math.min(...xs),
        right: Math.max(...xs),
        top: Math.min(...ys),
        bottom: Math.max(...ys),
      };
    };
    const bodyExtent = extent(pathPoints(body.data));
    expect(bodyExtent.right - bodyExtent.left).toBe(
      bodyExtent.bottom - bodyExtent.top,
    );

    // The staircase reads as a plot inside a frame, so every margin stays
    // comparable — a bare "it fits" check would let it drift into a corner.
    const stairExtent = extent(staircase.points);
    const margins = [
      stairExtent.left - bodyExtent.left,
      bodyExtent.right - stairExtent.right,
      stairExtent.top - bodyExtent.top,
      bodyExtent.bottom - stairExtent.bottom,
    ];
    for (const margin of margins) {
      expect(margin).toBeGreaterThanOrEqual(4);
    }
    expect(Math.max(...margins) - Math.min(...margins)).toBeLessThanOrEqual(2);
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
      "opamp-differential-lettered",
      "diode",
      "zener-diode",
      "closed-switch",
      "ideal-switch",
      "npn",
      "pnp",
      "voltage-amplifier",
      "voltage-amplifier-lettered",
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

  it("composes the PDF-positioned XFMR from two reviewed Inductor paths", () => {
    const xfmr = requireRazaviCatalogSymbol("xfmr");
    expect(xfmr.pins).toMatchObject([
      { name: "P-", at: { x: -30, y: -10 }, direction: "west" },
      { name: "P+", at: { x: 30, y: -10 }, direction: "east" },
      { name: "S-", at: { x: -30, y: 10 }, direction: "west" },
      { name: "S+", at: { x: 30, y: 10 }, direction: "east" },
    ]);
    expect(
      xfmr.primitives.filter((primitive) => primitive.kind === "path"),
    ).toHaveLength(2);
    expect(
      xfmr.primitives.filter(
        (primitive) =>
          primitive.kind === "circle" && primitive.fill === "foreground",
      ),
    ).toMatchObject([
      { center: { x: 19.1423, y: -18.9541 }, radius: 2.2903 },
      { center: { x: 19.1423, y: 19.3646 }, radius: 2.2903 },
    ]);
    expect(
      xfmr.primitives.some(
        (primitive) =>
          primitive.kind === "circle" &&
          xfmr.pins.some(
            (pin) =>
              pin.at.x === primitive.center.x &&
              pin.at.y === primitive.center.y,
          ),
      ),
    ).toBe(false);
  });

  it("keeps the bridged T-coil atomic while reusing reviewed L and C artwork", () => {
    const tcoil = requireRazaviCatalogSymbol("tcoil");
    expect(tcoil.pins).toMatchObject([
      { name: "1", at: { x: -100, y: 0 }, direction: "west" },
      { name: "2", at: { x: 100, y: 0 }, direction: "east" },
      { name: "3", at: { x: 0, y: 20 }, direction: "south" },
    ]);
    expect(
      tcoil.primitives.filter((primitive) => primitive.kind === "path"),
    ).toHaveLength(2);
    expect(
      tcoil.primitives.filter((primitive) =>
        primitive.part?.startsWith("bridge-capacitor-"),
      ),
    ).toHaveLength(4);
    expect(
      tcoil.primitives.find(
        (primitive) => primitive.part === "bridge-capacitor-1",
      ),
    ).toMatchObject({
      kind: "line",
      from: { x: -3.2336, y: -51.3856 },
      to: { x: -3.2336, y: -35.2844 },
    });
    expect(
      tcoil.primitives.filter((primitive) =>
        primitive.part?.startsWith("internal-junction-"),
      ),
    ).toHaveLength(3);
    expect(
      tcoil.primitives.find(
        (primitive) => primitive.part === "winding-center-link",
      ),
    ).toMatchObject({
      kind: "line",
      from: { x: -21.1244, y: 0 },
      to: { x: 22.3124, y: 0 },
    });
    const polarityDots = tcoil.primitives.filter(
      (primitive) =>
        primitive.kind === "circle" && primitive.part?.endsWith("-polarity"),
    );
    expect(polarityDots).toHaveLength(2);
    for (const polarityDot of polarityDots) {
      if (polarityDot.kind !== "circle") {
        throw new Error("T-coil polarity primitive must be a circle");
      }
      expect(polarityDot.radius).toBe(3.77907);
    }
    expect(
      tcoil.primitives.some(
        (primitive) =>
          primitive.kind === "circle" &&
          tcoil.pins.some(
            (pin) =>
              pin.at.x === primitive.center.x &&
              pin.at.y === primitive.center.y,
          ),
      ),
    ).toBe(false);
    expect(getRazaviCatalogEntry("tcoil")?.manualOnlyReason).toContain(
      "composite L1/L2/K/CB network",
    );
  });

  it("uses the PDF-derived three-terminal op-amp geometry and polarity marks", () => {
    const opamp = requireRazaviCatalogSymbol("opamp");
    expect(opamp.pins).toMatchObject([
      { name: "IN+", at: { x: -40, y: 10 }, direction: "west" },
      { name: "IN-", at: { x: -40, y: -10 }, direction: "west" },
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

  it("keeps BJT bodies and arrows while compacting leads to the nearest grid", () => {
    const npn = requireRazaviCatalogSymbol("npn");
    expect(npn.pins).toMatchObject([
      { name: "C", at: { x: 0, y: -20 }, direction: "north" },
      { name: "B", at: { x: -30, y: 0 }, direction: "west" },
      { name: "E", at: { x: 0, y: 20 }, direction: "south" },
    ]);
    const pnp = requireRazaviCatalogSymbol("pnp");
    expect(pnp.pins).toMatchObject([
      { name: "C", at: { x: 0, y: 20 }, direction: "south" },
      { name: "B", at: { x: -30, y: 0 }, direction: "west" },
      { name: "E", at: { x: 0, y: -20 }, direction: "north" },
    ]);
    expect(npn.viewBox).toEqual({ x: -34, y: -24, width: 42, height: 48 });
    expect(pnp.viewBox).toEqual(npn.viewBox);
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
          data: "M -26.7979 -24.9983 L -26.7979 25 L 23.2021 0 Z",
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
          part: "upright-polarity-positive-horizontal",
          from: { x: -20.058139, y: -14.534884 },
          to: { x: -11.918605, y: -14.534884 },
        }),
        expect.objectContaining({
          kind: "line",
          part: "upright-polarity-positive-vertical",
          from: { x: -15.988372, y: -18.604651 },
          to: { x: -15.988372, y: -10.465117 },
        }),
        expect.objectContaining({
          kind: "line",
          part: "upright-polarity-negative",
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
    expect(markedGlyphCentreX).toBe(-7);
  });

  it("keeps the hysteresis glyph clear of the body and the polarity marks", () => {
    // The glyph is our own drawing inside a traced body: the triangle and the
    // +/- marks come from the Figure 8.26 op-amp and may not move, so the
    // glyph is the only piece with freedom. Assert the conclusion — visible
    // white space on every side — rather than one position, so a later nudge
    // cannot quietly park it against the apex again. Painted half-widths sum
    // to 2.0 (emphasis 2.4, normal 1.6), so 3 units of centre-line clearance
    // is the narrowest gap that still reads as separated.
    const MIN_CLEARANCE = 3;
    const distanceToSegment = (
      point: { x: number; y: number },
      from: { x: number; y: number },
      to: { x: number; y: number },
    ) => {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const lengthSquared = dx * dx + dy * dy;
      const t =
        lengthSquared === 0
          ? 0
          : Math.max(
              0,
              Math.min(
                1,
                ((point.x - from.x) * dx + (point.y - from.y) * dy) /
                  lengthSquared,
              ),
            );
      return Math.hypot(
        point.x - (from.x + t * dx),
        point.y - (from.y + t * dy),
      );
    };
    const segmentDistance = (
      a: readonly { x: number; y: number }[],
      b: readonly { x: number; y: number }[],
    ) =>
      Math.min(
        ...a.map((point) => distanceToSegment(point, b[0]!, b[1]!)),
        ...b.map((point) => distanceToSegment(point, a[0]!, a[1]!)),
      );

    for (const symbolId of ["comparator", "comparator-unmarked"]) {
      const symbol = requireRazaviCatalogSymbol(symbolId);
      const glyph = symbol.primitives.find(
        (primitive) => primitive.part === "hysteresis-step",
      );
      const body = symbol.primitives.find(
        (primitive) =>
          primitive.kind === "path" && primitive.part !== "hysteresis-step",
      );
      if (!glyph || glyph.kind !== "path" || !body || body.kind !== "path") {
        throw new Error(`${symbolId} is missing its body or hysteresis glyph`);
      }
      const glyphPoints = pathPoints(glyph.data);
      const bodyPoints = pathPoints(body.data);
      const obstacles: Array<readonly { x: number; y: number }[]> = [
        // The triangle closes back to its first point, apex edges included.
        ...bodyPoints.map((point, index) => [
          point,
          bodyPoints[(index + 1) % bodyPoints.length]!,
        ]),
        // Polarity marks, when this variant draws them.
        ...symbol.primitives.flatMap((primitive) =>
          primitive.kind === "line" &&
          Math.abs(primitive.from.y) > 10 &&
          Math.abs(primitive.to.y) > 10
            ? [[primitive.from, primitive.to] as const]
            : [],
        ),
      ];
      const glyphSegments = glyphPoints
        .slice(0, -1)
        .map((point, index) => [point, glyphPoints[index + 1]!] as const);

      for (const obstacle of obstacles) {
        for (const segment of glyphSegments) {
          expect(
            segmentDistance(segment, obstacle),
            `${symbolId} hysteresis glyph crowds ${JSON.stringify(obstacle)}`,
          ).toBeGreaterThanOrEqual(MIN_CLEARANCE);
        }
      }
    }
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

  it("keeps semantic entries browsable and visual variants internal", () => {
    for (const symbolId of family) {
      const entry = getRazaviCatalogEntry(symbolId);
      expect(entry?.palette).toBe(symbolId !== "comparator-unmarked");
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

  it("groups the differential control pins without shorting them", () => {
    // CP and CN sense a differential control voltage. A single joined rail
    // would be visually tidy but electrically claim a short, so both leads
    // enter one labelled control body while remaining separate primitives.
    const symbol = requireRazaviCatalogSymbol("voltage-controlled-switch");
    const switchedReach = Math.abs(
      symbol.pins.find((candidate) => candidate.name === "P")!.at.x,
    );
    for (const pinName of ["CP", "CN"]) {
      const pin = symbol.pins.find((candidate) => candidate.name === pinName);
      expect(pin, pinName).toBeDefined();
      if (!pin) continue;
      expect(Math.abs(pin.at.x), `${pinName} anchor`).toBe(switchedReach);
      const lead = symbol.primitives.find(
        (primitive) =>
          primitive.kind === "line" &&
          primitive.part ===
            (pinName === "CP"
              ? "control-positive-lead"
              : "control-negative-lead") &&
          primitive.from.y === pin.at.y &&
          primitive.to.y === pin.at.y &&
          (primitive.from.x === pin.at.x || primitive.to.x === pin.at.x),
      );
      expect(lead, `${pinName} control lead`).toBeDefined();
      if (!lead || lead.kind !== "line") continue;
      expect(Math.abs(lead.to.x - lead.from.x), `${pinName} lead length`).toBe(
        10,
      );
    }
    expect(
      symbol.primitives.some(
        (primitive) =>
          primitive.kind === "path" && primitive.part === "control-body",
      ),
    ).toBe(true);
    expect(
      symbol.primitives.some(
        (primitive) => primitive.part === "control-polarity-positive",
      ),
    ).toBe(true);
    expect(
      symbol.primitives.some(
        (primitive) => primitive.part === "control-polarity-negative",
      ),
    ).toBe(true);
    expect(
      symbol.primitives.some(
        (primitive) =>
          primitive.kind === "line" &&
          primitive.from.x === -10 &&
          primitive.to.x === 10 &&
          primitive.from.y === 20 &&
          primitive.to.y === 20,
      ),
      "CP and CN must not be shorted by artwork",
    ).toBe(false);
  });
});

describe("house-drawn switch additions", () => {
  it("draws the simple switch as one broken line, with no contact circles", () => {
    // The point of this symbol is what it does NOT have: the contact circles
    // of the traced switch. Analog schematics draw a sampling switch as a
    // line with a blade, and that is what makes it quicker to read in a
    // dense circuit.
    const symbol = requireRazaviCatalogSymbol("simple-switch");
    expect(symbol.primitives.every((p) => p.kind === "line")).toBe(true);
    expect(symbol.pins.map((pin) => pin.name)).toEqual(["1", "2"]);
    for (const pin of symbol.pins) {
      expect(Math.abs(pin.at.x), `${pin.name} anchor`).toBe(20);
      expect(pin.at.y).toBe(0);
    }
    // The blade leaves the left contact and stops short of the right one:
    // the gap is the open state, so a closed-looking bridge would be wrong.
    const blade = symbol.primitives.find(
      (p) => p.kind === "line" && p.from.y !== p.to.y,
    );
    expect(blade, "blade").toBeDefined();
    if (!blade || blade.kind !== "line") return;
    const rightLead = symbol.primitives.find(
      (p) =>
        p.kind === "line" && p.from.y === 0 && p.to.y === 0 && p.to.x === 20,
    );
    expect(rightLead, "right lead").toBeDefined();
    if (!rightLead || rightLead.kind !== "line") return;
    expect(blade.to.x).toBeLessThan(rightLead.from.x);
  });

  it("gives the SPDT switch one common terminal and two throws", () => {
    // Pin ORDER is a shared contract: common first, then the throws in the
    // order they are drawn, top to bottom. Anything reading this device by
    // position depends on it, so it changes only with its callers.
    const symbol = requireRazaviCatalogSymbol("spdt-switch");
    expect(symbol.pins.map((pin) => pin.name)).toEqual(["COM", "A", "B"]);
    const at = (name: string) =>
      symbol.pins.find((pin) => pin.name === name)!.at;
    expect(at("COM")).toEqual({ x: -20, y: 0 });
    // A is the upper throw, B the lower — the drawing and the order agree.
    expect(at("A")).toEqual({ x: 20, y: -10 });
    expect(at("B")).toEqual({ x: 20, y: 10 });
    // The blade rests on a throw rather than floating between them, so the
    // symbol states a position instead of showing both contacts open.
    const circles = symbol.primitives.filter((p) => p.kind === "circle");
    expect(circles).toHaveLength(3);
    const blade = symbol.primitives.find(
      (p) => p.kind === "line" && p.from.y !== p.to.y,
    );
    expect(blade, "blade").toBeDefined();
    if (!blade || blade.kind !== "line") return;
    expect(blade.to.y).toBeLessThan(blade.from.y);
  });

  it("keeps the plain selector out of the Library and identical in pins", () => {
    // The point of this entry is that it does NOT add a sixth switch tile:
    // it is the SPDT's other drawing, reached by an action. Its pins match
    // the circled one exactly, which is what lets the exchange keep every
    // wired terminal.
    const entry = getRazaviCatalogEntry("simple-spdt-switch");
    expect(entry?.palette).toBe(false);
    const plain = requireRazaviCatalogSymbol("simple-spdt-switch");
    const circled = requireRazaviCatalogSymbol("spdt-switch");
    expect(plain.pins.map((pin) => pin.name)).toEqual(
      circled.pins.map((pin) => pin.name),
    );
    expect(plain.pins.map((pin) => pin.at)).toEqual(
      circled.pins.map((pin) => pin.at),
    );
    // Same device, different drawing: no contact circles at all.
    expect(plain.primitives.every((p) => p.kind === "line")).toBe(true);
    expect(circled.primitives.some((p) => p.kind === "circle")).toBe(true);
  });

  it("keeps both additions off the automatic netlist path", () => {
    // A two-terminal switch has no SPICE form and a double-throw switch has
    // no primitive at all; emitting either would write a line no simulator
    // accepts. They stay manual, stated in the catalog rather than implied.
    for (const symbolId of ["simple-switch", "spdt-switch"]) {
      const entry = getRazaviCatalogEntry(symbolId);
      expect(entry, symbolId).toBeDefined();
      expect(entry?.automaticMappings, symbolId).toEqual([]);
      expect(entry?.manualOnlyReason, symbolId).toBeTruthy();
    }
  });
});

describe("logic-library port leads", () => {
  const logicIds = [
    "and-gate",
    "buffer",
    "d-flip-flop",
    "d-flip-flop-reset",
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
        const horizontal = pin.direction === "west" || pin.direction === "east";
        const outwardSign =
          pin.direction === "west" || pin.direction === "north" ? -1 : 1;
        const pinCoordinate = horizontal ? pin.at.x : pin.at.y;
        const bodyCoordinate = horizontal ? bodyContact.x : bodyContact.y;
        const nominalBodyCoordinate = Math.round(bodyCoordinate / 5) * 5;
        const oneCellOut = nominalBodyCoordinate + outwardSign * 10;
        const expectedCoordinate =
          outwardSign < 0
            ? Math.floor(oneCellOut / 10) * 10
            : Math.ceil(oneCellOut / 10) * 10;
        const nominalLeadLength = Math.abs(
          expectedCoordinate - nominalBodyCoordinate,
        );

        expect(pinCoordinate, `${symbolId}.${pin.name}`).toBe(
          expectedCoordinate,
        );
        expect(Math.abs(pinCoordinate % 10), `${symbolId}.${pin.name}`).toBe(0);
        if (!horizontal) {
          expect(pin.at.x, `${symbolId}.${pin.name}`).toBe(bodyContact.x);
        }
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
