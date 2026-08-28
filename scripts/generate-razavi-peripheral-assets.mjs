import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { format } from "prettier";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const referenceRoot = resolve(
  root,
  "fixtures/visual-reference/razavi-reference-v1",
);
const assetRoot = resolve(root, "packages/symbols/assets/razavi-v1");
const manifestPath = resolve(referenceRoot, "manifest.json");
const geometryPath = resolve(referenceRoot, "peripheral-geometry.json");
const catalogPath = resolve(assetRoot, "catalog.json");
const styleGeometryPath = resolve(
  root,
  "packages/derived/src/razavi-peripheral-geometry.generated.ts",
);
const check = process.argv.includes("--check");
const normal = { strokeRole: "normal", lineCap: "butt", lineJoin: "miter" };
const emphasis = { strokeRole: "emphasis", lineCap: "butt", lineJoin: "miter" };
const groundBar = { strokeRole: "ground", lineCap: "butt", lineJoin: "miter" };
const normalize = (value) => `${value.replaceAll("\r\n", "\n").trimEnd()}\n`;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const rounded = (value) => Math.round(value * 1_000_000) / 1_000_000;

function fail(message) {
  throw new Error(`Razavi peripheral generation: ${message}`);
}

function logical(measurement, point) {
  return {
    x: rounded((point.x - measurement.originPx.x) / geometry.pixelsPerLogical),
    y: rounded((point.y - measurement.originPx.y) / geometry.pixelsPerLogical),
  };
}

function line(from, to, style = normal) {
  const clean = (point) => ({ x: rounded(point.x), y: rounded(point.y) });
  return { kind: "line", from: clean(from), to: clean(to), style };
}

function polyline(points, style = normal) {
  const clean = (point) => ({ x: rounded(point.x), y: rounded(point.y) });
  return { kind: "polyline", points: points.map(clean), style };
}

function sourcePins() {
  return [
    {
      name: "+",
      role: "positive",
      at: { x: 0, y: -20 },
      direction: "north",
      presentation: { visibility: "visible", leadLength: 10 },
    },
    {
      name: "-",
      role: "negative",
      at: { x: 0, y: 20 },
      direction: "south",
      presentation: { visibility: "visible", leadLength: 10 },
    },
  ];
}

function voltageSource(measurement) {
  const radius = rounded(
    measurement.circleRadiusPx / geometry.pixelsPerLogical,
  );
  const polarity = measurement.polarityPx;
  const plus = logical(measurement, { x: polarity.x, y: polarity.plusY });
  const minus = logical(measurement, { x: polarity.x, y: polarity.minusY });
  const halfWidth = rounded(polarity.halfWidth / geometry.pixelsPerLogical);
  const halfHeight = rounded(polarity.halfHeight / geometry.pixelsPerLogical);
  return {
    schemaVersion: 1,
    id: "voltage-source",
    name: "Independent Voltage Source",
    viewBox: { x: -24, y: -24, width: 39, height: 48 },
    pins: sourcePins(),
    primitives: [
      // The Razavi reference uses the same fine outline for the voltage-source
      // circle as its terminal leads; only source glyphs such as GND bars use
      // the heavier emphasis role.
      { kind: "circle", center: { x: 0, y: 0 }, radius, style: normal },
      line(
        { x: plus.x - halfWidth, y: plus.y },
        { x: plus.x + halfWidth, y: plus.y },
      ),
      line(
        { x: plus.x, y: plus.y - halfHeight },
        { x: plus.x, y: plus.y + halfHeight },
      ),
      line(
        { x: minus.x - halfWidth, y: minus.y },
        { x: minus.x + halfWidth, y: minus.y },
      ),
      line({ x: 0, y: -radius }, { x: 0, y: -20 }),
      line({ x: 0, y: radius }, { x: 0, y: 20 }),
    ],
    variants: [],
  };
}

function pulseVoltageSource(measurement) {
  const radius = rounded(
    measurement.circleRadiusPx / geometry.pixelsPerLogical,
  );
  return {
    schemaVersion: 1,
    id: "pulse-voltage-source",
    name: "Digital Clock",
    viewBox: { x: -24, y: -24, width: 39, height: 48 },
    pins: sourcePins(),
    primitives: [
      { kind: "circle", center: { x: 0, y: 0 }, radius, style: normal },
      // One continuous path preserves sharp mitered corners at every scale.
      // These points are the horizontal pulse glyph rotated 90 degrees
      // counter-clockwise in screen coordinates.
      polyline([
        { x: 4, y: 7 },
        { x: 4, y: 4 },
        { x: -4, y: 4 },
        { x: -4, y: -4 },
        { x: 4, y: -4 },
        { x: 4, y: -7 },
      ]),
      line({ x: 0, y: -radius }, { x: 0, y: -20 }),
      line({ x: 0, y: radius }, { x: 0, y: 20 }),
    ],
    variants: [],
  };
}

function currentSource(measurement) {
  const radius = rounded(
    measurement.circleRadiusPx / geometry.pixelsPerLogical,
  );
  const arrow = measurement.arrowPx;
  const shaftStart = logical(measurement, {
    x: measurement.originPx.x,
    y: arrow.shaftStartY,
  });
  const base = logical(measurement, {
    x: measurement.originPx.x,
    y: arrow.baseY,
  });
  const tip = logical(measurement, {
    x: measurement.originPx.x,
    y: arrow.tipY,
  });
  const halfWidth = rounded(arrow.halfWidth / geometry.pixelsPerLogical);
  return {
    schemaVersion: 1,
    id: "current-source",
    name: "Independent Current Source",
    viewBox: { x: -15, y: -24, width: 30, height: 48 },
    pins: sourcePins(),
    primitives: [
      { kind: "circle", center: { x: 0, y: 0 }, radius, style: normal },
      line(shaftStart, base),
      {
        kind: "polygon",
        points: [
          tip,
          { x: -halfWidth, y: base.y },
          { x: halfWidth, y: base.y },
        ],
        fill: "foreground",
        stroke: "none",
      },
      line({ x: 0, y: -radius }, { x: 0, y: -20 }),
      line({ x: 0, y: radius }, { x: 0, y: 20 }),
    ],
    variants: [],
  };
}

