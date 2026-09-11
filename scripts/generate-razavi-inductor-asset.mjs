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
const assetPath = resolve(
  root,
  "packages/components/definitions/inductor.json",
);
const compactAssetPath = resolve(
  root,
  "packages/components/definitions/inductor-compact.json",
);
// The textbook figure is drawn at its own scale, so the calibrated Inductor is
// 1.5x the pin span every other reviewed passive uses. `inductor` keeps that
// evidence-exact geometry; `inductor-compact` is the same evidence reconciled
// to the shared passive pin span so a schematic mixing R, C, and L reads at
// one scale.
const PASSIVE_PIN_SPAN_LOGICAL = 40;
const catalogPath = resolve(root, "packages/components/catalog.json");
const check = process.argv.includes("--check");
const normalize = (value) => `${value.replaceAll("\r\n", "\n").trimEnd()}\n`;
const hash = (value) => createHash("sha256").update(value).digest("hex");

function fail(message) {
  throw new Error(`Razavi inductor generation: ${message}`);
}

const { manifest, files } = await loadRazaviReferenceAuthority(referenceRoot);
const authority = manifest.vectorEvidence?.find(
  (candidate) => candidate.id === "razavi-textbook-figure-15-21-inductor",
);
if (!authority || authority.kind !== "pdf-vector-extract") {
  fail("missing manifest-pinned PDF vector evidence");
}
const evidenceSource = files.get(authority.extractPath);
if (!evidenceSource) fail("vector evidence was not loaded by the authority");
const evidence = JSON.parse(evidenceSource.toString("utf8"));
if (
  evidence.schemaVersion !== 1 ||
  evidence.id !== authority.id ||
  evidence.kind !== authority.kind ||
  evidence.source.sha256 !== authority.source.sha256 ||
  evidence.source.pdfPage !== authority.source.pdfPage ||
  evidence.normalization.targetLineWidthLogical !== 1.6 ||
  evidence.normalization.pinAnchorsLogical?.length !== 2 ||
  typeof evidence.normalization.symbolPathData !== "string"
) {
  fail("vector evidence contract mismatch");
}

const anchors = evidence.normalization.pinAnchorsLogical;
const evidencePinSpan =
  Math.max(...anchors.map((anchor) => anchor.y)) -
  Math.min(...anchors.map((anchor) => anchor.y));
if (!(evidencePinSpan > 0)) fail("vector evidence has no pin span");
const compactScale = PASSIVE_PIN_SPAN_LOGICAL / evidencePinSpan;
const compactHalfSpan = PASSIVE_PIN_SPAN_LOGICAL / 2;

/** Scale every absolute coordinate of an M/L/C path, preserving its commands. */
function scalePathData(data, scale) {
  const commands = data.match(/[A-Za-z]/g) ?? [];
  if (commands.some((command) => !"MLC".includes(command))) {
    fail(`unsupported path command in vector evidence: ${commands.join("")}`);
  }
  return data.replace(/-?\d+(?:\.\d+)?/g, (value) =>
    String(Number((Number(value) * scale).toFixed(4))),
  );
}

const symbol = {
  schemaVersion: 1,
  id: "inductor",
  name: "Large Inductor",
  viewBox: { x: -15, y: -32, width: 30, height: 64 },
  pins: [
    {
      name: "1",
      role: "passive",
      at: { x: 0, y: -30 },
      direction: "north",
      presentation: { visibility: "visible", leadLength: 10 },
    },
    {
      name: "2",
      role: "passive",
      at: { x: 0, y: 30 },
      direction: "south",
      presentation: { visibility: "visible", leadLength: 10 },
    },
  ],
  primitives: [
    {
      kind: "path",
      data: evidence.normalization.symbolPathData,
      style: {
        strokeRole: "normal",
        lineCap: "butt",
        lineJoin: "round",
      },
    },
  ],
  variants: [],
};
const compactSymbol = {
  schemaVersion: 1,
  id: "inductor-compact",
  name: "Inductor",
  // Shares the reviewed passive frame so the palette tile and label clearance
  // match the Resistor and Capacitor exactly.
  viewBox: { x: -10, y: -24, width: 20, height: 48 },
  pins: symbol.pins.map((pin) => ({
    ...pin,
    at: { ...pin.at, y: Math.sign(pin.at.y) * compactHalfSpan },
  })),
  primitives: [
    {
      kind: "path",
      data: scalePathData(evidence.normalization.symbolPathData, compactScale),
      style: {
        strokeRole: "normal",
        lineCap: "butt",
        lineJoin: "round",
      },
    },
  ],
  variants: [],
};
const assetSource = normalize(
  await format(JSON.stringify(symbol, null, 2), { parser: "json" }),
);
const compactAssetSource = normalize(
  await format(JSON.stringify(compactSymbol, null, 2), { parser: "json" }),
);

const catalog = JSON.parse(await readComponentProjection(catalogPath));
const generation = {
  kind: "razavi-pdf-vector-reference",
  referenceManifestPath:
    "fixtures/visual-reference/razavi-reference-v1/manifest.json",
  referencePath:
    "fixtures/visual-reference/razavi-reference-v1/inductor-vector-source.json",
  converterPath: "scripts/generate-razavi-inductor-asset.mjs",
  converterVersion: 2,
};
for (const [id, source] of [
  [symbol.id, assetSource],
  [compactSymbol.id, compactAssetSource],
]) {
  const entry = catalog.entries.find((candidate) => candidate.symbolId === id);
  if (!entry) fail(`missing catalog entry ${id}`);
  entry.assetHash = hash(source);
  entry.generation =
    id === compactSymbol.id
      ? { ...generation, pinSpanScale: Number(compactScale.toFixed(6)) }
      : { ...generation };
}
const catalogSource = normalize(
  await format(JSON.stringify(catalog, null, 2), { parser: "json" }),
);

if (check) {
  for (const [path, source] of [
    [assetPath, assetSource],
    [compactAssetPath, compactAssetSource],
    [catalogPath, catalogSource],
  ]) {
    if (normalize(await readComponentProjection(path)) !== source) {
      fail(`${relative(root, path)} is stale`);
    }
  }
} else {
  await writeComponentProjection(assetPath, assetSource);
  await writeComponentProjection(compactAssetPath, compactAssetSource);
  await writeComponentProjection(catalogPath, catalogSource);
}

console.log(
  `${check ? "Validated" : "Generated"} PDF-derived Razavi inductor assets` +
    ` (compact pin-span scale ${compactScale.toFixed(4)})`,
);
