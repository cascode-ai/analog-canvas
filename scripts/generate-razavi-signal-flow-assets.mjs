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
const check = process.argv.includes("--check");

const normalize = (value) => `${value.replaceAll("\r\n", "\n").trimEnd()}\n`;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const asSource = async (definition) =>
  normalize(
    await format(JSON.stringify(definition, null, 2), { parser: "json" }),
  );

function fail(message) {
  throw new Error(`Razavi Signal Flow generation: ${message}`);
}

function lead(from, to, part) {
  return {
    kind: "line",
    from,
    to,
    part,
    style: { strokeRole: "normal", lineCap: "butt", lineJoin: "miter" },
  };
}

function bodyPath(left, top, right, bottom, shape = "rectangle") {
  const taper = (bottom - top) / 4;
  const data =
    shape === "right-tapered-trapezoid"
      ? `M ${left} ${top} L ${right} ${top + taper} L ${right} ${bottom - taper} L ${left} ${bottom} Z`
      : `M ${left} ${top} L ${right} ${top} L ${right} ${bottom} L ${left} ${bottom} Z`;
  return {
    kind: "path",
    part: "body",
    data,
    style: {
      strokeRole: "emphasis",
      lineCap: "butt",
      lineJoin: "miter",
      miterLimit: 4,
    },
  };
}

function horizontalPins(left, right) {
  return [
    {
      name: "A",
      role: "input",
      at: { x: left, y: 0 },
      direction: "west",
      presentation: { visibility: "visible", leadLength: 15 },
    },
    {
      name: "Y",
      role: "output",
      at: { x: right, y: 0 },
      direction: "east",
      presentation: { visibility: "visible", leadLength: 15 },
    },
  ];
}

function addSubtractPins() {
  return [
    {
      name: "A",
      role: "input",
      at: { x: -30, y: 0 },
      direction: "west",
      presentation: { visibility: "visible", leadLength: 15 },
    },
    {
      name: "B",
      role: "input",
      at: { x: 0, y: 30 },
      direction: "south",
      presentation: { visibility: "visible", leadLength: 15 },
    },
    {
      name: "Y",
      role: "output",
      at: { x: 30, y: 0 },
      direction: "east",
      presentation: { visibility: "visible", leadLength: 15 },
    },
  ];
}

function circleBlock(id, name, glyphPrimitives) {
  return {
    schemaVersion: 1,
    id,
    name,
    viewBox: { x: -34, y: -22, width: 68, height: 56 },
    pins: addSubtractPins(),
    primitives: [
      lead({ x: -30, y: 0 }, { x: -12, y: 0 }, "input-a-lead"),
      {
        kind: "circle",
        part: "body",
        center: { x: 0, y: 0 },
        radius: 12,
        fill: "none",
        stroke: "foreground",
        style: { strokeRole: "emphasis" },
      },
      lead({ x: 12, y: 0 }, { x: 30, y: 0 }, "output-y-lead"),
      lead({ x: 0, y: 12 }, { x: 0, y: 30 }, "input-b-lead"),
      ...glyphPrimitives,
    ],
    variants: [],
    labelVisibility: "hidden",
  };
}

const transferFunctionPresentation = (
  defaultFormula,
  {
    shape = "rectangle",
    minBodyWidth = 40,
    minBodyHeight = 30,
    horizontalPadding = 8,
  } = {},
) => ({
  defaultFormula,
  supportsCoefficient: true,
  center: { x: 0, y: 0 },
  fontSize: 12,
  adaptiveFrame: {
    ...(shape === "rectangle" ? {} : { shape }),
    minBodyWidth,
    minBodyHeight,
    horizontalPadding,
    verticalPadding: 4,
    leadLength: 20,
  },
});

