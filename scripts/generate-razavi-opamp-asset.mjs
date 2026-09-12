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
const assetPath = resolve(root, "packages/components/definitions/opamp.json");
const differentialAssetPaths = {
  "opamp-differential": resolve(
    root,
    "packages/components/definitions/opamp-differential.json",
  ),
  "opamp-differential-crossed": resolve(
    root,
    "packages/components/definitions/opamp-differential-crossed.json",
  ),
};
/** Figure-derived pair height before the reviewed product-scale adjustment. */
const SOURCE_PAIR_OFFSET = 10;
/** Every differential input/output pair uses the ordinary Op Amp's ±10 grid. */
const OUTPUT_PAIR_OFFSET = 10;
/** Polarity glyphs stay associated with that same shared pair spacing. */
const POLARITY_PAIR_OFFSET = 10;
/** Add a small horizontal gap between input- and output-side glyphs. */
const POLARITY_HORIZONTAL_SPREAD = 1;
const catalogPath = resolve(root, "packages/components/catalog.json");
const check = process.argv.includes("--check");
const normalize = (value) => `${value.replaceAll("\r\n", "\n").trimEnd()}\n`;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const normal = { strokeRole: "normal", lineCap: "butt", lineJoin: "miter" };
const ANALOG_BLOCK_LEAD_LENGTH = 10;
const OPAMP_INPUT_PIN_X = -40;
const OPAMP_OUTPUT_PIN_X = 40;
const OPAMP_BODY_LEFT_X = -26.7979;
const OPAMP_BODY_APEX_X = 23.2021;

function fail(message) {
  throw new Error(`Razavi op-amp generation: ${message}`);
}

function line(geometry) {
  return { kind: "line", from: geometry.from, to: geometry.to, style: normal };
}

const { manifest, files } = await loadRazaviReferenceAuthority(referenceRoot);
const authority = manifest.vectorEvidence?.find(
  (candidate) => candidate.id === "razavi-textbook-figure-8-26-opamp",
);
if (!authority || authority.kind !== "pdf-vector-extract") {
  fail("missing manifest-pinned PDF vector evidence");
}
const evidenceSource = files.get(authority.extractPath);
if (!evidenceSource) fail("vector evidence was not loaded by the authority");
const evidence = JSON.parse(evidenceSource.toString("utf8"));
const geometry = evidence.normalization?.symbolGeometry;
if (
  evidence.schemaVersion !== 1 ||
  evidence.id !== authority.id ||
  evidence.kind !== authority.kind ||
  evidence.source.sha256 !== authority.source.sha256 ||
  evidence.source.pdfPage !== authority.source.pdfPage ||
  evidence.normalization.pinAnchorsLogical?.length !== 3 ||
  evidence.normalization.strokeMapping?.normal?.targetRole !== "normal" ||
  evidence.normalization.strokeMapping?.triangle?.targetRole !== "emphasis" ||
  typeof geometry?.trianglePathData !== "string"
) {
  fail("vector evidence contract mismatch");
}

