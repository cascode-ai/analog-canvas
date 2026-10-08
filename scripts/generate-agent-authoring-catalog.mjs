import {
  loadComponentLibrary,
  readComponentProjection,
} from "./lib/component-library.mjs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { format } from "prettier";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assetRoot = resolve(root, "packages/components/definitions");
const sourceCatalogPath = resolve(assetRoot, "../catalog.json");
const outputPath = resolve(
  root,
  "packages/agent-adapter/src/agent-authoring-catalog.generated.ts",
);
const check = process.argv.includes("--check");

const normalize = (value) => `${value.replaceAll("\r\n", "\n").trimEnd()}\n`;

function fail(message) {
  throw new Error(`Agent authoring catalog: ${message}`);
}

const sourceCatalog = JSON.parse(
  await readComponentProjection(sourceCatalogPath),
);
if (
  sourceCatalog.schemaVersion !== 2 ||
  sourceCatalog.id !== "razavi-symbols" ||
  sourceCatalog.version !== 1 ||
  !Array.isArray(sourceCatalog.entries)
) {
  fail("unexpected Razavi catalog identity");
}

/** A primitive's extreme points, or null for a path that gives no bounds. */
function primitivePoints(primitive) {
  switch (primitive.kind) {
    case "line":
      return [primitive.from, primitive.to];
    case "polyline":
    case "polygon":
      return primitive.points;
    case "circle": {
      const { center, radius } = primitive;
      return [
        { x: center.x - radius, y: center.y - radius },
        { x: center.x + radius, y: center.y + radius },
      ];
    }
    case "path": {
      const box = primitive.bounds;
      return box
        ? [box, { x: box.x + box.width, y: box.y + box.height }]
        : null;
    }
    default:
      fail(`unknown primitive kind ${primitive.kind}`);
  }
}

/**
 * The ink a part draws at rotation 0, as visibleSymbolInkBounds in
 * @icm/derived measures it and wire clearance treats it as the part's body:
 * the visible drawing and pins, or the viewBox where a path gives no bounds.
 * Rounded outward to hundredths; agent-kit.test.ts holds the two equal.
 * Null for a frame that grows with its formula: its extent is the typeset
 * text's, which only the editor measures.
 */
function inkBounds(definition, variant) {
  if (definition.formulaPresentation?.adaptiveFrame) return null;
  const hiddenParts = new Set(variant?.hiddenPrimitiveParts ?? []);
  const hiddenPins = new Set(variant?.hiddenPinNames ?? []);
  const sets = [
    ...definition.primitives,
    ...(variant?.additionalPrimitives ?? []),
  ]
    .filter((primitive) => !primitive.part || !hiddenParts.has(primitive.part))
    .map(primitivePoints);
  const points = sets.some((set) => set === null)
    ? []
    : [
        ...sets.flat(),
        ...definition.pins
          .filter((pin) => !hiddenPins.has(pin.name))
          .map((pin) => pin.at),
      ];
  if (points.length === 0) return definition.viewBox;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const low = (values) => Math.floor(Math.min(...values) * 100 + 1e-6);
  const high = (values) => Math.ceil(Math.max(...values) * 100 - 1e-6);
  return {
    x: low(xs) / 100,
    y: low(ys) / 100,
    width: (high(xs) - low(xs)) / 100,
    height: (high(ys) - low(ys)) / 100,
  };
}

/** Where a pin is, from the Symbol origin at rotation 0, and where a wire
 * lands on it when that is not the pin itself. */
function pinPlace(pin) {
  const landing = pin.routing?.preferredLanding;
  return {
    at: { x: pin.at.x, y: pin.at.y },
    ...(landing ? { landing: { x: landing.x, y: landing.y } } : {}),
  };
}

/** One symbol as the Agent's place-component reads it. */
function authoringSymbol(definition, category) {
  return {
    symbolId: definition.id,
    name: definition.name,
    category,
    defaultVariantId: definition.defaultVariantId ?? null,
    labelVisibility: definition.labelVisibility ?? "shown",
    // The block draws an editable formula: place-component's signalFlow and
    // set-signal-flow apply to it, as the Properties formula does in the GUI.
    formula: Boolean(definition.formulaPresentation),
    coefficient: Boolean(definition.formulaPresentation?.supportsCoefficient),
    // As placed without a variant: in its default variant, if it has one.
    bounds: inkBounds(
      definition,
      definition.variants.find(
        (variant) => variant.id === definition.defaultVariantId,
      ),
    ),
    pins: definition.pins.map((pin) => ({
      name: pin.name,
      role: pin.role,
      direction: pin.direction,
      visibility: pin.presentation.visibility,
      ...pinPlace(pin),
    })),
    variants: definition.variants.map((variant) => ({
      id: variant.id,
      hiddenPinNames: variant.hiddenPinNames,
      // A hidden pin a variant still offers to wires, elsewhere on its art,
      // such as the 3-terminal MOS body once it leaves its Cell's default.
      ...(variant.auxiliaryPins?.length
        ? {
            auxiliaryPins: variant.auxiliaryPins.map((pin) => ({
              name: pin.name,
              direction: pin.direction,
              ...pinPlace(pin),
            })),
          }
        : {}),
      bounds: inkBounds(definition, variant),
    })),
  };
}

