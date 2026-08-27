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

const directIds = ["and-gate", "inverter", "nand-gate", "nor-gate", "xor-gate"];
const familyIds = [
  "and-gate",
  "inverter",
  "nand-gate",
  "nor-gate",
  "or-gate",
  "xnor-gate",
  "xor-gate",
];

function fail(message) {
  throw new Error(`Razavi logic-gate generation: ${message}`);
}

function clone(value) {
  return structuredClone(value);
}

function evidencePath(symbolId) {
  return `logic-${symbolId}-vector-source.json`;
}

function witnessPath(symbolId) {
  return `logic-${symbolId}-reference.png`;
}

function directAuthorityPaths(symbolId) {
  return [
    `fixtures/visual-reference/razavi-reference-v1/${evidencePath(symbolId)}`,
    `fixtures/visual-reference/razavi-reference-v1/${witnessPath(symbolId)}`,
  ];
}

function makeOr(nor, norEvidence) {
  const result = clone(nor);
  result.id = "or-gate";
  result.name = "OR Gate";
  const bodyOutput = norEvidence.normalization.compositionAnchors.bodyOutput;
  result.primitives = result.primitives
    .filter((primitive) => primitive.part !== "negation-bubble")
    .map((primitive, index, primitives) => {
      if (index !== primitives.length - 1 || primitive.kind !== "line") {
        return primitive;
      }
      return { ...primitive, from: clone(bodyOutput) };
    });
  return result;
}

function makeXnor(xor, xorEvidence, nor, norEvidence) {
  const result = clone(xor);
  result.id = "xnor-gate";
  result.name = "XNOR Gate";
  const bodyOutput = xorEvidence.normalization.compositionAnchors.bodyOutput;
  const sourceBubble = nor.primitives.find(
    (primitive) => primitive.part === "negation-bubble",
  );
  const sourceOutput = nor.primitives.at(-1);
  if (!sourceBubble || sourceBubble.kind !== "circle") {
    fail("NOR evidence lacks the reviewed negation bubble");
  }
  if (!sourceOutput || sourceOutput.kind !== "line") {
    fail("NOR evidence lacks the reviewed output lead");
  }
  const norBodyOutput =
    norEvidence.normalization.compositionAnchors.bodyOutput.x;
  const sourceGap = sourceBubble.center.x - sourceBubble.radius - norBodyOutput;
  const bubble = clone(sourceBubble);
  bubble.center = {
    x: Number((bodyOutput.x + sourceGap + bubble.radius).toFixed(6)),
    y: bodyOutput.y,
  };
  const output = clone(result.primitives.at(-1));
  if (!output || output.kind !== "line") {
    fail("XOR evidence lacks the output lead");
  }
  output.from = {
    x: Number((bubble.center.x + bubble.radius).toFixed(6)),
    y: bodyOutput.y,
  };
  result.primitives = [...result.primitives.slice(0, -1), bubble, output];
  return result;
}

const { manifest, files } = await loadRazaviReferenceAuthority(referenceRoot);
const evidence = new Map();
for (const symbolId of directIds) {
  const authorityId = `razavi-textbook-logic-${symbolId}`;
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
  evidence.set(symbolId, parsed);
}

const definitions = new Map(
  directIds.map((symbolId) => [
    symbolId,
    clone(evidence.get(symbolId).normalization.symbolDefinition),
  ]),
);
definitions.set(
  "or-gate",
  makeOr(definitions.get("nor-gate"), evidence.get("nor-gate")),
);
definitions.set(
  "xnor-gate",
  makeXnor(
    definitions.get("xor-gate"),
    evidence.get("xor-gate"),
    definitions.get("nor-gate"),
    evidence.get("nor-gate"),
  ),
);

for (const definition of definitions.values()) {
  normalizeLogicPortLeads(definition);
}

const assetSources = new Map();
for (const symbolId of familyIds) {
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
  "Behavioral logic gate; structural SPICE realization requires an explicit subcircuit or PDK mapping.";
for (const symbolId of familyIds) {
  let entry = catalog.entries.find(
    (candidate) => candidate.symbolId === symbolId,
  );
  if (!entry) {
    entry = {
      symbolId,
      name: definitions.get(symbolId).name,
      category: "logic",
      reviewStatus: "reviewed",
      pinOrder: ["A", "B", "Y"],
      palette: true,
      automaticMappings: [],
      manualOnlyReason,
      assetPath: `${symbolId}.symbol.json`,
      assetHash: "",
      visualAuthority: {},
    };
    catalog.entries.push(entry);
  }
  entry.name = definitions.get(symbolId).name;
  entry.category = "logic";
  entry.reviewStatus = "reviewed";
  entry.pinOrder = definitions.get(symbolId).pins.map((pin) => pin.name);
  entry.palette = true;
  entry.automaticMappings = [];
  entry.manualOnlyReason = manualOnlyReason;
  entry.assetPath = `${symbolId}.symbol.json`;
  entry.assetHash = hash(assetSources.get(symbolId));

  const referenceIds =
    symbolId === "or-gate"
      ? ["nor-gate"]
      : symbolId === "xnor-gate"
        ? ["xor-gate", "nor-gate"]
        : [symbolId];
  entry.visualAuthority = {
    kind: "razavi-reference-v1",
    referenceManifestPath:
      "fixtures/visual-reference/razavi-reference-v1/manifest.json",
    referencePaths: referenceIds.flatMap(directAuthorityPaths),
    calibrationPath:
      "fixtures/visual-reference/razavi-reference-v1/logic-gate-geometry.json",
  };
  entry.generation = {
    kind: "razavi-pdf-vector-reference",
    referenceManifestPath:
      "fixtures/visual-reference/razavi-reference-v1/manifest.json",
    referencePath: `fixtures/visual-reference/razavi-reference-v1/${evidencePath(referenceIds[0])}`,
    converterPath: "scripts/generate-razavi-logic-gate-assets.mjs",
    converterVersion: 2,
  };
}
const catalogSource = normalize(
  await format(JSON.stringify(catalog, null, 2), { parser: "json" }),
);

if (check) {
  for (const symbolId of familyIds) {
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
  for (const symbolId of familyIds) {
    await writeFile(
      resolve(assetRoot, `${symbolId}.symbol.json`),
      assetSources.get(symbolId),
      "utf8",
    );
  }
  await writeFile(catalogPath, catalogSource, "utf8");
}

console.log(
  `${check ? "Validated" : "Generated"} PDF-derived Razavi logic-gate family`,
);
