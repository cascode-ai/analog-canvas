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
const assetRoot = resolve(root, "packages/components/definitions");
const catalogPath = resolve(assetRoot, "../catalog.json");
const check = process.argv.includes("--check");
const normalize = (value) => `${value.replaceAll("\r\n", "\n").trimEnd()}\n`;
const hash = (value) => createHash("sha256").update(value).digest("hex");

function fail(message) {
  throw new Error(`Razavi magnetic-component generation: ${message}`);
}

function rounded(value) {
  const result = Number(Number(value).toFixed(4));
  return Object.is(result, -0) ? 0 : result;
}

function point(value) {
  return { x: value.x, y: value.y };
}

function transformPoint(point, center, rotation) {
  if (rotation !== 90) fail(`unsupported rotation ${rotation}`);
  return {
    x: rounded(center.x + point.y),
    y: rounded(center.y - point.x),
  };
}

function transformPath(data, center, rotation = 90) {
  return data.replace(
    /(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/gu,
    (_pair, rawX, rawY) => {
      const point = transformPoint(
        { x: Number(rawX), y: Number(rawY) },
        center,
        rotation,
      );
      return `${point.x} ${point.y}`;
    },
  );
}

function transformPrimitive(primitive, center, rotation = 90, part) {
  const transformed = structuredClone(primitive);
  transformed.part = part;
  if (transformed.kind === "path") {
    transformed.data = transformPath(transformed.data, center, rotation);
  } else if (transformed.kind === "line") {
    transformed.from = transformPoint(transformed.from, center, rotation);
    transformed.to = transformPoint(transformed.to, center, rotation);
  } else {
    fail(`cannot compose primitive kind ${transformed.kind}`);
  }
  return transformed;
}

function line(from, to, part) {
  return {
    kind: "line",
    from: { x: rounded(from.x), y: rounded(from.y) },
    to: { x: rounded(to.x), y: rounded(to.y) },
    part,
    style: { strokeRole: "normal", lineCap: "butt", lineJoin: "miter" },
  };
}

function polyline(points, part) {
  return {
    kind: "polyline",
    points,
    part,
    style: { strokeRole: "normal", lineCap: "butt", lineJoin: "miter" },
  };
}

function dot({ x, y, radius }, part) {
  return {
    kind: "circle",
    center: { x, y },
    radius,
    fill: "foreground",
    stroke: "none",
    part,
  };
}

function pin(name, at, direction) {
  return {
    name,
    role: "passive",
    at: { x: at.x, y: at.y },
    direction,
    presentation: { visibility: "visible", leadLength: 10 },
  };
}

const { manifest, files } = await loadRazaviReferenceAuthority(referenceRoot);
const evidenceFor = (id) => {
  const authority = manifest.vectorEvidence?.find(
    (candidate) => candidate.id === id,
  );
  if (!authority || authority.kind !== "pdf-vector-extract") {
    fail(`missing manifest-pinned evidence ${id}`);
  }
  const source = files.get(authority.extractPath);
  if (!source) fail(`authority did not load ${authority.extractPath}`);
  const evidence = JSON.parse(source.toString("utf8"));
  if (
    evidence.id !== authority.id ||
    evidence.kind !== authority.kind ||
    evidence.normalization?.endpointMarkers !== "none"
  ) {
    fail(`evidence contract mismatch ${id}`);
  }
  return { authority, evidence };
};

const xfmrEvidence = evidenceFor("razavi-ojsscs-figure-19-xfmr");
const tcoilEvidence = evidenceFor("razavi-bridged-tcoil-figure-2");
const inductor = JSON.parse(
  await readComponentProjection(
    resolve(assetRoot, "inductor-compact.json"),
    "utf8",
  ),
);
const capacitor = JSON.parse(
  await readComponentProjection(resolve(assetRoot, "capacitor.json")),
);
const inductorPath = inductor.primitives.find(
  (primitive) => primitive.kind === "path",
);
if (!inductorPath) fail("reviewed compact Inductor has no path");

const xfmrLayout = xfmrEvidence.evidence.normalization;
const xfmrCenters = xfmrLayout.productCoilCentersLogical;
const xfmrPins = xfmrLayout.productPinAnchorsLogical;
const xfmr = {
  schemaVersion: 1,
  id: "xfmr",
  name: "XFMR",
  viewBox: { x: -34, y: -24, width: 68, height: 48 },
  pins: [
    pin("P-", xfmrPins[0], "west"),
    pin("P+", xfmrPins[1], "east"),
    pin("S-", xfmrPins[2], "west"),
    pin("S+", xfmrPins[3], "east"),
  ],
  primitives: [
    line(
      point(xfmrPins[0]),
      { x: -19.5, y: xfmrCenters[0].y },
      "primary-left-lead",
    ),
    transformPrimitive(inductorPath, xfmrCenters[0], 90, "primary-winding"),
    line(
      { x: 19.5, y: xfmrCenters[0].y },
      point(xfmrPins[1]),
      "primary-right-lead",
    ),
    line(
      point(xfmrPins[2]),
      { x: -19.5, y: xfmrCenters[1].y },
      "secondary-left-lead",
    ),
    transformPrimitive(inductorPath, xfmrCenters[1], 90, "secondary-winding"),
    line(
      { x: 19.5, y: xfmrCenters[1].y },
      point(xfmrPins[3]),
      "secondary-right-lead",
    ),
    ...xfmrLayout.productPolarityDotsLogical.map((value, index) =>
      dot(value, index === 0 ? "primary-polarity" : "secondary-polarity"),
    ),
  ],
  variants: [],
};

const tcoilLayout = tcoilEvidence.evidence.normalization;
const tcoilCenters = tcoilLayout.productCoilCentersLogical;
const tcoilPins = tcoilLayout.productPinAnchorsLogical;
const [tcoilLeftBranchX, tcoilRightBranchX] =
  tcoilLayout.productBridgeBranchXsLogical;
const tcoilBridgeY = tcoilLayout.productCapacitorCenterLogical.y;
const transformedCapacitor = capacitor.primitives.map((primitive, index) =>
  transformPrimitive(
    primitive,
    tcoilLayout.productCapacitorCenterLogical,
    90,
    `bridge-capacitor-${index + 1}`,
  ),
);
const tcoil = {
  schemaVersion: 1,
  id: "tcoil",
  name: "T-Coil",
  viewBox: { x: -104, y: -56, width: 208, height: 90 },
  pins: [
    pin("1", tcoilPins[0], "west"),
    pin("2", tcoilPins[1], "east"),
    pin("3", tcoilPins[2], "south"),
  ],
  primitives: [
    line(
      point(tcoilPins[0]),
      { x: tcoilCenters[0].x - 19.5, y: 0 },
      "terminal-1-lead",
    ),
    transformPrimitive(inductorPath, tcoilCenters[0], 90, "winding-1"),
    line(
      { x: tcoilCenters[0].x + 19.5, y: 0 },
      { x: tcoilCenters[1].x - 19.5, y: 0 },
      "winding-center-link",
    ),
    transformPrimitive(inductorPath, tcoilCenters[1], 90, "winding-2"),
    line(
      { x: tcoilCenters[1].x + 19.5, y: 0 },
      point(tcoilPins[1]),
      "terminal-2-lead",
    ),
    line({ x: 0, y: -0.5 }, point(tcoilPins[2]), "terminal-3-lead"),
    polyline(
      [
        { x: tcoilLeftBranchX, y: 0 },
        { x: tcoilLeftBranchX, y: tcoilBridgeY },
        {
          x: tcoilLayout.productCapacitorCenterLogical.x - 19.5,
          y: tcoilBridgeY,
        },
      ],
      "bridge-left-route",
    ),
    ...transformedCapacitor,
    polyline(
      [
        {
          x: tcoilLayout.productCapacitorCenterLogical.x + 19.5,
          y: tcoilBridgeY,
        },
        { x: tcoilRightBranchX, y: tcoilBridgeY },
        { x: tcoilRightBranchX, y: 0 },
      ],
      "bridge-right-route",
    ),
    ...tcoilLayout.productPolarityDotsLogical.map((value, index) =>
      dot(value, `winding-${index + 1}-polarity`),
    ),
    ...tcoilLayout.productJunctionDotsLogical.map((value, index) =>
      dot(value, `internal-junction-${index + 1}`),
    ),
  ],
  variants: [],
};

// A plain centre-tapped inductor (#1513): the T-coil figure's windings and
// tap, closer together, without its bridge capacitor or polarity dots. The
// reference draws a centre tap only inside that bridged T-coil.
const centerTapCenters = [
  { x: -25, y: 0 },
  { x: 25, y: 0 },
];
const centerTap = {
  schemaVersion: 1,
  id: "center-tap-inductor",
  name: "Center-Tap Inductor",
  viewBox: { x: -64, y: -16, width: 128, height: 40 },
  pins: [
    pin("1", { x: -60, y: 0 }, "west"),
    pin("2", { x: 60, y: 0 }, "east"),
    pin("3", { x: 0, y: 20 }, "south"),
  ],
  primitives: [
    line(
      { x: -60, y: 0 },
      { x: centerTapCenters[0].x - 19.5, y: 0 },
      "terminal-1-lead",
    ),
    transformPrimitive(inductorPath, centerTapCenters[0], 90, "winding-1"),
    line(
      { x: centerTapCenters[0].x + 19.5, y: 0 },
      { x: centerTapCenters[1].x - 19.5, y: 0 },
      "winding-center-link",
    ),
    transformPrimitive(inductorPath, centerTapCenters[1], 90, "winding-2"),
    line(
      { x: centerTapCenters[1].x + 19.5, y: 0 },
      { x: 60, y: 0 },
      "terminal-2-lead",
    ),
    line({ x: 0, y: -0.5 }, { x: 0, y: 20 }, "terminal-3-lead"),
    dot(tcoilLayout.productJunctionDotsLogical[1], "center-tap-junction"),
  ],
  variants: [],
};

const outputSources = new Map();
for (const symbol of [tcoil, xfmr, centerTap]) {
  outputSources.set(
    symbol.id,
    normalize(
      await format(JSON.stringify(symbol, null, 2), { parser: "json" }),
    ),
  );
}

const catalog = JSON.parse(await readComponentProjection(catalogPath));
const entryTemplate = (symbol, evidence, manualOnlyReason) => ({
  symbolId: symbol.id,
  name: symbol.name,
  category: "passive",
  reviewStatus: "reviewed",
  pinOrder: symbol.pins.map((candidate) => candidate.name),
  palette: true,
  automaticMappings: [],
  manualOnlyReason,
  assetPath: `${symbol.id}.json`,
  assetHash: hash(outputSources.get(symbol.id)),
  visualAuthority: {
    kind: "razavi-reference-v1",
    referenceManifestPath:
      "fixtures/visual-reference/razavi-reference-v1/manifest.json",
    referencePaths: [
      `fixtures/visual-reference/razavi-reference-v1/${evidence.authority.extractPath}`,
      `fixtures/visual-reference/razavi-reference-v1/${evidence.authority.rasterPath}`,
    ],
  },
  generation: {
    kind: "razavi-pdf-vector-reference",
    referenceManifestPath:
      "fixtures/visual-reference/razavi-reference-v1/manifest.json",
    referencePath: `fixtures/visual-reference/razavi-reference-v1/${evidence.authority.extractPath}`,
    converterPath: "scripts/generate-razavi-magnetic-components.mjs",
    converterVersion: 1,
  },
});

const expectedEntries = [
  entryTemplate(
    tcoil,
    tcoilEvidence,
    "A bridged T-coil is a composite L1/L2/K/CB network that SPICE import does not recognize, so it is placed by hand; netlist export writes it as the built-in tcoil subcircuit.",
  ),
  entryTemplate(
    xfmr,
    xfmrEvidence,
    "A transformer is two inductors plus mutual coupling that SPICE import does not recognize, so it is placed by hand; netlist export writes it as the built-in xfmr subcircuit.",
  ),
  {
    symbolId: centerTap.id,
    name: centerTap.name,
    category: "passive",
    reviewStatus: "reviewed",
    provenance: "house",
    houseReason:
      "The reference draws a centre-tapped winding only inside its bridged T-coil. Drawn here as that figure's two windings and tap, without the bridge capacitor or polarity dots.",
    pinOrder: centerTap.pins.map((candidate) => candidate.name),
    palette: true,
    automaticMappings: [],
    manualOnlyReason:
      "A centre-tapped inductor is two series windings meeting at the tap, which SPICE import does not recognize as one part, so it is placed by hand; netlist export writes it as the built-in ct_inductor subcircuit.",
    assetPath: `${centerTap.id}.json`,
    assetHash: hash(outputSources.get(centerTap.id)),
  },
];
for (const expected of expectedEntries) {
  const existingIndex = catalog.entries.findIndex(
    (candidate) => candidate.symbolId === expected.symbolId,
  );
  if (existingIndex >= 0) catalog.entries.splice(existingIndex, 1);
}
const insertionIndex =
  catalog.entries.findIndex(
    (candidate) => candidate.symbolId === "inductor-compact",
  ) + 1;
if (insertionIndex === 0)
  fail("catalog lacks inductor-compact insertion anchor");
catalog.entries.splice(insertionIndex, 0, ...expectedEntries);
const catalogSource = normalize(
  await format(JSON.stringify(catalog, null, 2), { parser: "json" }),
);

const filesToWrite = [
  ...[tcoil, xfmr, centerTap].map((symbol) => [
    resolve(assetRoot, `${symbol.id}.json`),
    outputSources.get(symbol.id),
  ]),
  [catalogPath, catalogSource],
];
if (check) {
  for (const [path, source] of filesToWrite) {
    if (normalize(await readComponentProjection(path)) !== source) {
      fail(`${relative(root, path)} is stale`);
    }
  }
} else {
  for (const [path, source] of filesToWrite) {
    await writeComponentProjection(path, source);
  }
}

console.log(
  `${check ? "Validated" : "Generated"} Razavi XFMR, bridged T-coil and centre-tap inductor assets`,
);
