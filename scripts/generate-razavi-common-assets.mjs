import {
  readComponentProjection,
  writeComponentProjection,
} from "./lib/component-library.mjs";
import { createHash } from "node:crypto";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { format } from "prettier";

import { loadRazaviReferenceAuthority } from "./lib/razavi-reference-authority.mjs";
import { normalizeSwitchLeads } from "./lib/normalize-switch-leads.mjs";

/**
 * Switch leads came off the page at 15 to 26 units, so a switch sat further
 * from its wire than a logic gate does and the gap read as a stub the grid
 * could not explain. These take the same one-cell normalization the logic
 * ports took in f13355ea: bodies untouched, anchors back on the grid.
 *
 * voltage-controlled-switch is deliberately absent: it is house-authored
 * (#364) with no generator behind it, so listing it here would be a rule
 * that never runs. Its through-path anchors carry the same one-cell lead,
 * held by the catalog test rather than by this pass.
 */
const ONE_CELL_LEAD_SYMBOLS = new Set(["closed-switch", "ideal-switch"]);
const ANALOG_BLOCK_LEAD_LENGTH = 10;
const ANALOG_TRIANGLE_VIEWBOX = { x: -44, y: -28, width: 88, height: 56 };
const ANALOG_TRIANGLE_PATH = "M -26.7979 -24.9983 L -26.7979 25 L 23.2021 0 Z";
const ANALOG_TRIANGLE_LEFT_X = -26.7979;
const ANALOG_TRIANGLE_APEX_X = 23.2021;

/**
 * Every triangular Analog Block shares the Op Amp body and leaves one clear
 * connection-grid step outside it. This keeps Library tiles and placed
 * symbols visually interchangeable instead of preserving incidental source-
 * figure differences.
 */
function normalizeVoltageAmplifierLeads(symbol) {
  const targetX = new Map([
    ["IN", -40],
    ["OUT", 40],
  ]);
  symbol.pins = symbol.pins.map((pin) => ({
    ...pin,
    at: { ...pin.at, x: targetX.get(pin.name) },
    presentation: {
      ...pin.presentation,
      leadLength: ANALOG_BLOCK_LEAD_LENGTH,
    },
  }));
  const [inputLead, body, outputLead] = symbol.primitives;
  if (
    inputLead?.kind !== "line" ||
    body?.kind !== "path" ||
    outputLead?.kind !== "line"
  ) {
    fail("voltage-amplifier lost its lead/body/lead geometry");
  }
  symbol.primitives = [
    {
      ...inputLead,
      from: { x: -40, y: 0 },
      to: { x: ANALOG_TRIANGLE_LEFT_X, y: 0 },
    },
    {
      ...body,
      data: ANALOG_TRIANGLE_PATH,
      style: { ...body.style, miterLimit: 4 },
    },
    {
      ...outputLead,
      from: { x: ANALOG_TRIANGLE_APEX_X, y: 0 },
      to: { x: 40, y: 0 },
    },
  ];
  symbol.viewBox = ANALOG_TRIANGLE_VIEWBOX;
}

/**
 * The extracted BJT bodies and arrows are the visual authority, but their
 * blank external leads reached one grid cell beyond the nearest useful sheet
 * anchors. Pull only the three electrical pin endpoints inward by one
 * 10-unit cell; keep every body/arrow point unchanged.
 */
