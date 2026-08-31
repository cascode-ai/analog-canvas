#!/usr/bin/env node
// Derives the lettered amplifier bodies from their plain sources.
//
// An amplifier drawn with a letter inside the triangle — A for a gain stage,
// G, B, whatever the author means — is ordinary analog notation, and the
// letter belongs to the Instance, not to the Symbol: two gain stages on one
// sheet are routinely A1 and A2. The Symbol therefore declares only the
// default text and where it sits, through the existing
// `formulaPresentation` contract, and each Instance overrides it through
// `signalFlowParameters.formula`. No new persisted field, no migration: the
// transfer-function blocks have carried per-Instance body text since they
// shipped, and this reuses that path exactly.
//
// The letter is centred on the triangle's centroid rather than its bounding
// box, which is what reads as centred in a tapering body, and it stays clear
// of the polarity marks near the left edge.
//
// Entries are spliced next to their sources, never re-sorted: catalog.json
// carries a curated order that the Library reads.
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
  console.error(`generate-lettered-amplifiers: ${message}`);
  process.exit(1);
}

const normalize = (text) => text.replace(/\r\n/gu, "\n").trimEnd() + "\n";
const hash = (text) => createHash("sha256").update(text).digest("hex");

/** Sources, each a triangle body with room for one character. */
const SOURCES = [
  {
    id: "opamp",
    letteredId: "opamp-lettered",
    name: "Operational Amplifier (lettered)",
  },
  {
    id: "voltage-amplifier",
    letteredId: "voltage-amplifier-lettered",
    name: "Voltage Amplifier (lettered)",
  },
];

const DEFAULT_LETTER = "A";
const FONT_SIZE = 16;

/**
 * Centroid of the triangle the body is drawn with. The path is the only
 * primitive whose data describes it, and its three vertices average to the
 * point a reader sees as the middle of a wedge — a bounding-box centre sits
 * too far towards the blunt end.
 */
function triangleCentroid(symbol) {
  const path = symbol.primitives.find((primitive) => primitive.kind === "path");
  if (!path) fail(`${symbol.id} has no triangle path to centre on`);
  const numbers = path.data.match(/-?\d+(?:\.\d+)?/gu)?.map(Number) ?? [];
  if (numbers.length < 6)
    fail(`${symbol.id} triangle path is not three points`);
  const points = [
    { x: numbers[0], y: numbers[1] },
    { x: numbers[2], y: numbers[3] },
    { x: numbers[4], y: numbers[5] },
  ];
  const round = (value) => Math.round(value * 100) / 100;
  return {
    x: round(points.reduce((sum, point) => sum + point.x, 0) / 3),
    y: round(points.reduce((sum, point) => sum + point.y, 0) / 3),
  };
}

const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
const outputs = [];

for (const { id, letteredId, name } of SOURCES) {
  const sourceEntry = catalog.entries.find(
    (candidate) => candidate.symbolId === id,
  );
  if (!sourceEntry) fail(`missing catalog entry ${id}`);
  const source = JSON.parse(
    await readFile(resolve(assetRoot, sourceEntry.assetPath), "utf8"),
  );

  const lettered = {
    ...source,
    id: letteredId,
    name,
    formulaPresentation: {
      defaultFormula: DEFAULT_LETTER,
      // A gain mark names the stage; it is not scaled by a coefficient.
      supportsCoefficient: false,
      center: triangleCentroid(source),
      fontSize: FONT_SIZE,
    },
  };
  const letteredSource = normalize(
    await format(JSON.stringify(lettered, null, 2), { parser: "json" }),
  );
  const assetPath = `${letteredId}.symbol.json`;
  outputs.push([resolve(assetRoot, assetPath), letteredSource]);

  const entry = {
    ...sourceEntry,
    symbolId: letteredId,
    name,
    // A distinct drawing convention, not a state of its source: an author
    // chooses the lettered body up front, so it belongs in the Library.
    palette: true,
    assetPath,
    assetHash: hash(letteredSource),
    generation: {
      kind: "derived-lettered-body",
      sourceSymbolId: id,
      converterPath: "scripts/generate-lettered-amplifiers.mjs",
      converterVersion: 1,
    },
  };
  const existingIndex = catalog.entries.findIndex(
    (candidate) => candidate.symbolId === letteredId,
  );
  if (existingIndex >= 0) catalog.entries[existingIndex] = entry;
  else {
    const sourceIndex = catalog.entries.indexOf(sourceEntry);
    catalog.entries.splice(sourceIndex + 1, 0, entry);
  }
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
  `${check ? "Validated" : "Generated"} lettered amplifier bodies ` +
    `(${SOURCES.map((source) => source.letteredId).join(", ")})`,
);
