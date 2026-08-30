import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { format } from "prettier";

import { loadRazaviReferenceAuthority } from "./lib/razavi-reference-authority.mjs";
import { normalizeLogicPortLeads } from "./lib/normalize-logic-port-leads.mjs";

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
const symbolIds = ["buffer", "d-flip-flop"];
/**
 * A D flip-flop whose complementary output is simply not brought out. Derived
 * from the reviewed `d-flip-flop` rather than drawn again, so the two bodies
 * cannot drift apart, and declared as a derivation: the textbook evidence
 * shows the four-pin part, so claiming PDF authority for this one would be a
 * lie about where it came from.
 *
 * Unlike the input-swapped siblings, this is a part in its own right and
 * belongs in the palette — a designer reaches for it when the inverted output
 * would only dangle.
 */
const Q_ONLY_ID = "d-flip-flop-q";

function fail(message) {
  throw new Error(`Razavi Buffer/DFF generation: ${message}`);
}

const { manifest, files } = await loadRazaviReferenceAuthority(referenceRoot);
const definitions = new Map();
for (const symbolId of symbolIds) {
  const authorityId = `razavi-textbook-${symbolId}`;
  const authority = manifest.vectorEvidence?.find(
    (candidate) => candidate.id === authorityId,
  );
  if (!authority || authority.kind !== "pdf-vector-extract") {
    fail(`missing manifest-pinned evidence ${authorityId}`);
  }
  const source = files.get(authority.extractPath);
  if (!source) fail(`authority did not load ${authority.extractPath}`);
  const parsed = JSON.parse(source.toString("utf8"));
  const definition = parsed.normalization?.symbolDefinition;
  if (
    parsed.schemaVersion !== 1 ||
    parsed.id !== authorityId ||
    parsed.source?.sha256 !== authority.source.sha256 ||
    definition?.id !== symbolId ||
    !Array.isArray(definition.pins) ||
    !definition.pins.every((pin) => pin.at.x % 10 === 0 && pin.at.y % 10 === 0)
  ) {
    fail(`evidence contract mismatch for ${symbolId}`);
  }
  definitions.set(symbolId, structuredClone(definition));
}

for (const definition of definitions.values()) {
  normalizeLogicPortLeads(definition);
}

const dff = definitions.get("d-flip-flop");
if (!dff) fail("missing normalized d-flip-flop definition");
// Pin names remain upright in world space while Symbol primitives rotate with
// the body. The PDF's Q-bar therefore belongs to the complementary pin label,
// not the rotating artwork. Remove only the evidence-tagged source stroke;
// renderVisiblePinNames recreates it from the output-complement role.
dff.primitives = dff.primitives.filter(
  (primitive) => primitive.part !== "pin-name-overbar",
);
// The source crop carries generous whitespace. Runtime selection and visual
// diagnostics fall back to viewBox for path-backed symbols, so retain only
// stroke-safe clearance around the +/-40 pins and +/-25 body.
dff.viewBox = { x: -42, y: -27, width: 84, height: 54 };

const qOnly = structuredClone(dff);
qOnly.id = Q_ONLY_ID;
qOnly.name = "D Flip-Flop (Q)";
const complement = dff.pins.find((pin) => pin.role === "output-complement");
if (!complement) fail("d-flip-flop lost its complementary output pin");
qOnly.pins = dff.pins.filter((pin) => pin !== complement);
// Drop the lead that ran to the pin that no longer exists. Matching on the
// endpoint keeps this correct if the body is ever re-extracted at different
// coordinates; matching on an index would not.
const touchesComplement = (primitive) =>
  primitive.kind === "line" &&
  [primitive.from, primitive.to].some(
    (point) => point.x === complement.at.x && point.y === complement.at.y,
  );
const leadCount = dff.primitives.filter(touchesComplement).length;
if (leadCount !== 1) {
  fail(`expected one complementary lead to remove, found ${leadCount}`);
}
qOnly.primitives = dff.primitives.filter(
  (primitive) => !touchesComplement(primitive),
);
// The body is unchanged, so the frame stays identical to its source: the two
// parts must read as the same block with one fewer wire, not as two drawings.
definitions.set(Q_ONLY_ID, qOnly);
const generatedIds = [...symbolIds, Q_ONLY_ID];

const assetSources = new Map();
for (const symbolId of generatedIds) {
  assetSources.set(
    symbolId,
    normalize(
      await format(JSON.stringify(definitions.get(symbolId), null, 2), {
        parser: "json",
      }),
    ),
  );
}

