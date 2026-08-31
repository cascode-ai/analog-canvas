#!/usr/bin/env node
// Draws the data-converter blocks: an ADC and a DAC, each a five-sided arrow
// whose point states which way the conversion runs — left into the digital
// domain, right back out of it.
//
// House-drawn: the reference covers converter internals, never a block for
// one on a sheet, so these claim no textbook authority.
//
// Body text uses the general editable-body-text contract: the Symbol says
// the default (`ADC`, `DAC`) and where it sits, and each Instance owns the
// text through `signalFlowParameters.formula`. A sheet with two converters
// can name them without them becoming different parts.
//
// Geometry notes:
// - `polygon`, not `path`, so `visibleSymbolLocalBounds` bounds the artwork
//   from its own drawn points instead of falling back to the viewBox. The
//   hit box then hugs the shape the way every other primitive-drawn Symbol's
//   does.
// - Pin anchors land on multiples of the connection grid and the leads are
//   short (5), matching the switch family rather than the older long-lead
//   symbols.
// - The text sits on the AREA centroid, not the bounding-box centre: the
//   point pulls a pentagon's visual middle towards the blunt end, and text
//   centred on the box would drift into the tip.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import process from "node:process";

import { format } from "prettier";

const root = resolve(import.meta.dirname, "..");
const assetRoot = resolve(root, "packages/symbols/assets/razavi-v1");
const catalogPath = resolve(assetRoot, "catalog.json");
const check = process.argv.includes("--check");

function fail(message) {
  console.error(`generate-converter-assets: ${message}`);
  process.exit(1);
}

const normalize = (text) => text.replace(/\r\n/gu, "\n").trimEnd() + "\n";
const hash = (text) => createHash("sha256").update(text).digest("hex");

/** Half-extents of the body, and how far a lead reaches past it. */
const BODY_HALF_WIDTH = 25;
const BODY_HALF_HEIGHT = 15;
const TIP_INSET = 10;
const PIN_ANCHOR_X = 30;
const LEAD_LENGTH = PIN_ANCHOR_X - BODY_HALF_WIDTH;
const FONT_SIZE = 12;

/**
 * Area centroid of a simple polygon. The shoelace form, so the point comes
 * from the shape itself rather than from an average of its corners — for an
 * arrow the two differ by several units, which is the difference between
 * text that looks centred and text that looks pushed.
 */
function polygonCentroid(points) {
  let twiceArea = 0;
  let x = 0;
  let y = 0;
  for (const [index, current] of points.entries()) {
    const next = points[(index + 1) % points.length];
    const cross = current.x * next.y - next.x * current.y;
    twiceArea += cross;
    x += (current.x + next.x) * cross;
    y += (current.y + next.y) * cross;
  }
  if (twiceArea === 0) fail("degenerate body polygon");
  const round = (value) => Math.round(value * 100) / 100;
  return { x: round(x / (3 * twiceArea)), y: round(y / (3 * twiceArea)) };
}

/**
 * The arrow body. `pointsRight` puts the tip on the output side, which is
 * the DAC; the ADC mirrors it so its tip leads into the digital domain.
 */
function bodyPoints(pointsRight) {
  const sign = pointsRight ? 1 : -1;
  return [
    { x: -sign * BODY_HALF_WIDTH, y: -BODY_HALF_HEIGHT },
    { x: sign * (BODY_HALF_WIDTH - TIP_INSET), y: -BODY_HALF_HEIGHT },
    { x: sign * BODY_HALF_WIDTH, y: 0 },
    { x: sign * (BODY_HALF_WIDTH - TIP_INSET), y: BODY_HALF_HEIGHT },
    { x: -sign * BODY_HALF_WIDTH, y: BODY_HALF_HEIGHT },
  ];
}