function normalizeBjtLeads(symbol) {
  const originalPins = new Map(
    symbol.pins.map((pin) => [pin.name, { ...pin.at }]),
  );
  const targetFor = (pin) =>
    pin.name === "B" ? { x: -30, y: 0 } : { x: 0, y: Math.sign(pin.at.y) * 20 };
  symbol.pins = symbol.pins.map((pin) => ({
    ...pin,
    at: targetFor(pin),
    presentation: {
      ...pin.presentation,
      leadLength: ANALOG_BLOCK_LEAD_LENGTH,
    },
  }));
  const replacePinAnchor = (point) => {
    const pin = symbol.pins.find((candidate) => {
      const original = originalPins.get(candidate.name);
      return original.x === point.x && original.y === point.y;
    });
    return pin ? { ...pin.at } : point;
  };
  symbol.primitives = symbol.primitives.map((primitive) => {
    if (primitive.kind === "line")
      return {
        ...primitive,
        from: replacePinAnchor(primitive.from),
        to: replacePinAnchor(primitive.to),
      };
    if (primitive.kind === "polyline")
      return {
        ...primitive,
        points: primitive.points.map(replacePinAnchor),
      };
    return primitive;
  });
  symbol.viewBox = { x: -34, y: -24, width: 42, height: 48 };
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const referenceRoot = resolve(
  root,
  "fixtures/visual-reference/razavi-reference-v1",
);
const assetRoot = resolve(root, "packages/components/definitions");
const catalogPath = resolve(assetRoot, "../catalog.json");
const check = process.argv.includes("--check");
const normalize = (value) => `${value.replaceAll("\r\n", "\n").trimEnd()}\n`;
const hash = (value) => createHash("sha256").update(value).digest("hex");

const entries = [
  ["closed-switch", "Closed Switch", "switch", ["1", "2"], []],
  ["diode", "Diode", "passive", ["A", "K"], ["spice:D"]],
  ["ideal-switch", "Ideal Switch", "switch", ["1", "2"], []],
  [
    "npn",
    "NPN Bipolar Transistor",
    "transistor",
    ["C", "B", "E"],
    ["spice:Q:npn", "pdk:model-type:npn"],
  ],
  [
    "pnp",
    "PNP Bipolar Transistor",
    "transistor",
    ["C", "B", "E"],
    ["spice:Q:pnp", "pdk:model-type:pnp"],
  ],
  ["voltage-amplifier", "Voltage Amplifier", "analog-block", ["IN", "OUT"], []],
];

function fail(message) {
  throw new Error(`Razavi common asset generation: ${message}`);
}

const { manifest, files } = await loadRazaviReferenceAuthority(referenceRoot);
const catalog = JSON.parse(await readComponentProjection(catalogPath));
for (const [symbolId, name, category, pinOrder, automaticMappings] of entries) {
  const authorityId = `razavi-textbook-${symbolId}`;
  const authority = manifest.vectorEvidence?.find(
    (candidate) => candidate.id === authorityId,
  );
  if (!authority || authority.kind !== "pdf-vector-extract")
    fail(`missing authority ${authorityId}`);
  const evidenceSource = files.get(authority.extractPath);
  if (!evidenceSource) fail(`missing loaded evidence ${authorityId}`);
  const evidence = JSON.parse(evidenceSource.toString("utf8"));
  const symbol = evidence.normalization?.symbolDefinition;
  if (
    evidence.id !== authorityId ||
    symbol?.id !== symbolId ||
    symbol.pins?.map((pin) => pin.name).join("\0") !== pinOrder.join("\0")
  ) {
    fail(`evidence contract mismatch for ${symbolId}`);
  }
  delete symbol.aliases;
  if (ONE_CELL_LEAD_SYMBOLS.has(symbolId)) normalizeSwitchLeads(symbol);
  if (symbolId === "npn" || symbolId === "pnp") normalizeBjtLeads(symbol);
  if (symbolId === "voltage-amplifier") {
    normalizeVoltageAmplifierLeads(symbol);
  }
  const assetPath = resolve(assetRoot, `${symbolId}.json`);
  const assetSource = normalize(
    await format(JSON.stringify(symbol, null, 2), { parser: "json" }),
  );
  const entry = catalog.entries.find(
    (candidate) => candidate.symbolId === symbolId,
  );
  const nextEntry = {
    symbolId,
    name,
    category,
    reviewStatus: "reviewed",
    pinOrder,
    palette: true,
    automaticMappings,
    ...(automaticMappings.length === 0
      ? {
          manualOnlyReason:
            symbolId === "ideal-switch" || symbolId === "closed-switch"
              ? "Two-terminal Razavi switch; SPICE S has a four-terminal control contract."
              : "Textbook gain block has implicit reference nodes and no exact primitive SPICE terminal contract.",
        }
      : {}),
    assetPath: `${symbolId}.json`,
    assetHash: hash(assetSource),
    visualAuthority: {
      kind: "razavi-reference-v1",
      referenceManifestPath:
        "fixtures/visual-reference/razavi-reference-v1/manifest.json",
      referencePaths: [
        `fixtures/visual-reference/razavi-reference-v1/${symbolId}-vector-source.json`,
        `fixtures/visual-reference/razavi-reference-v1/${symbolId}-reference.png`,
      ],
      calibrationPath:
        "fixtures/visual-reference/razavi-reference-v1/common-symbol-geometry.json",
    },
    generation: {
      kind: "razavi-pdf-vector-reference",
      referenceManifestPath:
        "fixtures/visual-reference/razavi-reference-v1/manifest.json",
      referencePath: `fixtures/visual-reference/razavi-reference-v1/${symbolId}-vector-source.json`,
      converterPath: "scripts/generate-razavi-common-assets.mjs",
      converterVersion: symbolId === "voltage-amplifier" ? 2 : 1,
    },
  };
  if (entry) Object.assign(entry, nextEntry);
  else catalog.entries.push(nextEntry);
  if (check) {
    if (normalize(await readComponentProjection(assetPath)) !== assetSource)
      fail(`${relative(root, assetPath)} is stale`);
  } else {
    await writeComponentProjection(assetPath, assetSource);
  }
}
const catalogSource = normalize(
  await format(JSON.stringify(catalog, null, 2), { parser: "json" }),
);
if (check) {
  if (normalize(await readComponentProjection(catalogPath)) !== catalogSource)
    fail(`${relative(root, catalogPath)} is stale`);
} else {
  await writeComponentProjection(catalogPath, catalogSource);
}
console.log(
  `${check ? "Validated" : "Generated"} ${entries.length} common Razavi assets`,
);