function formulaBlock({
  id,
  name,
  viewBox,
  pinSpan,
  body,
  defaultFormula,
  shape = "rectangle",
  minBodyWidth = 40,
  minBodyHeight = 30,
  horizontalPadding = 8,
}) {
  return {
    schemaVersion: 1,
    id,
    name,
    viewBox,
    pins: horizontalPins(-pinSpan, pinSpan),
    primitives: [
      lead({ x: -pinSpan, y: 0 }, { x: body.left, y: 0 }, "input-a-lead"),
      bodyPath(body.left, body.top, body.right, body.bottom, shape),
      lead({ x: body.right, y: 0 }, { x: pinSpan, y: 0 }, "output-y-lead"),
    ],
    formulaPresentation: transferFunctionPresentation(defaultFormula, {
      shape,
      minBodyWidth,
      minBodyHeight,
      horizontalPadding,
    }),
    variants: [],
    labelVisibility: "hidden",
  };
}

function quantizerBlock() {
  return {
    schemaVersion: 1,
    id: "quantizer",
    name: "Quantizer",
    viewBox: { x: -44, y: -24, width: 88, height: 48 },
    pins: horizontalPins(-40, 40),
    primitives: [
      lead({ x: -40, y: 0 }, { x: -20, y: 0 }, "input-a-lead"),
      // Square, not the integrator's 40x26. The quantizer body carries a
      // transfer characteristic rather than a line of formula text, and a
      // plot needs comparable room on both axes; the width and pin span stay
      // family-standard so the leads and grid alignment are untouched.
      bodyPath(-20, -20, 20, 20),
      lead({ x: 20, y: 0 }, { x: 40, y: 0 }, "output-y-lead"),
      {
        kind: "polyline",
        part: "quantizer-staircase",
        // Four 7-wide treads and three 10-tall risers: the staircase already
        // spanned the body's full usable width, so squaring the body means
        // growing it vertically. It keeps ~5-6 units of margin on every side
        // and is centred on y = 0 (the old points sat half a unit high).
        points: [
          { x: -14, y: 15 },
          { x: -7, y: 15 },
          { x: -7, y: 5 },
          { x: 0, y: 5 },
          { x: 0, y: -5 },
          { x: 7, y: -5 },
          { x: 7, y: -15 },
          { x: 14, y: -15 },
        ],
        style: { strokeRole: "normal", lineCap: "round", lineJoin: "round" },
      },
    ],
    variants: [],
    labelVisibility: "hidden",
  };
}

const definitions = {
  adder: circleBlock("adder", "Adder", [
    {
      kind: "line",
      part: "plus-horizontal",
      from: { x: -6, y: 0 },
      to: { x: 6, y: 0 },
      style: { strokeRole: "normal", lineCap: "round", lineJoin: "round" },
    },
    {
      kind: "line",
      part: "plus-vertical",
      from: { x: 0, y: -6 },
      to: { x: 0, y: 6 },
      style: { strokeRole: "normal", lineCap: "round", lineJoin: "round" },
    },
  ]),
  multiplier: circleBlock("multiplier", "Multiplier", [
    {
      kind: "line",
      part: "multiply-descending",
      from: { x: -4.243, y: -4.243 },
      to: { x: 4.243, y: 4.243 },
      style: { strokeRole: "normal", lineCap: "round", lineJoin: "round" },
    },
    {
      kind: "line",
      part: "multiply-ascending",
      from: { x: -4.243, y: 4.243 },
      to: { x: 4.243, y: -4.243 },
      style: { strokeRole: "normal", lineCap: "round", lineJoin: "round" },
    },
  ]),
  transconductance: formulaBlock({
    id: "transconductance",
    name: "Transconductance (+gₘ)",
    viewBox: { x: -44, y: -39, width: 88, height: 78 },
    pinSpan: 40,
    body: { left: -20, top: -35, right: 20, bottom: 35 },
    defaultFormula: "+g_m",
    shape: "right-tapered-trapezoid",
    minBodyWidth: 40,
    minBodyHeight: 70,
    horizontalPadding: 4,
  }),
  integrator: formulaBlock({
    id: "integrator",
    name: "Integrator (1/s)",
    viewBox: { x: -44, y: -24, width: 88, height: 48 },
    pinSpan: 40,
    body: { left: -20, top: -20, right: 20, bottom: 20 },
    defaultFormula: "1/s",
  }),
  "unit-delay": formulaBlock({
    id: "unit-delay",
    name: "Unit Delay (z⁻¹)",
    viewBox: { x: -44, y: -24, width: 88, height: 48 },
    pinSpan: 40,
    body: { left: -20, top: -15, right: 20, bottom: 15 },
    defaultFormula: "z^-1",
  }),
  quantizer: quantizerBlock(),
  "discrete-time-integrator": formulaBlock({
    id: "discrete-time-integrator",
    name: "Discrete-Time Integrator (z⁻¹/(1−z⁻¹))",
    viewBox: { x: -54, y: -24, width: 108, height: 48 },
    pinSpan: 50,
    body: { left: -30, top: -20, right: 30, bottom: 20 },
    defaultFormula: "z^-1/(1-z^-1)",
  }),
};

