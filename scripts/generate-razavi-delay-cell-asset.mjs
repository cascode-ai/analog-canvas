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
const assetPath = resolve(assetRoot, "delay-cell.symbol.json");
const catalogPath = resolve(assetRoot, "catalog.json");
const check = process.argv.includes("--check");
const normalize = (value) => `${value.replaceAll("\r\n", "\n").trimEnd()}\n`;
const hash = (value) => createHash("sha256").update(value).digest("hex");

function fail(message) {
  throw new Error(`Razavi Delay Cell generation: ${message}`);
}

const { manifest, files } = await loadRazaviReferenceAuthority(referenceRoot);
const authority = manifest.vectorEvidence?.find(
  (candidate) => candidate.id === "razavi-textbook-delay-cell",
);
if (!authority || authority.kind !== "pdf-vector-extract") {
  fail("missing manifest-pinned evidence razavi-textbook-delay-cell");
}
const source = files.get(authority.extractPath);
if (!source) fail(`authority did not load ${authority.extractPath}`);
const parsed = JSON.parse(source.toString("utf8"));
const sourceDefinition = parsed.normalization?.symbolDefinition;
if (
  parsed.schemaVersion !== 1 ||
  parsed.id !== authority.id ||
  parsed.source?.sha256 !== authority.source.sha256 ||
  sourceDefinition?.id !== "delay-cell" ||
  !Array.isArray(sourceDefinition.pins) ||
  !sourceDefinition.pins.every(
    (pin) => pin.at.x % 10 === 0 && pin.at.y % 10 === 0,
  )
) {
  fail("evidence contract mismatch");
}
const definition = normalizeLogicPortLeads(structuredClone(sourceDefinition));

const assetSource = normalize(
  await format(JSON.stringify(definition, null, 2), { parser: "json" }),
);
const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
let entry = catalog.entries.find(
  (candidate) => candidate.symbolId === "delay-cell",
);
if (!entry) {
  entry = { symbolId: "delay-cell" };
  const dffIndex = catalog.entries.findIndex(
    (candidate) => candidate.symbolId === "d-flip-flop",
  );
  catalog.entries.splice(dffIndex + 1, 0, entry);
}
Object.assign(entry, {
  name: definition.name,
  category: "logic",
  reviewStatus: "reviewed",
  pinOrder: definition.pins.map((pin) => pin.name),
  palette: true,
  automaticMappings: [],
  manualOnlyReason:
    "Visual delay-stage block; timing and structural netlist semantics require an explicit implementation mapping.",
  assetPath: "delay-cell.symbol.json",
  assetHash: hash(assetSource),
  visualAuthority: {
    kind: "razavi-reference-v1",
    referenceManifestPath:
      "fixtures/visual-reference/razavi-reference-v1/manifest.json",
    referencePaths: [
      "fixtures/visual-reference/razavi-reference-v1/delay-cell-vector-source.json",
      "fixtures/visual-reference/razavi-reference-v1/delay-cell-reference.png",
    ],
    calibrationPath:
      "fixtures/visual-reference/razavi-reference-v1/delay-cell-geometry.json",
  },
  generation: {
    kind: "razavi-pdf-vector-reference",
    referenceManifestPath:
      "fixtures/visual-reference/razavi-reference-v1/manifest.json",
    referencePath:
      "fixtures/visual-reference/razavi-reference-v1/delay-cell-vector-source.json",
    converterPath: "scripts/generate-razavi-delay-cell-asset.mjs",
    converterVersion: 2,
  },
});
const catalogSource = normalize(
  await format(JSON.stringify(catalog, null, 2), { parser: "json" }),
);

if (check) {
  if (normalize(await readFile(assetPath, "utf8")) !== assetSource) {
    fail(`${relative(root, assetPath)} is stale`);
  }
  if (normalize(await readFile(catalogPath, "utf8")) !== catalogSource) {
    fail(`${relative(root, catalogPath)} is stale`);
  }
} else {
  await writeFile(assetPath, assetSource, "utf8");
  await writeFile(catalogPath, catalogSource, "utf8");
}

console.log(
  `${check ? "Validated" : "Generated"} PDF-derived Razavi Delay Cell`,
);
