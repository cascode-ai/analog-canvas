import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { format } from "prettier";

import { loadRazaviReferenceAuthority } from "./lib/razavi-reference-authority.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const referenceRoot = resolve(
  root,
  "fixtures/visual-reference/razavi-reference-v1",
);
const assetRoot = resolve(root, "packages/symbols/assets/razavi-v1");
const catalogPath = resolve(assetRoot, "catalog.json");
const assetPath = resolve(assetRoot, "zener-diode.symbol.json");
const check = process.argv.includes("--check");
const normalize = (value) => `${value.replaceAll("\r\n", "\n").trimEnd()}\n`;
const hash = (value) => createHash("sha256").update(value).digest("hex");

function fail(message) {
  throw new Error(`Razavi Zener asset generation: ${message}`);
}

const { manifest, files } = await loadRazaviReferenceAuthority(referenceRoot);
const authority = manifest.vectorEvidence?.find(
  (candidate) => candidate.id === "razavi-textbook-zener-diode",
);
if (!authority || authority.kind !== "pdf-vector-extract") {
  fail("missing authority razavi-textbook-zener-diode");
}
const evidenceSource = files.get(authority.extractPath);
if (!evidenceSource) fail("missing loaded Zener vector evidence");
const evidence = JSON.parse(evidenceSource.toString("utf8"));
const symbol = evidence.normalization?.symbolDefinition;
if (
  evidence.id !== authority.id ||
  symbol?.id !== "zener-diode" ||
  symbol.pins?.map((pin) => pin.name).join("\0") !== "A\0K"
) {
  fail("evidence contract mismatch");
}

const assetSource = normalize(
  await format(JSON.stringify(symbol, null, 2), { parser: "json" }),
);
const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
const nextEntry = {
  symbolId: "zener-diode",
  name: "Zener Diode",
  category: "passive",
  reviewStatus: "reviewed",
  pinOrder: ["A", "K"],
  palette: true,
  automaticMappings: [],
  manualOnlyReason:
    "SPICE D syntax does not distinguish a Zener presentation from an ordinary diode; select this reviewed symbol manually or through an explicit PDK mapping.",
  assetPath: "zener-diode.symbol.json",
  assetHash: hash(assetSource),
  visualAuthority: {
    kind: "razavi-reference-v1",
    referenceManifestPath:
      "fixtures/visual-reference/razavi-reference-v1/manifest.json",
    referencePaths: [
      "fixtures/visual-reference/razavi-reference-v1/zener-diode-vector-source.json",
      "fixtures/visual-reference/razavi-reference-v1/zener-diode-reference.png",
    ],
    calibrationPath:
      "fixtures/visual-reference/razavi-reference-v1/zener-diode-geometry.json",
  },
  generation: {
    kind: "razavi-pdf-vector-reference",
    referenceManifestPath:
      "fixtures/visual-reference/razavi-reference-v1/manifest.json",
    referencePath:
      "fixtures/visual-reference/razavi-reference-v1/zener-diode-vector-source.json",
    converterPath: "scripts/generate-razavi-zener-asset.mjs",
    converterVersion: 1,
  },
};
const entry = catalog.entries.find(
  (candidate) => candidate.symbolId === "zener-diode",
);
if (entry) Object.assign(entry, nextEntry);
else catalog.entries.push(nextEntry);
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
  `${check ? "Validated" : "Generated"} PDF-derived Razavi Zener diode`,
);