const { manifest, files } = await loadRazaviReferenceAuthority(referenceRoot);
const geometryPath = manifest.deltaSigmaGeometryPath;
if (
  typeof geometryPath !== "string" ||
  typeof manifest.deltaSigmaGeometrySha256 !== "string"
) {
  fail("manifest is missing the delta-sigma geometry pin");
}
const geometrySource = files.get(geometryPath);
if (!geometrySource) fail(`authority did not load ${geometryPath}`);
const geometry = JSON.parse(geometrySource.toString("utf8"));
if (
  geometry.schemaVersion !== 1 ||
  geometry.id !== "razavi-delta-sigma-signal-flow-v1" ||
  !geometry.symbols ||
  !Array.isArray(geometry.witnesses)
) {
  fail("invalid delta-sigma geometry contract");
}

const expectedIds = Object.keys(definitions).sort();
if (
  Object.keys(geometry.symbols).sort().join("\0") !== expectedIds.join("\0")
) {
  fail("geometry symbol IDs do not match the generated Signal Flow family");
}

const witnessById = new Map(
  geometry.witnesses.map((witness) => [witness.id, witness]),
);
for (const witness of geometry.witnesses) {
  if (
    witness.kind !== "user-supplied-raster-witness" ||
    typeof witness.source?.title !== "string" ||
    typeof witness.source?.figure !== "string" ||
    typeof witness.source?.sourceFileName !== "string" ||
    witness.source.sourceFileName.includes("/") ||
    witness.source.sourceFileName.includes("\\") ||
    typeof witness.sourceSha256 !== "string" ||
    typeof witness.witnessPath !== "string" ||
    typeof witness.witnessSha256 !== "string" ||
    !Array.isArray(witness.sourceCropPx)
  ) {
    fail(`invalid witness contract ${witness.id ?? "<unknown>"}`);
  }
  const supplemental = manifest.supplementalAssets?.find(
    (asset) => asset.path === witness.witnessPath,
  );
  const expectedSupplementalSource = {
    kind: witness.kind,
    ...witness.source,
    sourceSha256: witness.sourceSha256,
    sourcePixels: witness.sourcePixels,
    sourceCropPx: witness.sourceCropPx,
    ...(witness.sourceOverlayExclusionPx
      ? { sourceOverlayExclusionPx: witness.sourceOverlayExclusionPx }
      : {}),
  };
  if (
    !supplemental ||
    supplemental.sha256 !== witness.witnessSha256 ||
    JSON.stringify(supplemental.source) !==
      JSON.stringify(expectedSupplementalSource)
  ) {
    fail(
      `manifest does not pin witness ${witness.witnessPath} with matching source metadata`,
    );
  }
  const generated = files.get(witness.witnessPath);
  if (!generated || hash(generated) !== witness.witnessSha256) {
    fail(`witness hash mismatch for ${witness.witnessPath}`);
  }
}