const symbol = {
  schemaVersion: 1,
  id: "opamp",
  name: "Operational Amplifier",
  viewBox: { x: -44, y: -28, width: 88, height: 56 },
  pins: [
    {
      name: "IN+",
      role: "non-inverting-input",
      at: { x: OPAMP_INPUT_PIN_X, y: 10 },
      direction: "west",
      presentation: {
        visibility: "visible",
        leadLength: ANALOG_BLOCK_LEAD_LENGTH,
      },
    },
    {
      name: "IN-",
      role: "inverting-input",
      at: { x: OPAMP_INPUT_PIN_X, y: -10 },
      direction: "west",
      presentation: {
        visibility: "visible",
        leadLength: ANALOG_BLOCK_LEAD_LENGTH,
      },
    },
    {
      name: "OUT",
      role: "output",
      at: { x: OPAMP_OUTPUT_PIN_X, y: 0 },
      direction: "east",
      presentation: {
        visibility: "visible",
        leadLength: ANALOG_BLOCK_LEAD_LENGTH,
      },
    },
  ],
  primitives: [
    line({
      ...geometry.inputMinus,
      from: { ...geometry.inputMinus.from, x: OPAMP_INPUT_PIN_X },
      to: { ...geometry.inputMinus.to, x: OPAMP_BODY_LEFT_X },
    }),
    line({
      ...geometry.inputPlus,
      from: { ...geometry.inputPlus.from, x: OPAMP_INPUT_PIN_X },
      to: { ...geometry.inputPlus.to, x: OPAMP_BODY_LEFT_X },
    }),
    line({
      ...geometry.output,
      from: { ...geometry.output.from, x: OPAMP_BODY_APEX_X },
      to: { ...geometry.output.to, x: OPAMP_OUTPUT_PIN_X },
    }),
    {
      kind: "path",
      data: geometry.trianglePathData,
      style: {
        strokeRole: "emphasis",
        lineCap: "butt",
        lineJoin: "miter",
        miterLimit: 4,
      },
    },
    line(geometry.plusVertical),
    line(geometry.plusHorizontal),
    {
      ...line(geometry.minusHorizontal),
      part: "upright-input-polarity-negative",
    },
  ],
  variants: [],
};
const assetSource = normalize(
  await format(JSON.stringify(symbol, null, 2), { parser: "json" }),
);

/**
 * Figure 13.48 supplies the fully differential polarity layout and dual-output
 * topology. Its printed triangle is compact, whereas the product contract is
 * that every triangular Analog Block uses the ordinary Razavi Op Amp body
 * (Figure 8.26). Scale only Figure 13.48's polarity layout into that exact
 * shared body; retain pin semantics and derive only marks needed per state.
 */
const differentialAuthority = manifest.vectorEvidence?.find(
  (candidate) =>
    candidate.id === "razavi-textbook-figure-13-48-differential-opamp",
);
if (
  !differentialAuthority ||
  differentialAuthority.kind !== "pdf-vector-extract"
) {
  fail("missing manifest-pinned Figure 13.48 differential op-amp evidence");
}
const differentialEvidenceSource = files.get(differentialAuthority.extractPath);
if (!differentialEvidenceSource) {
  fail("Figure 13.48 vector evidence was not loaded by the authority");
}
const differentialEvidence = JSON.parse(
  differentialEvidenceSource.toString("utf8"),
);
const differentialGeometry = differentialEvidence.normalization?.symbolGeometry;
if (
  differentialEvidence.schemaVersion !== 1 ||
  differentialEvidence.id !== differentialAuthority.id ||
  differentialEvidence.source?.sha256 !== differentialAuthority.source.sha256 ||
  differentialEvidence.source?.pdfPage !==
    differentialAuthority.source.pdfPage ||
  differentialEvidence.normalization?.pinAnchorsLogical?.length !== 4 ||
  differentialEvidence.normalization?.derivation?.kind !==
    "semantic-pin-extension" ||
  typeof differentialGeometry?.trianglePathData !== "string"
) {
  fail("Figure 13.48 differential op-amp evidence contract mismatch");
}

