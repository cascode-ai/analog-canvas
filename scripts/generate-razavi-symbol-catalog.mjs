import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { format } from "prettier";

import { loadRazaviReferenceAuthority } from "./lib/razavi-reference-authority.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assetRoot = resolve(root, "packages/symbols/assets/razavi-v1");
const catalogPath = resolve(assetRoot, "catalog.json");
const generatedPath = resolve(
  root,
  "packages/symbols/src/razavi-catalog.generated.ts",
);
const check = process.argv.includes("--check");

const normalize = (value) => `${value.replaceAll("\r\n", "\n").trimEnd()}\n`;
const hash = (value) => createHash("sha256").update(value).digest("hex");

function fail(message) {
  throw new Error(`Razavi catalog: ${message}`);
}

const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
if (
  catalog.schemaVersion !== 2 ||
  catalog.id !== "razavi-symbols" ||
  catalog.version !== 1
) {
  fail("unexpected catalog identity");
}
if (!Array.isArray(catalog.entries) || catalog.entries.length === 0) {
  fail("catalog must contain entries");
}

const authorityRoot = resolve(
  root,
  "fixtures/visual-reference/razavi-reference-v1",
);
const { manifest: authorityManifest, files: authorityFiles } =
  await loadRazaviReferenceAuthority(authorityRoot);
if (
  typeof authorityManifest.fidelityTargetsPath !== "string" ||
  typeof authorityManifest.fidelityTargetsSha256 !== "string"
) {
  fail("invalid fidelity registry authority");
}
const fidelityRegistrySource = authorityFiles.get(
  authorityManifest.fidelityTargetsPath,
);
const fidelityRegistry = JSON.parse(fidelityRegistrySource.toString("utf8"));
if (
  fidelityRegistry.schemaVersion !== 1 ||
  fidelityRegistry.referenceId !== authorityManifest.id ||
  !Array.isArray(fidelityRegistry.targets) ||
  fidelityRegistry.targets.length === 0
) {
  fail("invalid fidelity registry identity");
}
const fidelityTargetIds = new Set();
const formalKinds = new Set(["port", "wire", "route-current-arrow"]);
for (const target of fidelityRegistry.targets) {
  if (
    typeof target.id !== "string" ||
    fidelityTargetIds.has(target.id) ||
    typeof target.measurementPath !== "string" ||
    typeof target.measurementKey !== "string"
  ) {
    fail(`invalid or duplicate fidelity target ${target.id ?? "<unknown>"}`);
  }
  if (target.rotation !== undefined && !Number.isFinite(target.rotation)) {
    fail(`invalid rotation for fidelity target ${target.id}`);
  }
  fidelityTargetIds.add(target.id);
  const hasSymbol = typeof target.symbolId === "string";
  const hasFormal = formalKinds.has(target.formalKind);
  if (hasSymbol === hasFormal) {
    fail(
      `fidelity target ${target.id} must select exactly one Symbol or formal scene`,
    );
  }
  const measurementSource = authorityFiles.get(target.measurementPath);
  if (!measurementSource) {
    fail(`fidelity measurement is not manifest-pinned for ${target.id}`);
  }
  const measurementFile = JSON.parse(measurementSource.toString("utf8"));
  const collection = target.measurementCollection ?? "symbols";
  const measurement = measurementFile[collection]?.[target.measurementKey];
  if (!measurement) {
    fail(`missing fidelity measurement for ${target.id}`);
  }
  const window =
    target.window ?? measurement.window ?? measurement.cropWindowPx;
  if (
    !window ||
    !Number.isInteger(window.width) ||
    window.width <= 0 ||
    !Number.isInteger(window.height) ||
    window.height <= 0 ||
    (window.minX !== undefined && !Number.isFinite(window.minX)) ||
    (window.minY !== undefined && !Number.isFinite(window.minY))
  ) {
    fail(
      `fidelity target ${target.id} requires a fixed reference-owned window`,
    );
  }
}