function ground(measurement) {
  const bars = measurement.barsPx.map((bar) => ({
    y: logical(measurement, { x: measurement.originPx.x, y: bar.y }).y,
    halfWidth: rounded(bar.halfWidth / geometry.pixelsPerLogical),
  }));
  return {
    schemaVersion: 1,
    id: "ground",
    name: "Ground",
    viewBox: { x: -12, y: -14, width: 24, height: 31 },
    pins: [
      {
        name: "0",
        role: "ground",
        at: { x: 0, y: -10 },
        direction: "north",
        presentation: { visibility: "visible", leadLength: 10 },
      },
    ],
    primitives: [
      line({ x: 0, y: -10 }, { x: 0, y: bars[0].y }),
      ...bars.map((bar) =>
        line(
          { x: -bar.halfWidth, y: bar.y },
          { x: bar.halfWidth, y: bar.y },
          groundBar,
        ),
      ),
    ],
    variants: [],
    labelVisibility: "hidden",
  };
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const geometrySource = await readFile(geometryPath);
const geometry = JSON.parse(geometrySource.toString("utf8"));
const referenceHash = hash(
  await readFile(resolve(referenceRoot, manifest.assetPath)),
);
if (
  manifest.visualAuthority !== "sole" ||
  referenceHash !== manifest.sha256 ||
  geometry.referenceId !== manifest.id ||
  geometry.referenceSha256 !== referenceHash ||
  manifest.peripheralGeometryPath !== "peripheral-geometry.json" ||
  manifest.peripheralGeometrySha256 !== hash(geometrySource)
) {
  fail("peripheral pixel map does not match the sole visual authority");
}

const symbols = [
  voltageSource(geometry.symbols["voltage-source"]),
  pulseVoltageSource(geometry.symbols["voltage-source"]),
  currentSource(geometry.symbols["current-source"]),
  ground(geometry.symbols.ground),
];
const currentArrow = geometry.annotations.currentArrow;
const styleGeometrySource = await format(
  `export const razaviPeripheralGeometry = ${JSON.stringify(
    {
      solidNodeRadius: rounded(
        geometry.annotations.solidNodeRadiusPx / geometry.pixelsPerLogical,
      ),
      groundBarStroke: rounded(
        geometry.symbols.ground.barStrokePx / geometry.pixelsPerLogical,
      ),
      currentArrowLength: rounded(
        currentArrow.totalLengthPx / geometry.pixelsPerLogical,
      ),
      arrowHeadLength: rounded(
        currentArrow.headLengthPx / geometry.pixelsPerLogical,
      ),
      arrowHeadWidth: rounded(
        currentArrow.headWidthPx / geometry.pixelsPerLogical,
      ),
      currentLabelGap: rounded(
        currentArrow.labelGapPx / geometry.pixelsPerLogical,
      ),
    },
    null,
    2,
  )} as const;\n`,
  { parser: "typescript" },
);
if (check) {
  if (
    normalize(await readFile(styleGeometryPath, "utf8")) !== styleGeometrySource
  ) {
    fail(`${relative(root, styleGeometryPath)} is stale`);
  }
} else {
  await writeFile(styleGeometryPath, styleGeometrySource, "utf8");
}
const sources = new Map();
for (const symbol of symbols) {
  const source = normalize(
    await format(JSON.stringify(symbol, null, 2), { parser: "json" }),
  );
  sources.set(symbol.id, source);
  const target = resolve(assetRoot, `${symbol.id}.symbol.json`);
  if (!target.startsWith(`${assetRoot}${sep}`))
    fail(`invalid target ${target}`);
  if (check) {
    if (normalize(await readFile(target, "utf8")) !== source)
      fail(`${relative(root, target)} is stale`);
  } else {
    await writeFile(target, source, "utf8");
  }
}

const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
for (const symbol of symbols) {
  const entry = catalog.entries.find(
    (candidate) => candidate.symbolId === symbol.id,
  );
  if (!entry) fail(`missing catalog entry ${symbol.id}`);
  entry.assetHash = hash(sources.get(symbol.id));
  entry.generation =
    symbol.id === "pulse-voltage-source"
      ? {
          kind: "razavi-pdf-vector-reference",
          referenceManifestPath:
            "fixtures/visual-reference/razavi-reference-v1/manifest.json",
          referencePath:
            "fixtures/visual-reference/razavi-reference-v1/data-converters-clock-pulse-vector-source.json",
          converterPath: "scripts/generate-razavi-peripheral-assets.mjs",
          converterVersion: 4,
        }
      : {
          kind: "razavi-raster-reference",
          referenceManifestPath:
            "fixtures/visual-reference/razavi-reference-v1/manifest.json",
          referencePath:
            "fixtures/visual-reference/razavi-reference-v1/razavi-six-panel.png",
          converterPath: "scripts/generate-razavi-peripheral-assets.mjs",
          converterVersion: 1,
        };
}
const catalogSource = normalize(
  await format(JSON.stringify(catalog, null, 2), { parser: "json" }),
);
if (check) {
  if (normalize(await readFile(catalogPath, "utf8")) !== catalogSource)
    fail("catalog is stale");
} else {
  await writeFile(catalogPath, catalogSource, "utf8");
}

console.log(
  `${check ? "Validated" : "Generated"} ${symbols.length} Razavi peripheral assets`,
);
