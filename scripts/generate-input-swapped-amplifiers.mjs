import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { format } from "prettier";

/**
 * Derive the input-swapped sibling of every polarity-marked amplifier.
 *
 * "Swap + / −" used to reflect the whole Instance top to bottom. That reads as
 * a swap only on a body with nothing else to say: it turns a comparator's
 * transfer-characteristic glyph upside down, exchanges a differential amp's
 * outputs along with its inputs, and flips the reference designator with the
 * artwork. What the action means is narrower — the two polarity marks trade
 * places and the input pins follow them — so it is a Symbol exchange, the same
 * shape `opamp-differential-crossed` already gives the output swap.
 *
 * Siblings are derived from the reviewed assets rather than drawn again, so
 * they cannot drift from the bodies they mirror. Each one keeps its source's
 * pin names, so exchanging Symbols leaves every attached Net intact, and is
 * kept out of the palette: it is a state of its source, not a part to browse.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assetRoot = resolve(root, "packages/symbols/assets/razavi-v1");
const catalogPath = resolve(assetRoot, "catalog.json");
const check = process.argv.includes("--check");
const normalize = (value) => `${value.replaceAll("\r\n", "\n").trimEnd()}\n`;
const hash = (value) => createHash("sha256").update(value).digest("hex");

/** Sources, in catalog order. Each must carry a marked differential pair. */
const SOURCE_IDS = [
  "opamp",
  "opamp-lettered",
  "comparator",
  "opamp-differential",
  "opamp-differential-crossed",
];
const SWAPPED_SUFFIX = "-inputs-swapped";
const INPUT_ROLES = new Set(["non-inverting-input", "inverting-input"]);
/** Polarity marks are the only short strokes drawn clear of the input leads. */
const MARK_MAX_LENGTH = 8;
const MARK_MIN_HEIGHT = 11;

function fail(message) {
  throw new Error(`Input-swapped amplifier generation: ${message}`);
}

const midpoint = (primitive) => ({
  x: (primitive.from.x + primitive.to.x) / 2,
  y: (primitive.from.y + primitive.to.y) / 2,
});

/**
 * A polarity mark on the input side: a short stroke, clear of the leads at
 * ±10, on the input half of the body. The output marks of a differential amp
 * match the first two tests and are excluded by the third — swapping inputs
 * must leave the outputs exactly where they are.
 */
function isInputMark(primitive, centerX) {
  if (primitive.part === "input-polarity") return true;
  if (primitive.part !== undefined) return false;
  if (primitive.kind !== "line") return false;
  const length = Math.hypot(
    primitive.to.x - primitive.from.x,
    primitive.to.y - primitive.from.y,
  );
  const centre = midpoint(primitive);
  return (
    length <= MARK_MAX_LENGTH &&
    Math.abs(centre.y) >= MARK_MIN_HEIGHT &&
    centre.x < centerX
  );
}

const acrossAxis = (primitive) => ({
  ...primitive,
  from: { ...primitive.from, y: -primitive.from.y },
  to: { ...primitive.to, y: -primitive.to.y },
});

function swapInputs(source) {
  const centerX = source.viewBox.x + source.viewBox.width / 2;
  const marks = source.primitives.filter((primitive) =>
    isInputMark(primitive, centerX),
  );
  // A plus and a minus: two strokes and one, in either order. Anything else
  // means the artwork changed shape and the rule above no longer finds it.
  if (marks.length !== 3) {
    fail(`${source.id} has ${marks.length} input polarity strokes, expected 3`);
  }
  const inputPins = source.pins.filter((pin) => INPUT_ROLES.has(pin.role));
  if (inputPins.length !== 2) {
    fail(`${source.id} has ${inputPins.length} input pins, expected 2`);
  }
  if (inputPins[0].at.y !== -inputPins[1].at.y) {
    fail(`${source.id} input pins are not a mirrored pair`);
  }
  return {
    ...source,
    id: `${source.id}${SWAPPED_SUFFIX}`,
    name: `${source.name} (swapped inputs)`,
    pins: source.pins.map((pin) =>
      INPUT_ROLES.has(pin.role)
        ? { ...pin, at: { ...pin.at, y: -pin.at.y } }
        : pin,
    ),
    primitives: source.primitives.map((primitive) =>
      isInputMark(primitive, centerX) ? acrossAxis(primitive) : primitive,
    ),
  };
}

const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
const outputs = [];
for (const sourceId of SOURCE_IDS) {
  const sourceEntry = catalog.entries.find(
    (candidate) => candidate.symbolId === sourceId,
  );
  if (!sourceEntry) fail(`missing catalog entry ${sourceId}`);
  const assetPath = resolve(assetRoot, sourceEntry.assetPath);
  const source = JSON.parse(await readFile(assetPath, "utf8"));
  const swapped = swapInputs(source);
  const swappedSource = normalize(
    await format(JSON.stringify(swapped, null, 2), { parser: "json" }),
  );
  const swappedAssetPath = `${sourceId}${SWAPPED_SUFFIX}.symbol.json`;
  outputs.push([resolve(assetRoot, swappedAssetPath), swappedSource]);

  const entry = {
    ...sourceEntry,
    symbolId: swapped.id,
    name: swapped.name,
    // A swap target, not a part to browse: it would sit in the Library as a
    // near-duplicate of the body it was derived from.
    palette: false,
    assetPath: swappedAssetPath,
    assetHash: hash(swappedSource),
    generation: {
      kind: "derived-input-swap",
      sourceSymbolId: sourceId,
      converterPath: "scripts/generate-input-swapped-amplifiers.mjs",
      converterVersion: 1,
    },
  };
  const existingIndex = catalog.entries.findIndex(
    (candidate) => candidate.symbolId === swapped.id,
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
    if (normalize(await readFile(path, "utf8")) !== source) {
      fail(`${relative(root, path)} is stale`);
    }
  }
} else {
  for (const [path, source] of outputs) {
    await writeFile(path, source, "utf8");
  }
}

console.log(
  `${check ? "Validated" : "Generated"} ${SOURCE_IDS.length}` +
    " input-swapped amplifier siblings",
);