const opampTriangle = {
  leftX: -26.7979,
  apexX: 23.2021,
  topY: -24.9983,
  bottomY: 25,
};
const compactDifferentialTriangle = {
  leftX: -20,
  apexX: 14.9998,
  topY: -15.0002,
  bottomY: 14.9993,
};
const opampCenterX = (opampTriangle.leftX + opampTriangle.apexX) / 2;
const opampCenterY = (opampTriangle.topY + opampTriangle.bottomY) / 2;
const scaleDifferentialMarkPoint = ({ x, y }) => ({
  x:
    opampTriangle.leftX +
    ((x - compactDifferentialTriangle.leftX) *
      (opampTriangle.apexX - opampTriangle.leftX)) /
      (compactDifferentialTriangle.apexX - compactDifferentialTriangle.leftX),
  y:
    opampTriangle.topY +
    ((y - compactDifferentialTriangle.topY) *
      (opampTriangle.bottomY - opampTriangle.topY)) /
      (compactDifferentialTriangle.bottomY - compactDifferentialTriangle.topY),
});
const scaledDifferentialTriangle = { ...opampTriangle, apexY: 0 };
const baseDifferentialTriangle = scaledDifferentialTriangle;
const differentialTrianglePathData = geometry.trianglePathData;
const triangleEdgeXAtY = (triangle, y) => {
  const reachesApexFromTop = y <= triangle.apexY;
  const edgeY = reachesApexFromTop ? triangle.topY : triangle.bottomY;
  const ratio = reachesApexFromTop
    ? (y - edgeY) / (triangle.apexY - edgeY)
    : (edgeY - y) / (edgeY - triangle.apexY);
  return triangle.leftX + ratio * (triangle.apexX - triangle.leftX);
};
const scaleDifferentialPairLine = (geometry, spreadDirection) => {
  const base = {
    from: scaleDifferentialMarkPoint(geometry.from),
    to: scaleDifferentialMarkPoint(geometry.to),
  };
  const center = {
    x: (base.from.x + base.to.x) / 2,
    y: (base.from.y + base.to.y) / 2,
  };
  const side = Math.sign(center.y - opampCenterY);
  const targetCenterY =
    center.y + side * (POLARITY_PAIR_OFFSET - SOURCE_PAIR_OFFSET);
  const baseEdgeX = triangleEdgeXAtY(baseDifferentialTriangle, center.y);
  const crossSectionFraction =
    (center.x - baseDifferentialTriangle.leftX) /
    (baseEdgeX - baseDifferentialTriangle.leftX);
  const targetEdgeX = triangleEdgeXAtY(
    scaledDifferentialTriangle,
    targetCenterY,
  );
  const targetCenterX =
    scaledDifferentialTriangle.leftX +
    crossSectionFraction * (targetEdgeX - scaledDifferentialTriangle.leftX) +
    spreadDirection * POLARITY_HORIZONTAL_SPREAD;
  const shiftPoint = (point) => ({
    x: targetCenterX + (point.x - center.x),
    y: targetCenterY + (point.y - center.y),
  });
  return {
    from: shiftPoint(base.from),
    to: shiftPoint(base.to),
  };
};
const differentialLine = (geometry) => ({
  kind: "line",
  from: geometry.from,
  to: geometry.to,
  style: normal,
});
const taggedLine = (geometry, part) => ({
  ...differentialLine(geometry),
  part,
});
const acrossAxis = (primitive) => ({
  ...primitive,
  from: { ...primitive.from, y: -primitive.from.y },
  to: { ...primitive.to, y: -primitive.to.y },
});
const CONNECTION_GRID = 10;
const pinOneGridOutsideBody = (contact, pin, direction) => ({
  ...pin,
  at: {
    x:
      (direction === "west" ? Math.floor : Math.ceil)(
        contact.x / CONNECTION_GRID,
      ) *
        CONNECTION_GRID +
      (direction === "west" ? -CONNECTION_GRID : CONNECTION_GRID),
    y: contact.y,
  },
  presentation: {
    ...pin.presentation,
    leadLength: ANALOG_BLOCK_LEAD_LENGTH,
  },
});
const outputContact = (y) => {
  const reachesApexFromTop = y <= 0;
  const edgeY = reachesApexFromTop
    ? scaledDifferentialTriangle.topY
    : scaledDifferentialTriangle.bottomY;
  const apexY = scaledDifferentialTriangle.apexY;
  const ratio = reachesApexFromTop
    ? (y - edgeY) / (apexY - edgeY)
    : (edgeY - y) / (edgeY - apexY);
  return {
    x:
      scaledDifferentialTriangle.leftX +
      ratio *
        (scaledDifferentialTriangle.apexX - scaledDifferentialTriangle.leftX),
    y,
  };
};
const inputLeadContact = (y) => ({
  x: scaledDifferentialTriangle.leftX,
  y,
});
const outputLeadContact = (y) => {
  // The lead is emitted before the triangle outline. Ending it on the sloped
  // edge centerline gives the later, wider outline a real overlap to cover.
  // Ending at the outline's outer boundary only makes the two antialiased
  // strokes tangent and can leave a visible white seam in the browser.
  return outputContact(y);
};
const inputLead = (pin, contact) => ({
  kind: "line",
  part: "input-lead",
  from: pin.at,
  to: contact,
  // Symbol DSL has no wire role; normal currently resolves to the Razavi wire
  // width (1.6 logical units) and tracks that profile value.
  style: normal,
});
const outputLead = (contact, pin) => ({
  kind: "line",
  part: "output-lead",
  from: contact,
  to: pin.at,
  style: normal,
});
const sourceInputMarks = [
  taggedLine(
    scaleDifferentialPairLine(differentialGeometry.input_plus_vertical, -1),
    "input-polarity",
  ),
  taggedLine(
    scaleDifferentialPairLine(differentialGeometry.input_plus_horizontal, -1),
    "input-polarity",
  ),
  taggedLine(
    scaleDifferentialPairLine(differentialGeometry.input_minus_horizontal, -1),
    "upright-input-polarity-negative",
  ),
];
const sourceOutputMarks = [
  taggedLine(
    scaleDifferentialPairLine(differentialGeometry.output_minus_horizontal, 1),
    "upright-output-polarity-negative",
  ),
  taggedLine(
    scaleDifferentialPairLine(differentialGeometry.output_plus_vertical, 1),
    "output-polarity",
  ),
  taggedLine(
    scaleDifferentialPairLine(differentialGeometry.output_plus_horizontal, 1),
    "output-polarity",
  ),
];
const differentialSymbol = (id, name, plusOutputAtBottom) => {
  const topInput = pinOneGridOutsideBody(
    inputLeadContact(-OUTPUT_PAIR_OFFSET),
    symbol.pins[1],
    "west",
  );
  const bottomInput = pinOneGridOutsideBody(
    inputLeadContact(OUTPUT_PAIR_OFFSET),
    symbol.pins[0],
    "west",
  );
  const topOutput = pinOneGridOutsideBody(
    outputLeadContact(-OUTPUT_PAIR_OFFSET),
    {
      name: "OUT-",
      role: "output",
      at: { x: geometry.output.to.x, y: -OUTPUT_PAIR_OFFSET },
      direction: "east",
      presentation: { visibility: "visible", leadLength: 20 },
    },
    "east",
  );
  const bottomOutput = pinOneGridOutsideBody(
    outputLeadContact(OUTPUT_PAIR_OFFSET),
    {
      name: "OUT+",
      role: "output",
      at: { x: geometry.output.to.x, y: OUTPUT_PAIR_OFFSET },
      direction: "east",
      presentation: { visibility: "visible", leadLength: 20 },
    },
    "east",
  );
  const outputPins = plusOutputAtBottom
    ? [bottomOutput, topOutput]
    : [
        { ...topOutput, name: "OUT+" },
        { ...bottomOutput, name: "OUT-" },
      ];
  return {
    schemaVersion: 1,
    id,
    name,
    viewBox: symbol.viewBox,
    pins: [bottomInput, topInput, ...outputPins],
    primitives: [
      inputLead(topInput, inputLeadContact(-OUTPUT_PAIR_OFFSET)),
      inputLead(bottomInput, inputLeadContact(OUTPUT_PAIR_OFFSET)),
      outputLead(
        outputLeadContact(-OUTPUT_PAIR_OFFSET),
        outputPins.find((pin) => pin.at.y === -OUTPUT_PAIR_OFFSET),
      ),
      outputLead(
        outputLeadContact(OUTPUT_PAIR_OFFSET),
        outputPins.find((pin) => pin.at.y === OUTPUT_PAIR_OFFSET),
      ),
      {
        kind: "path",
        data: differentialTrianglePathData,
        style: {
          strokeRole: "emphasis",
          lineCap: "butt",
          lineJoin: "miter",
          miterLimit: 4,
        },
      },
      ...sourceInputMarks.map(acrossAxis),
      ...(plusOutputAtBottom
        ? sourceOutputMarks
        : sourceOutputMarks.map(acrossAxis)),
    ],
    variants: [],
  };
};
const differentialSymbols = [
  differentialSymbol("opamp-differential", "Differential Op Amp", true),
  differentialSymbol(
    "opamp-differential-crossed",
    "Differential Op Amp (crossed outputs)",
    false,
  ),
];
const differentialSources = new Map(
  await Promise.all(
    differentialSymbols.map(async (candidate) => [
      candidate.id,
      normalize(
        await format(JSON.stringify(candidate, null, 2), { parser: "json" }),
      ),
    ]),
  ),
);