/** A reviewed entry's symbol, checked against the catalog's claims. */
async function reviewedDefinition(entry) {
  if (
    entry.visualAuthority?.kind !== "razavi-reference-v1" &&
    !(entry.provenance === "house" && entry.houseReason)
  ) {
    fail(`entry claims neither Razavi nor house provenance: ${entry.symbolId}`);
  }
  const assetPath = resolve(assetRoot, entry.assetPath);
  if (!assetPath.startsWith(`${assetRoot}${sep}`)) {
    fail(`asset path escapes catalog root: ${entry.symbolId}`);
  }
  const definition = JSON.parse(await readComponentProjection(assetPath));
  if (definition.schemaVersion !== 1 || definition.id !== entry.symbolId) {
    fail(`asset identity mismatch for ${entry.symbolId}`);
  }
  const pinOrder = definition.pins.map((pin) => pin.name);
  if (JSON.stringify(pinOrder) !== JSON.stringify(entry.pinOrder)) {
    fail(`pin order mismatch for ${entry.symbolId}`);
  }
  return definition;
}

const symbols = [];
for (const entry of sourceCatalog.entries) {
  // This is the reviewed, palette-visible product boundary: an Agent places
  // what a person can pick from the palette. That includes the house entries
  // drawn for primitives the textbook never drew (the controlled sources, the
  // plain and SPDT switches, the voltage-controlled switch, Diff gm, ADC and
  // DAC, #1303); their provenance claims no textbook authority. Manual-only
  // and provisional assets remain unavailable without an explicit human fact.
  if (entry.reviewStatus !== "reviewed" || entry.palette !== true) continue;
  symbols.push(
    authoringSymbol(await reviewedDefinition(entry), entry.category),
  );
}

// A 3- or 4-input gate is a palette gate with more inputs: a person reaches
// it through that gate's Inputs choice in Properties, so an Agent places it
// too (#1457).
for (const entry of sourceCatalog.entries) {
  const generation = entry.generation;
  if (entry.reviewStatus !== "reviewed" || generation?.inputCount === undefined)
    continue;
  const base = symbols.find(
    (symbol) => symbol.symbolId === generation.sourceSymbolId,
  );
  if (
    !base ||
    entry.symbolId !== `${generation.sourceSymbolId}-${generation.inputCount}`
  )
    fail(
      `multi-input gate is no palette gate's Inputs choice: ${entry.symbolId}`,
    );
  symbols.push(authoringSymbol(await reviewedDefinition(entry), base.category));
}

// The palette's extended devices (DMOS, depletion MOS) are a reviewed MOS
// symbol with a drift region or a channel bar drawn on: a person picks them
// from the same palette, so an Agent places them too (#1425).
const library = await loadComponentLibrary();
for (const id of library.index.extendedEntries) {
  const component = library.byId.get(id);
  const base = symbols.find(
    (symbol) => symbol.symbolId === component.catalog.derivedFrom,
  );
  if (!base)
    fail(`extended entry derives from no reviewed palette symbol: ${id}`);
  symbols.push(authoringSymbol(component.symbol, base.category));
}

if (symbols.length === 0) fail("no reviewed palette symbols");
for (const symbolId of ["nmos", "pmos", "ground", "port", "port-filled"]) {
  if (!symbols.some((symbol) => symbol.symbolId === symbolId)) {
    fail(`missing required authoring symbol: ${symbolId}`);
  }
}

const authoringCatalog = {
  format: "icm-razavi-authoring-catalog-v1",
  catalog: {
    schemaVersion: sourceCatalog.schemaVersion,
    id: sourceCatalog.id,
    version: sourceCatalog.version,
  },
  symbols,
  primitives: [
    {
      id: "vdd-rail",
      kind: "power-rail",
      editKind: "add_power_rail",
      powerDomain: "vdd",
      forbiddenSymbolId: "vdd",
    },
  ],
};

const output = normalize(
  await format(
    `// Generated by scripts/generate-agent-authoring-catalog.mjs. Do not edit.\nexport const agentRazaviAuthoringCatalog = ${JSON.stringify(authoringCatalog, null, 2)} as const;\n`,
    { parser: "typescript" },
  ),
);

if (check) {
  const existing = normalize(await readFile(outputPath, "utf8"));
  if (existing !== output) {
    fail("generated artifact is stale; run pnpm agent-kit:catalog");
  }
} else {
  await writeFile(outputPath, output, "utf8");
}
