import {
  readComponentProjection,
  writeComponentProjection,
} from "./lib/component-library.mjs";
import { createHash } from "node:crypto";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { format } from "prettier";
import { loadRazaviReferenceAuthority } from "./lib/razavi-reference-authority.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const referenceRoot = resolve(
  root,
  "fixtures/visual-reference/razavi-reference-v1",
);
const assetPath = resolve(root, "packages/components/definitions/battery.json");
const catalogPath = resolve(root, "packages/components/catalog.json");
const check = process.argv.includes("--check");
const normalize = (value) => `${value.replaceAll("\r\n", "\n").trimEnd()}\n`;
const hash = (value) => createHash("sha256").update(value).digest("hex");

function fail(message) {
  throw new Error(`Razavi battery asset generation: ${message}`);
}

const { manifest, files } = await loadRazaviReferenceAuthority(referenceRoot);
const authority = manifest.vectorEvidence?.find(
  (candidate) => candidate.id === "razavi-textbook-battery",
);
if (!authority || authority.kind !== "pdf-vector-extract") {
  fail("missing Figure 3.11(a) battery authority");
}
const evidenceSource = files.get(authority.extractPath);
if (!evidenceSource) fail("missing loaded battery vector evidence");
const evidence = JSON.parse(evidenceSource.toString("utf8"));
const symbol = evidence.normalization?.symbolDefinition;
if (
  evidence.id !== authority.id ||
  evidence.source?.figure !== "3.11(a)" ||
  symbol?.id !== "battery" ||
  symbol.pins?.map((pin) => pin.name).join("\0") !== "+\0-" ||
  evidence.derivation?.model !==
    "drawing-only; no default electrical or netlist binding"
) {
  fail("battery evidence or symbol contract mismatch");
}

const symbolSource = normalize(
  await format(JSON.stringify(symbol, null, 2), { parser: "json" }),
);
const catalog = JSON.parse(await readComponentProjection(catalogPath));
const nextEntry = {
  symbolId: "battery",
  name: "Battery",
  category: "source",
  reviewStatus: "reviewed",
  pinOrder: ["+", "-"],
  palette: true,
  automaticMappings: [],
  manualOnlyReason:
    "The Razavi battery plate symbol records visual supply intent only; no voltage-source or physical-battery netlist model is inferred.",
  assetPath: "battery.json",
  assetHash: hash(symbolSource),
  visualAuthority: {
    kind: "razavi-reference-v1",
    referenceManifestPath:
      "fixtures/visual-reference/razavi-reference-v1/manifest.json",
    referencePaths: [
      "fixtures/visual-reference/razavi-reference-v1/battery-vector-source.json",
      "fixtures/visual-reference/razavi-reference-v1/battery-reference.png",
    ],
    calibrationPath:
      "fixtures/visual-reference/razavi-reference-v1/battery-geometry.json",
  },
  generation: {
    kind: "razavi-pdf-vector-reference",
    referenceManifestPath:
      "fixtures/visual-reference/razavi-reference-v1/manifest.json",
    referencePath:
      "fixtures/visual-reference/razavi-reference-v1/battery-vector-source.json",
    converterPath: "scripts/generate-razavi-battery-asset.mjs",
    converterVersion: 1,
  },
};
const entry = catalog.entries.find(
  (candidate) => candidate.symbolId === "battery",
);
if (!entry) fail("author and index the complete Battery definition first");
Object.assign(entry, nextEntry);
const catalogSource = normalize(
  await format(JSON.stringify(catalog, null, 2), { parser: "json" }),
);

if (check) {
  if (normalize(await readComponentProjection(assetPath)) !== symbolSource) {
    fail(`${relative(root, assetPath)} is stale`);
  }
  if (normalize(await readComponentProjection(catalogPath)) !== catalogSource) {
    fail(`${relative(root, catalogPath)} is stale`);
  }
} else {
  await writeComponentProjection(assetPath, symbolSource);
  await writeComponentProjection(catalogPath, catalogSource);
}

console.log(`${check ? "Validated" : "Generated"} PDF-derived Razavi battery`);
