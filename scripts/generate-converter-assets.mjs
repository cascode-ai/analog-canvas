#!/usr/bin/env node
import {
  readComponentProjection,
  writeComponentProjection,
} from "./lib/component-library.mjs";
// Draws the data-converter blocks: an ADC and a DAC, each a five-sided arrow
// whose point states which way the conversion runs — left into the digital
// domain, right back out of it — and a differential sibling of each, whose
// two analog pins enter the slanted faces either side of the point.
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
// - Every body vertex, body contact, and pin anchor lands on the 10-unit
//   connection grid. Leads extend exactly one cell beyond the body.
// - A differential pair sits one row either side of the mid-line, where the
//   slanted faces cross the grid, so the pair is 20 apart like the compact
//   op-amp's and comparator's. Its pins stay one cell beyond the point, in
//   the single pin's column, so wires arrive clear of the point; their leads
//   run two cells from the face. Its + and − marks are the comparator's
//   six-unit strokes, inside the face on the pin's own row.
// - The text sits on the AREA centroid, not the bounding-box centre: the
//   point pulls a pentagon's visual middle towards the blunt end, and text
//   centred on the box would drift into the tip.
import { createHash } from "node:crypto";
import { relative, resolve } from "node:path";
import process from "node:process";

import { format } from "prettier";

import { supplyPinsOn, withSupplyPins } from "./lib/supply-pins.mjs";

const root = resolve(import.meta.dirname, "..");
const assetRoot = resolve(root, "packages/components/definitions");
const catalogPath = resolve(assetRoot, "../catalog.json");
const check = process.argv.includes("--check");

function fail(message) {
  console.error(`generate-converter-assets: ${message}`);
  process.exit(1);
}

const normalize = (text) => text.replace(/\r\n/gu, "\n").trimEnd() + "\n";
const hash = (text) => createHash("sha256").update(text).digest("hex");

/** Grid-aligned body landmarks and the one-cell external leads. */
const BLUNT_EDGE_X = 30;
const TIP_X = 40;
const TIP_SHOULDER_X = 20;
const BODY_HALF_HEIGHT = 20;
const GRID = 10;
const LEAD_LENGTH = GRID;
const FONT_SIZE = 12;
/** A differential pair's rows, either side of the mid-line. */
const DIFFERENTIAL_ROW = 10;
/** A polarity mark's centre, inward of the face its pin meets. */
const MARK_INSET = 8;
const MARK_HALF_LENGTH = 3;
const LEAD_STYLE = { strokeRole: "normal", lineCap: "butt", lineJoin: "miter" };
const MARK_STYLE = {
  strokeRole: "normal",
  lineCap: "round",
  lineJoin: "round",
};

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
    { x: -sign * BLUNT_EDGE_X, y: -BODY_HALF_HEIGHT },
    { x: sign * TIP_SHOULDER_X, y: -BODY_HALF_HEIGHT },
    { x: sign * TIP_X, y: 0 },
    { x: sign * TIP_SHOULDER_X, y: BODY_HALF_HEIGHT },
    { x: -sign * BLUNT_EDGE_X, y: BODY_HALF_HEIGHT },
  ];
}

/** Where a slanted face crosses the row `y`, on the side `sign` points to. */
function faceX(sign, y) {
  const x =
    sign *
    (TIP_X - ((TIP_X - TIP_SHOULDER_X) * Math.abs(y)) / BODY_HALF_HEIGHT);
  if (x % GRID !== 0) fail(`face crosses row ${y} off the grid`);
  return x;
}

/**
 * The pins on one side, outermost first along the lead. A differential side
 * puts + on the lower row and − on the upper, as the op-amp and comparator
 * do; a single pin sits on the mid-line.
 */
function sidePins(side, bodyX, sign, differential) {
  const name = side === "input" ? "IN" : "OUT";
  const direction = sign < 0 ? "west" : "east";
  const pinX = bodyX + sign * LEAD_LENGTH;
  const pin = (pinName, role, contactX, y) => ({
    contactX,
    y,
    pin: {
      name: pinName,
      role,
      at: { x: pinX, y },
      direction,
      presentation: {
        visibility: "visible",
        leadLength: Math.abs(pinX - contactX),
      },
    },
  });
  if (!differential) return [pin(name, side, bodyX, 0)];
  const plusRole = side === "input" ? "non-inverting-input" : "output";
  const minusRole = side === "input" ? "inverting-input" : "output";
  return [
    pin(`${name}+`, plusRole, faceX(sign, DIFFERENTIAL_ROW), DIFFERENTIAL_ROW),
    pin(
      `${name}-`,
      minusRole,
      faceX(sign, -DIFFERENTIAL_ROW),
      -DIFFERENTIAL_ROW,
    ),
  ];
}