function converterSymbol({ id, name, defaultText, pointsRight }) {
  const points = bodyPoints(pointsRight);
  return {
    schemaVersion: 1,
    id,
    name,
    viewBox: {
      x: -(PIN_ANCHOR_X + 4),
      y: -(BODY_HALF_HEIGHT + 4),
      width: (PIN_ANCHOR_X + 4) * 2,
      height: (BODY_HALF_HEIGHT + 4) * 2,
    },
    pins: [
      {
        name: "IN",
        role: "input",
        at: { x: -PIN_ANCHOR_X, y: 0 },
        direction: "west",
        presentation: { visibility: "visible", leadLength: LEAD_LENGTH },
      },
      {
        name: "OUT",
        role: "output",
        at: { x: PIN_ANCHOR_X, y: 0 },
        direction: "east",
        presentation: { visibility: "visible", leadLength: LEAD_LENGTH },
      },
    ],
    primitives: [
      {
        kind: "line",
        from: { x: -PIN_ANCHOR_X, y: 0 },
        to: { x: -BODY_HALF_WIDTH, y: 0 },
        style: { strokeRole: "normal", lineCap: "butt", lineJoin: "miter" },
      },
      {
        kind: "polygon",
        points,
        // Empty inside, like every other body on the sheet.
        fill: "none",
        stroke: "foreground",
        style: { strokeRole: "emphasis", lineCap: "butt", lineJoin: "miter" },
      },
      {
        kind: "line",
        from: { x: BODY_HALF_WIDTH, y: 0 },
        to: { x: PIN_ANCHOR_X, y: 0 },
        style: { strokeRole: "normal", lineCap: "butt", lineJoin: "miter" },
      },
    ],
    variants: [],
    formulaPresentation: {
      defaultFormula: defaultText,
      // The label names the block; nothing scales it.
      supportsCoefficient: false,
      center: polygonCentroid(points),
      fontSize: FONT_SIZE,
    },
  };
}

const CONVERTERS = [
  {
    id: "adc",
    name: "Analog-to-Digital Converter",
    defaultText: "ADC",
    pointsRight: false,
    houseReason:
      "The reference draws converter internals, never a block standing for one on a sheet. Drawn here as the arrow a data path is read through.",
  },
  {
    id: "dac",
    name: "Digital-to-Analog Converter",
    defaultText: "DAC",
    pointsRight: true,
    houseReason:
      "The reference draws converter internals, never a block standing for one on a sheet. Drawn here as the ADC's mirror so a signal chain reads in both directions.",
  },
];

const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
const outputs = [];

for (const converter of CONVERTERS) {
  const symbol = converterSymbol(converter);
  const source = normalize(
    await format(JSON.stringify(symbol, null, 2), { parser: "json" }),
  );
  const assetPath = `${converter.id}.symbol.json`;
  outputs.push([resolve(assetRoot, assetPath), source]);

  const entry = {
    symbolId: converter.id,
    name: converter.name,
    category: "analog-block",
    reviewStatus: "reviewed",
    provenance: "house",
    houseReason: converter.houseReason,
    pinOrder: ["IN", "OUT"],
    palette: true,
    automaticMappings: [],
    manualOnlyReason:
      "A converter block stands for a subsystem; SPICE has no primitive for one.",
    assetPath,
    assetHash: hash(source),
  };
  const existingIndex = catalog.entries.findIndex(
    (candidate) => candidate.symbolId === converter.id,
  );
  if (existingIndex >= 0) catalog.entries[existingIndex] = entry;
  else catalog.entries.push(entry);
}

outputs.push([
  catalogPath,
  normalize(await format(JSON.stringify(catalog, null, 2), { parser: "json" })),
]);

if (check) {
  for (const [path, source] of outputs) {
    const existing = await readFile(path, "utf8").catch(() => null);
    if (existing === null || normalize(existing) !== source) {
      fail(`${relative(root, path)} is stale`);
    }
  }
} else {
  for (const [path, source] of outputs) {
    await writeFile(path, source, "utf8");
  }
}

console.log(
  `${check ? "Validated" : "Generated"} converter blocks ` +
    `(${CONVERTERS.map((converter) => converter.id).join(", ")})`,
);