const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
const manualOnlyReason =
  "Behavioral logic symbol; structural SPICE realization requires an explicit subcircuit or PDK mapping.";
for (const symbolId of generatedIds) {
  const definition = definitions.get(symbolId);
  let entry = catalog.entries.find(
    (candidate) => candidate.symbolId === symbolId,
  );
  if (!entry) {
    entry = {
      symbolId,
      name: definition.name,
      category: "logic",
      reviewStatus: "reviewed",
      pinOrder: definition.pins.map((pin) => pin.name),
      palette: true,
      automaticMappings: [],
      manualOnlyReason,
      assetPath: `${symbolId}.symbol.json`,
      assetHash: "",
      visualAuthority: {},
    };
    // A derived sibling belongs beside the part it varies, the way the
    // input-swapped amplifiers sit beside theirs; appending would scatter the
    // pair across the catalog.
    const sourceIndex =
      symbolId === Q_ONLY_ID
        ? catalog.entries.findIndex(
            (candidate) => candidate.symbolId === "d-flip-flop",
          )
        : -1;
    if (sourceIndex >= 0) catalog.entries.splice(sourceIndex + 1, 0, entry);
    else catalog.entries.push(entry);
  }
  entry.name = definition.name;
  entry.category = "logic";
  entry.reviewStatus = "reviewed";
  entry.pinOrder = definition.pins.map((pin) => pin.name);
  entry.palette = true;
  entry.automaticMappings = [];
  entry.manualOnlyReason = manualOnlyReason;
  entry.assetPath = `${symbolId}.symbol.json`;
  entry.assetHash = hash(assetSources.get(symbolId));
  entry.visualAuthority = {
    kind: "razavi-reference-v1",
    referenceManifestPath:
      "fixtures/visual-reference/razavi-reference-v1/manifest.json",
    referencePaths: [
      `fixtures/visual-reference/razavi-reference-v1/${symbolId}-vector-source.json`,
      `fixtures/visual-reference/razavi-reference-v1/${symbolId}-reference.png`,
    ],
    calibrationPath:
      "fixtures/visual-reference/razavi-reference-v1/buffer-dff-geometry.json",
  };
  entry.generation = {
    kind: "razavi-pdf-vector-reference",
    referenceManifestPath:
      "fixtures/visual-reference/razavi-reference-v1/manifest.json",
    referencePath: `fixtures/visual-reference/razavi-reference-v1/${symbolId}-vector-source.json`,
    converterPath: "scripts/generate-razavi-buffer-dff-assets.mjs",
    converterVersion: symbolId === "d-flip-flop" ? 3 : 2,
  };
  if (symbolId === Q_ONLY_ID) {
    // The body is the reviewed flip-flop's, so it inherits that figure's
    // authority — the same convention the input-swapped siblings follow. What
    // is not inherited is the claim to have been extracted: `generation` says
    // this one was derived, and from what.
    entry.visualAuthority = {
      ...entry.visualAuthority,
      referencePaths: [
        "fixtures/visual-reference/razavi-reference-v1/d-flip-flop-vector-source.json",
        "fixtures/visual-reference/razavi-reference-v1/d-flip-flop-reference.png",
      ],
    };
    entry.generation = {
      kind: "derived-output-drop",
      sourceSymbolId: "d-flip-flop",
      converterPath: "scripts/generate-razavi-buffer-dff-assets.mjs",
      converterVersion: 1,
    };
  }
}
const catalogSource = normalize(
  await format(JSON.stringify(catalog, null, 2), { parser: "json" }),
);

if (check) {
  for (const symbolId of generatedIds) {
    const path = resolve(assetRoot, `${symbolId}.symbol.json`);
    if (
      normalize(await readFile(path, "utf8")) !== assetSources.get(symbolId)
    ) {
      fail(`${relative(root, path)} is stale`);
    }
  }
  if (normalize(await readFile(catalogPath, "utf8")) !== catalogSource) {
    fail(`${relative(root, catalogPath)} is stale`);
  }
} else {
  for (const symbolId of generatedIds) {
    await writeFile(
      resolve(assetRoot, `${symbolId}.symbol.json`),
      assetSources.get(symbolId),
      "utf8",
    );
  }
  await writeFile(catalogPath, catalogSource, "utf8");
}

console.log(
  `${check ? "Validated" : "Generated"} PDF-derived Razavi Buffer/DFF family`,
);