/** A plus and a minus inside the faces, on the rows of the pins they name. */
function polarityMarks(side, [plus, minus], sign) {
  const x = plus.contactX - sign * MARK_INSET;
  const line = (from, to, part) => ({
    kind: "line",
    from,
    to,
    part,
    style: MARK_STYLE,
  });
  return [
    line(
      { x, y: plus.y - MARK_HALF_LENGTH },
      { x, y: plus.y + MARK_HALF_LENGTH },
      `${side}-polarity`,
    ),
    line(
      { x: x - MARK_HALF_LENGTH, y: plus.y },
      { x: x + MARK_HALF_LENGTH, y: plus.y },
      `${side}-polarity`,
    ),
    line(
      { x: x - MARK_HALF_LENGTH, y: minus.y },
      { x: x + MARK_HALF_LENGTH, y: minus.y },
      `upright-${side}-polarity-negative`,
    ),
  ];
}

function converterSymbol({ id, name, defaultText, pointsRight, differential }) {
  // Only the point has faces to carry a pair; the blunt edge keeps one pin.
  const tipSide = pointsRight ? "output" : "input";
  if (differential && differential !== tipSide)
    fail(`${id}: a differential ${differential} needs the point on that side`);
  const points = bodyPoints(pointsRight);
  const leftBodyX = pointsRight ? -BLUNT_EDGE_X : -TIP_X;
  const rightBodyX = pointsRight ? TIP_X : BLUNT_EDGE_X;
  const inputs = sidePins("input", leftBodyX, -1, differential === "input");
  const outputs = sidePins("output", rightBodyX, 1, differential === "output");
  const pinXs = [...inputs, ...outputs].map(({ pin }) => pin.at.x);
  const leftPinX = Math.min(...pinXs);
  const rightPinX = Math.max(...pinXs);
  return {
    schemaVersion: 1,
    id,
    name,
    viewBox: {
      x: leftPinX - 4,
      y: -(BODY_HALF_HEIGHT + 4),
      width: rightPinX - leftPinX + 8,
      height: (BODY_HALF_HEIGHT + 4) * 2,
    },
    pins: [...inputs, ...outputs].map(({ pin }) => pin),
    primitives: [
      ...inputs.map(({ pin, contactX, y }) => ({
        kind: "line",
        from: { x: pin.at.x, y },
        to: { x: contactX, y },
        style: LEAD_STYLE,
      })),
      {
        kind: "polygon",
        points,
        fillableBody: true,
        // Empty inside, like every other body on the sheet.
        fill: "none",
        stroke: "foreground",
        style: { strokeRole: "emphasis", lineCap: "butt", lineJoin: "miter" },
      },
      ...outputs.map(({ pin, contactX, y }) => ({
        kind: "line",
        from: { x: contactX, y },
        to: { x: pin.at.x, y },
        style: LEAD_STYLE,
      })),
      ...(differential === "input" ? polarityMarks("input", inputs, -1) : []),
      ...(differential === "output" ? polarityMarks("output", outputs, 1) : []),
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
  {
    id: "adc-differential",
    name: "Differential Analog-to-Digital Converter",
    defaultText: "ADC",
    pointsRight: false,
    differential: "input",
    houseReason:
      "The ADC's arrow with a differential input: IN+ and IN- enter the slanted faces a grid row either side of the point, marked as the differential op-amp and comparator are, so two signal lines need not meet at one pin.",
  },
  {
    id: "dac-differential",
    name: "Differential Digital-to-Analog Converter",
    defaultText: "DAC",
    pointsRight: true,
    differential: "output",
    houseReason:
      "The DAC's arrow with a differential output: OUT+ and OUT- leave the slanted faces a grid row either side of the point, mirroring the differential ADC.",
  },
];

const catalog = JSON.parse(await readComponentProjection(catalogPath));
const outputs = [];

/**
 * A single-ended converter's supplies, drawn when an Instance shows them
 * (#1941): VDD above and VSS below, on leads from its flat edges to the next
 * grid row. The differential forms keep their own.
 */
const SUPPLY_PIN_Y = BODY_HALF_HEIGHT + 10;
const withSupplies = (symbol) =>
  withSupplyPins(
    symbol,
    supplyPinsOn(
      symbol.primitives.find((primitive) => primitive.kind === "polygon"),
      { x: 0, y: -SUPPLY_PIN_Y },
      { x: 0, y: SUPPLY_PIN_Y },
    ),
  );

for (const converter of CONVERTERS) {
  const symbol = converter.differential
    ? converterSymbol(converter)
    : withSupplies(converterSymbol(converter));
  const source = normalize(
    await format(JSON.stringify(symbol, null, 2), { parser: "json" }),
  );
  const assetPath = `${converter.id}.json`;
  outputs.push([resolve(assetRoot, assetPath), source]);

  const entry = {
    symbolId: converter.id,
    name: converter.name,
    category: "analog-block",
    reviewStatus: "reviewed",
    provenance: "house",
    houseReason: converter.houseReason,
    pinOrder: symbol.pins.map((pin) => pin.name),
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
    const existing = await readComponentProjection(path).catch(() => null);
    if (existing === null || normalize(existing) !== source) {
      fail(`${relative(root, path)} is stale`);
    }
  }
} else {
  for (const [path, source] of outputs) {
    await writeComponentProjection(path, source);
  }
}

console.log(
  `${check ? "Validated" : "Generated"} converter blocks ` +
    `(${CONVERTERS.map((converter) => converter.id).join(", ")})`,
);
