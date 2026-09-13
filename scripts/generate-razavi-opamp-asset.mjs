import {
  readComponentProjection,
  writeComponentProjection,
} from "./lib/component-library.mjs";
import { createHash } from "node:crypto";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { format } from "prettier";

import { loadRazaviReferenceAuthority } from "./lib/razavi-reference-authority.mjs";

import {
  ANALOG_TRIANGLE,
  ANALOG_TRIANGLE_BOUNDS,
  ANALOG_TRIANGLE_PATH,
  ANALOG_TRIANGLE_OUTPUT_X,
  ANALOG_TRIANGLE_VIEWBOX,
} from "./lib/analog-triangle.mjs";

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
/** Every differential input/output pair uses the ordinary Op Amp's ±10 grid. */
const OUTPUT_PAIR_OFFSET = 10;
const catalogPath = resolve(root, "packages/components/catalog.json");
const check = process.argv.includes("--check");
const normalize = (value) => `${value.replaceAll("\r\n", "\n").trimEnd()}\n`;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const normal = { strokeRole: "normal", lineCap: "butt", lineJoin: "miter" };
const ANALOG_BLOCK_LEAD_LENGTH = 10;
const OPAMP_INPUT_PIN_X = -40;
const OPAMP_OUTPUT_PIN_X = ANALOG_TRIANGLE_OUTPUT_X;
const OPAMP_BODY_LEFT_X = ANALOG_TRIANGLE.leftX;
const OPAMP_BODY_APEX_X = ANALOG_TRIANGLE.apexX;
const INPUT_MARK_X = OPAMP_BODY_LEFT_X + 6.25;
const OUTPUT_MARK_X = Number((ANALOG_TRIANGLE.apexX - 35.5).toFixed(6));
const MARK_ROW_Y = 14;
const MARK_HALF_SIZE = 3;

// Use the differential gm block's square +/- construction for every analog
// triangle. Scaling the PDF's axes separately distorted the FD Amp marks.
function polarityPair(x, side) {
  const mark = (from, to, part) => ({
    kind: "line",
    from,
    to,
    part,
    style: { ...normal, lineCap: "round", lineJoin: "round" },
  });
  return [
    mark(
      { x, y: MARK_ROW_Y - MARK_HALF_SIZE },
      { x, y: MARK_ROW_Y + MARK_HALF_SIZE },
      `${side}-polarity`,
    ),
    mark(
      { x: x - MARK_HALF_SIZE, y: MARK_ROW_Y },
      { x: x + MARK_HALF_SIZE, y: MARK_ROW_Y },
      `${side}-polarity`,
    ),
    mark(
      { x: x - MARK_HALF_SIZE, y: -MARK_ROW_Y },
      { x: x + MARK_HALF_SIZE, y: -MARK_ROW_Y },
      `upright-${side}-polarity-negative`,
    ),
  ];
}

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
  viewBox: ANALOG_TRIANGLE_VIEWBOX,
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
      data: ANALOG_TRIANGLE_PATH,
      bounds: ANALOG_TRIANGLE_BOUNDS,
      style: {
        strokeRole: "emphasis",
        lineCap: "butt",
        lineJoin: "miter",
        miterLimit: 4,
      },
    },
    ...polarityPair(INPUT_MARK_X, "input"),
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
 * with the user-requested equilateral normalization and uniform +/- strokes.
 * Retain Figure 13.48's pin semantics and derive only marks needed per state.
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

const scaledDifferentialTriangle = ANALOG_TRIANGLE;
const differentialTrianglePathData = ANALOG_TRIANGLE_PATH;
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
const sourceInputMarks = polarityPair(INPUT_MARK_X, "input");
const sourceOutputMarks = polarityPair(OUTPUT_MARK_X, "output");
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
  // Share the single-ended output column, rather than deriving a shorter
  // terminal position from each sloped edge's contact point.
  const topOutput = {
    ...symbol.pins[2],
    name: "OUT-",
    at: { x: OPAMP_OUTPUT_PIN_X, y: -OUTPUT_PAIR_OFFSET },
  };
  const bottomOutput = {
    ...symbol.pins[2],
    name: "OUT+",
    at: { x: OPAMP_OUTPUT_PIN_X, y: OUTPUT_PAIR_OFFSET },
  };
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
        bounds: ANALOG_TRIANGLE_BOUNDS,
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
  converterVersion: 6,
  bodyNormalization: "equilateral-triangle",
};
const differentialGeneration = {
  kind: "razavi-pdf-vector-reference",
  referenceManifestPath:
    "fixtures/visual-reference/razavi-reference-v1/manifest.json",
  referencePath:
    "fixtures/visual-reference/razavi-reference-v1/differential-opamp-vector-source.json",
  converterPath: "scripts/generate-razavi-opamp-asset.mjs",
  converterVersion: 8,
  bodyNormalization: "equilateral-triangle",
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
// Comparator states share the same outline and port leads. Their transfer
// characteristic stays authored; unmarked removes only the input +/- strokes.
const comparatorOutputs = [];
for (const id of ["comparator", "comparator-unmarked"]) {
  const path = resolve(root, `packages/components/definitions/${id}.json`);
  const previous = JSON.parse(await readComponentProjection(path));
  const next = {
    ...previous,
    viewBox: symbol.viewBox,
    pins: symbol.pins,
    primitives: [
      ...symbol.primitives.slice(0, id === "comparator" ? 7 : 4),
      ...previous.primitives
        .filter((primitive) => primitive.part === "hysteresis-step")
        .map((primitive) => {
          // Marked comparators reserve space beside the input signs; both
          // transfer glyphs move with the triangle instead of sheet origin.
          const center = Number(
            (id === "comparator"
              ? ANALOG_TRIANGLE.apexX - 32
              : (2 * ANALOG_TRIANGLE.leftX + ANALOG_TRIANGLE.apexX) / 3
            ).toFixed(6),
          );
          return {
            ...primitive,
            data: `M ${center - 8} 7 L ${center} 7 L ${center} -7 L ${center + 8} -7`,
            bounds: { x: center - 8, y: -7, width: 16, height: 14 },
          };
        }),
    ],
  };
  const source = normalize(
    await format(JSON.stringify(next, null, 2), { parser: "json" }),
  );
  comparatorOutputs.push([path, source]);
  const entry = catalog.entries.find((candidate) => candidate.symbolId === id);
  if (!entry) fail(`missing catalog entry ${id}`);
  entry.assetHash = hash(source);
  entry.generation = { ...generation };
}
const catalogSource = normalize(
  await format(JSON.stringify(catalog, null, 2), { parser: "json" }),
);

const outputs = [
  [assetPath, assetSource],
  ...comparatorOutputs,
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
