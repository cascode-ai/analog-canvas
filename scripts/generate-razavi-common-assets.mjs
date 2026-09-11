import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
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

/**
 * Keep gain-block connection anchors on the nearest outer grid points. The
 * reference body is untouched; only the blank lead between it and the sheet
 * connection is compacted to the one-cell Analog Blocks contract.
 */
function normalizeVoltageAmplifierLeads(symbol) {
  const targetX = new Map([
    ["IN", -30],
    ["OUT", 30],
  ]);
  const originalPins = new Map(
    symbol.pins.map((pin) => [pin.name, { ...pin.at }]),
  );
  symbol.pins = symbol.pins.map((pin) => ({
    ...pin,
    at: { ...pin.at, x: targetX.get(pin.name) },
    presentation: {
      ...pin.presentation,
      leadLength: ANALOG_BLOCK_LEAD_LENGTH,
    },
  }));
  symbol.primitives = symbol.primitives.map((primitive) => {
    if (primitive.kind !== "line") return primitive;
    let from = primitive.from;
    let to = primitive.to;
    for (const pin of symbol.pins) {
      const original = originalPins.get(pin.name);
      if (from.x === original.x && from.y === original.y) from = pin.at;
      if (to.x === original.x && to.y === original.y) to = pin.at;
    }
    return { ...primitive, from, to };
  });
  symbol.viewBox = { x: -34, y: -32, width: 68, height: 64 };
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const referenceRoot = resolve(
  root,
  "fixtures/visual-reference/razavi-reference-v1",
);
const assetRoot = resolve(root, "packages/symbols/assets/razavi-v1");
const catalogPath = resolve(assetRoot, "catalog.json");
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
const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
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
  if (symbolId === "voltage-amplifier") {
    normalizeVoltageAmplifierLeads(symbol);
  }
  const assetPath = resolve(assetRoot, `${symbolId}.symbol.json`);
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
    assetPath: `${symbolId}.symbol.json`,
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
      converterVersion: 1,
    },
  };
  if (entry) Object.assign(entry, nextEntry);
  else catalog.entries.push(nextEntry);
  if (check) {
    if (normalize(await readFile(assetPath, "utf8")) !== assetSource)
      fail(`${relative(root, assetPath)} is stale`);
  } else {
    await writeFile(assetPath, assetSource, "utf8");
  }
}
const catalogSource = normalize(
  await format(JSON.stringify(catalog, null, 2), { parser: "json" }),
);
if (check) {
  if (normalize(await readFile(catalogPath, "utf8")) !== catalogSource)
    fail(`${relative(root, catalogPath)} is stale`);
} else {
  await writeFile(catalogPath, catalogSource, "utf8");
}
console.log(
  `${check ? "Validated" : "Generated"} ${entries.length} common Razavi assets`,
);