const bodyBounds = (definition) => {
  const body = definition.primitives.find(
    (primitive) => primitive.part === "body",
  );
  if (!body) fail(`${definition.id} is missing its body primitive`);
  if (body.kind === "circle") {
    return {
      kind: "circle",
      radius: body.radius,
      center: body.center,
    };
  }
  if (body.kind === "path") {
    const values = [...body.data.matchAll(/-?\d+(?:\.\d+)?/gu)].map((match) =>
      Number(match[0]),
    );
    const xs = values.filter((_, index) => index % 2 === 0);
    const ys = values.filter((_, index) => index % 2 === 1);
    return {
      kind:
        definition.formulaPresentation?.adaptiveFrame?.shape ===
        "right-tapered-trapezoid"
          ? "right-tapered-trapezoid"
          : "sharp-rectangle",
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    };
  }
  fail(`${definition.id} body must be a circle or a sharp rectangle`);
};

const fidelity = [];
for (const [symbolId, definition] of Object.entries(definitions)) {
  const measurement = geometry.symbols[symbolId];
  if (
    measurement.pinOrder.join("\0") !==
    definition.pins.map((pin) => pin.name).join("\0")
  ) {
    fail(`pin order mismatch for ${symbolId}`);
  }
  for (const pin of definition.pins) {
    if (pin.at.x % 10 !== 0 || pin.at.y % 10 !== 0) {
      fail(`off-grid pin ${symbolId}.${pin.name}`);
    }
  }
  const renderedBody = bodyBounds(definition);
  if (measurement.measurement.bodyKind !== renderedBody.kind) {
    fail(`body kind mismatch for ${symbolId}`);
  }
  let widthError = 0;
  let heightError = 0;
  let ratioError = 0;
  if (renderedBody.kind === "circle") {
    widthError = Math.abs(
      renderedBody.radius - measurement.measurement.targetRadius,
    );
  } else {
    widthError = Math.abs(
      renderedBody.width - measurement.measurement.targetBody.width,
    );
    heightError = Math.abs(
      renderedBody.height - measurement.measurement.targetBody.height,
    );
    if (measurement.measurement.targetBody.referenceRatio !== undefined) {
      ratioError = Math.abs(
        renderedBody.width / renderedBody.height -
          measurement.measurement.targetBody.referenceRatio,
      );
    }
  }
  fidelity.push({ symbolId, widthError, heightError, ratioError });

  if ("formulaPresentation" in measurement) {
    const expectedFormula = measurement.formulaPresentation;
    if (
      JSON.stringify(definition.formulaPresentation) !==
      JSON.stringify(expectedFormula)
    ) {
      fail(`formula presentation mismatch for ${symbolId}`);
    }
    if (
      definition.primitives.some((primitive) =>
        primitive.part?.startsWith("formula-"),
      )
    ) {
      fail(`${symbolId} must not hand-draw formula glyph primitives`);
    }
    if (definition.primitives.length !== 3) {
      fail(
        `${symbolId} formula asset primitives must contain only leads and body`,
      );
    }
  }

  const status = measurement.evidenceStatus;
  if (status === "direct-raster") {
    const witness = witnessById.get(measurement.witnessId);
    const fidelityMeasurement = measurement.measurement;
    if (!witness) {
      fail(`${symbolId} is direct-raster but lacks a pinned witness`);
    }
    if (fidelityMeasurement.assetPath !== witness.witnessPath) {
      fail(`${symbolId} direct-raster measurement must use its pinned witness`);
    }
    for (const [field, value] of Object.entries({
      pixelsPerLogical: fidelityMeasurement.pixelsPerLogical,
      originPxX: fidelityMeasurement.originPx?.x,
      originPxY: fidelityMeasurement.originPx?.y,
      threshold: fidelityMeasurement.threshold,
    })) {
      if (!Number.isFinite(value)) {
        fail(`${symbolId} direct-raster measurement has invalid ${field}`);
      }
    }
  }
  if (
    status === "family-derived-provisional" &&
    (!measurement.derivedFrom || !definitions[measurement.derivedFrom])
  ) {
    fail(`${symbolId} is provisional but lacks an in-family source`);
  }
}