const catalog = JSON.parse(await readComponentProjection(catalogPath));
const generation = {
  kind: "razavi-pdf-vector-reference",
  referenceManifestPath:
    "fixtures/visual-reference/razavi-reference-v1/manifest.json",
  referencePath:
    "fixtures/visual-reference/razavi-reference-v1/opamp-vector-source.json",
  converterPath: "scripts/generate-razavi-opamp-asset.mjs",
  converterVersion: 2,
};
const differentialGeneration = {
  kind: "razavi-pdf-vector-reference",
  referenceManifestPath:
    "fixtures/visual-reference/razavi-reference-v1/manifest.json",
  referencePath:
    "fixtures/visual-reference/razavi-reference-v1/differential-opamp-vector-source.json",
  converterPath: "scripts/generate-razavi-opamp-asset.mjs",
  converterVersion: 4,
};
const differentialAuthorityPaths = [
  "fixtures/visual-reference/razavi-reference-v1/opamp-vector-source.json",
  "fixtures/visual-reference/razavi-reference-v1/differential-opamp-vector-source.json",
  "fixtures/visual-reference/razavi-reference-v1/differential-opamp-reference.png",
];
const baseEntry = catalog.entries.find(
  (candidate) => candidate.symbolId === symbol.id,
);
if (!baseEntry) fail(`missing catalog entry ${symbol.id}`);
baseEntry.assetHash = hash(assetSource);
baseEntry.generation = { ...generation };
for (const [id, source] of differentialSources) {
  const entry = catalog.entries.find((candidate) => candidate.symbolId === id);
  if (!entry) fail(`missing catalog entry ${id}`);
  entry.assetHash = hash(source);
  entry.visualAuthority = {
    ...entry.visualAuthority,
    referencePaths: differentialAuthorityPaths,
    calibrationPath:
      "fixtures/visual-reference/razavi-reference-v1/differential-opamp-geometry.json",
  };
  entry.generation = { ...differentialGeneration };
}
const catalogSource = normalize(
  await format(JSON.stringify(catalog, null, 2), { parser: "json" }),
);

const outputs = [
  [assetPath, assetSource],
  ...differentialSymbols.map((candidate) => [
    differentialAssetPaths[candidate.id],
    differentialSources.get(candidate.id),
  ]),
  [catalogPath, catalogSource],
];
if (check) {
  for (const [path, source] of outputs) {
    if (normalize(await readComponentProjection(path)) !== source) {
      fail(`${relative(root, path)} is stale`);
    }
  }
} else {
  for (const [path, source] of outputs) {
    await writeComponentProjection(path, source);
  }
}

console.log(
  `${check ? "Validated" : "Generated"} PDF-derived Razavi op-amp assets` +
    " (Figure 13.48 differential body)",
);