const symbols = [];
const ids = new Set();
const assetPaths = new Set();
for (const entry of catalog.entries) {
  if (ids.has(entry.symbolId)) {
    fail(`duplicate symbol ID ${entry.symbolId}`);
  }
  ids.add(entry.symbolId);
  if (
    entry.reviewStatus !== "reviewed" &&
    entry.reviewStatus !== "provisional"
  ) {
    fail(`invalid review status for ${entry.symbolId}`);
  }
  if (
    !entry.palette &&
    entry.automaticMappings.length === 0 &&
    !entry.manualOnlyReason
  ) {
    fail(`${entry.symbolId} is unreachable and lacks a manual-only reason`);
  }
  const provenance = entry.provenance ?? "razavi-reference-v1";
  if (provenance !== "razavi-reference-v1" && provenance !== "house") {
    fail(`invalid provenance for ${entry.symbolId}`);
  }
  if (provenance === "house") {
    // Drawn here, for a primitive the reference never contained. It must not
    // borrow the authority it does not have, and it must say why it exists.
    if (entry.visualAuthority) {
      fail(`house entry ${entry.symbolId} must not claim visual authority`);
    }
    if (!entry.houseReason) {
      fail(
        `house entry ${entry.symbolId} must state why the reference lacks it`,
      );
    }
  } else {
    if (entry.houseReason) {
      fail(
        `${entry.symbolId} states a house reason but claims Razavi authority`,
      );
    }
    if (entry.visualAuthority?.kind !== "razavi-reference-v1") {
      fail(`invalid visual authority for ${entry.symbolId}`);
    }
    const manifestPath = resolve(
      root,
      entry.visualAuthority.referenceManifestPath,
    );
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    if (
      manifest.id !== "razavi-reference-v1" ||
      manifest.visualAuthority !== "sole"
    ) {
      fail(`invalid Razavi Reference authority for ${entry.symbolId}`);
    }
    if (entry.visualAuthority.referencePaths.length === 0) {
      fail(`missing Razavi Reference path for ${entry.symbolId}`);
    }
    for (const referencePath of entry.visualAuthority.referencePaths) {
      if (
        !referencePath.startsWith(
          "fixtures/visual-reference/razavi-reference-v1/",
        )
      ) {
        fail(`reference path escapes Razavi authority for ${entry.symbolId}`);
      }
      await readFile(resolve(root, referencePath));
    }
    if (entry.visualAuthority.calibrationPath) {
      await readFile(resolve(root, entry.visualAuthority.calibrationPath));
    }
  }
  if (assetPaths.has(entry.assetPath)) {
    fail(`duplicate asset path ${entry.assetPath}`);
  }
  assetPaths.add(entry.assetPath);

  const assetPath = resolve(assetRoot, entry.assetPath);
  if (!assetPath.startsWith(`${assetRoot}${sep}`)) {
    fail(`asset path escapes catalog root: ${entry.assetPath}`);
  }
  const assetSource = normalize(await readFile(assetPath, "utf8"));
  const symbol = JSON.parse(assetSource);
  if (symbol.schemaVersion !== 1 || symbol.id !== entry.symbolId) {
    fail(`asset identity mismatch for ${entry.symbolId}`);
  }
  const pinOrder = symbol.pins.map((pin) => pin.name);
  if (pinOrder.join("\u0000") !== entry.pinOrder.join("\u0000")) {
    fail(`pin order mismatch for ${entry.symbolId}`);
  }
  for (const pin of symbol.pins) {
    if (pin.at.x % 10 !== 0 || pin.at.y % 10 !== 0) {
      fail(`off-grid pin ${entry.symbolId}.${pin.name}`);
    }
  }
  const assetHash = hash(assetSource);
  if (check && entry.assetHash !== assetHash) {
    fail(`asset hash mismatch for ${entry.symbolId}`);
  }
  entry.assetHash = assetHash;
  symbols.push(symbol);
}

const symbolsById = new Map(symbols.map((symbol) => [symbol.id, symbol]));
for (const target of fidelityRegistry.targets) {
  if (!target.symbolId) continue;
  const symbol = symbolsById.get(target.symbolId);
  if (!symbol) {
    fail(
      `fidelity target ${target.id} references unknown Symbol ${target.symbolId}`,
    );
  }
  if (target.useVariant && !symbol.variants?.length) {
    fail(`fidelity target ${target.id} requests a missing Symbol variant`);
  }
}

const semanticIds = new Set();
for (const primitive of catalog.semanticPrimitives ?? []) {
  if (semanticIds.has(primitive.id)) {
    fail(`duplicate semantic primitive ${primitive.id}`);
  }
  semanticIds.add(primitive.id);
  if (primitive.disposition !== "semantic-primitive") {
    fail(`invalid semantic disposition for ${primitive.id}`);
  }
}

const catalogSource = normalize(
  await format(JSON.stringify(catalog, null, 2), { parser: "json" }),
);
const generatedSource = normalize(
  await format(
    `
// Generated by scripts/generate-razavi-symbol-catalog.mjs. Do not edit.
import type { SymbolDefinition } from "./schema.js";
import type {
  RazaviSemanticPrimitiveEntry,
  RazaviSymbolCatalogEntry,
} from "./razavi-catalog.js";

export const razaviSymbolCatalogIdentity = ${JSON.stringify(
      {
        schemaVersion: catalog.schemaVersion,
        id: catalog.id,
        version: catalog.version,
      },
      null,
      2,
    )} as const;

export const razaviSymbolCatalogEntries: readonly RazaviSymbolCatalogEntry[] = ${JSON.stringify(
      catalog.entries,
      null,
      2,
    )};

export const razaviSemanticPrimitives: readonly RazaviSemanticPrimitiveEntry[] = ${JSON.stringify(
      catalog.semanticPrimitives ?? [],
      null,
      2,
    )};

export const razaviCatalogSymbols: readonly SymbolDefinition[] = ${JSON.stringify(
      symbols,
      null,
      2,
    )};
`,
    { parser: "typescript" },
  ),
);

if (check) {
  const checkedCatalog = normalize(await readFile(catalogPath, "utf8"));
  if (checkedCatalog !== catalogSource)
    fail("catalog formatting or hashes are stale");
  const checkedGenerated = normalize(await readFile(generatedPath, "utf8"));
  if (checkedGenerated !== generatedSource)
    fail("generated runtime adapter is stale");
  console.log(
    `Validated ${symbols.length} Razavi symbol assets and ${semanticIds.size} semantic primitive`,
  );
} else {
  await writeFile(catalogPath, catalogSource, "utf8");
  await writeFile(generatedPath, generatedSource, "utf8");
  console.log(
    `Generated ${symbols.length} Razavi symbol assets and ${semanticIds.size} semantic primitive`,
  );
}