const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
const manualOnlyReasons = {
  adder:
    "Behavioral summing node; structural netlists need an explicit implementation mapping.",
  multiplier:
    "Behavioral mixing node; structural netlists need an explicit implementation mapping.",
  transconductance:
    "Behavioral transconductance block; structural netlists need an explicit implementation mapping.",
  integrator:
    "Behavioral s-domain block; structural netlists need an explicit implementation mapping.",
  "unit-delay":
    "Behavioral z-domain block; structural netlists need an explicit implementation mapping.",
  quantizer:
    "Behavioral quantization block; structural netlists need an explicit implementation mapping.",
  "discrete-time-integrator":
    "Behavioral z-domain block; structural netlists need an explicit implementation mapping.",
};
const signalFlowOrder = [
  "adder",
  "multiplier",
  "transconductance",
  "integrator",
  "unit-delay",
  "discrete-time-integrator",
  "quantizer",
];
for (const symbolId of signalFlowOrder) {
  const definition = definitions[symbolId];
  const measurement = geometry.symbols[symbolId];
  let entry = catalog.entries.find(
    (candidate) => candidate.symbolId === symbolId,
  );
  if (!entry) {
    entry = { symbolId };
    const quantizerIndex = catalog.entries.findIndex(
      (candidate) => candidate.symbolId === "quantizer",
    );
    catalog.entries.splice(
      quantizerIndex < 0 ? catalog.entries.length : quantizerIndex,
      0,
      entry,
    );
  }
  Object.assign(entry, {
    symbolId,
    name: definition.name,
    category: "signal-flow",
    reviewStatus: "reviewed",
    pinOrder: definition.pins.map((pin) => pin.name),
    palette: true,
    automaticMappings: [],
    manualOnlyReason: manualOnlyReasons[symbolId],
    assetPath: `${symbolId}.symbol.json`,
    assetHash: hash(await asSource(definition)),
    // The geometry contract owns direct-vs-derived evidence status and points
    // to individually hash-pinned witnesses. Catalog authority stays focused
    // on the calibrated contract instead of duplicating evidence semantics.
    visualAuthority: {
      kind: "razavi-reference-v1",
      referenceManifestPath:
        "fixtures/visual-reference/razavi-reference-v1/manifest.json",
      referencePaths: [
        "fixtures/visual-reference/razavi-reference-v1/delta-sigma-geometry.json",
      ],
      calibrationPath:
        "fixtures/visual-reference/razavi-reference-v1/delta-sigma-geometry.json",
    },
  });
  delete entry.generation;
}

const orderedEntries = [];
const seen = new Set();
for (const entry of catalog.entries) {
  if (entry.symbolId === "adder") {
    for (const symbolId of signalFlowOrder) {
      const signalEntry = catalog.entries.find(
        (candidate) => candidate.symbolId === symbolId,
      );
      if (signalEntry && !seen.has(symbolId)) {
        orderedEntries.push(signalEntry);
        seen.add(symbolId);
      }
    }
  }
  if (!seen.has(entry.symbolId)) {
    orderedEntries.push(entry);
    seen.add(entry.symbolId);
  }
}
catalog.entries = orderedEntries;

for (const [symbolId, definition] of Object.entries(definitions)) {
  const output = resolve(assetRoot, `${symbolId}.symbol.json`);
  const source = await asSource(definition);
  if (check) {
    if (normalize(await readFile(output, "utf8")) !== source) {
      fail(`${relative(root, output)} is stale`);
    }
  } else {
    await writeFile(output, source, "utf8");
  }
}

const catalogSource = normalize(
  await format(JSON.stringify(catalog, null, 2), { parser: "json" }),
);
if (check) {
  if (normalize(await readFile(catalogPath, "utf8")) !== catalogSource) {
    fail(`${relative(root, catalogPath)} is stale`);
  }
} else {
  await writeFile(catalogPath, catalogSource, "utf8");
}

const metric = (key) => Math.max(...fidelity.map((result) => result[key]));
console.log(
  `${check ? "Validated" : "Generated"} ${expectedIds.length} Signal Flow assets; geometry max errors: body-width=${metric("widthError")}, body-height=${metric("heightError")}, ratio=${metric("ratioError")}. Formula metadata is hash-pinned in the source assets and runtime catalog; SVG formula glyph fidelity is scored separately by the explicit symbol-fidelity targets.`,
);
