import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { format } from "prettier";

export const componentRoot = resolve(
  import.meta.dirname,
  "../../packages/components",
);
export const definitionRoot = resolve(componentRoot, "definitions");
export const catalogPath = resolve(componentRoot, "catalog.json");
export const jsonSource = (value) =>
  format(JSON.stringify(value, null, 2), { parser: "json" });
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const fail = (message) => {
  throw new Error(`Component library: ${message}`);
};

/** One canonical file owns both symbol and electrical facts. */
export function validateComponentDefinition(component, id) {
  if (!/^[a-z][a-z0-9-]*$/.test(id)) fail(`invalid component ID ${id}`);
  if (component?.schemaVersion !== 1 || component.symbol?.id !== id) {
    fail(`${id}: schema or filename/Symbol identity mismatch`);
  }
  if (
    !same(Object.keys(component).sort(), [
      "catalog",
      "electrical",
      "schemaVersion",
      "symbol",
    ])
  ) {
    fail(`${id}: expected exactly schemaVersion, symbol, electrical, catalog`);
  }
  const { symbol, electrical, catalog } = component;
  if (symbol.schemaVersion !== 1 || !Array.isArray(symbol.pins))
    fail(`${id}: invalid Symbol`);
  const pins = symbol.pins.map((pin) => pin.name);
  if (new Set(pins).size !== pins.length) fail(`${id}: duplicate pin names`);
  for (const pin of symbol.pins) {
    if (
      !Number.isFinite(pin.at?.x) ||
      !Number.isFinite(pin.at?.y) ||
      pin.at.x % 10 ||
      pin.at.y % 10
    )
      fail(`${id}: off-grid pin ${pin.name}`);
  }
  if (
    !catalog ||
    catalog.symbolId !== id ||
    !["razavi", "extended"].includes(catalog.library)
  )
    fail(`${id}: invalid catalog identity`);
  if (catalog.library === "razavi") {
    if (catalog.assetPath !== `${id}.json` || !same(catalog.pinOrder, pins))
      fail(`${id}: catalog path or pin-order mismatch`);
    if (Object.hasOwn(catalog, "assetHash"))
      fail(`${id}: assetHash is generated, not authored`);
  }
  if (electrical !== null) {
    if (electrical?.symbolId !== id || !same(electrical.pinOrder, pins))
      fail(`${id}: electrical/Symbol pin-order mismatch`);
    if (!Array.isArray(electrical.parameters))
      fail(`${id}: invalid electrical parameters`);
    const names = electrical.parameters.map((parameter) => parameter.name);
    if (new Set(names).size !== names.length)
      fail(`${id}: duplicate electrical parameters`);
  }
  return component;
}

export async function readComponent(path) {
  return validateComponentDefinition(
    JSON.parse(await readFile(path, "utf8")),
    basename(path, ".json"),
  );
}

/** The index owns ordering and library identity only, never component facts. */
export async function loadComponentLibrary(root = componentRoot) {
  const index = JSON.parse(
    await readFile(resolve(root, "catalog.json"), "utf8"),
  );
  if (
    index.schemaVersion !== 2 ||
    index.id !== "razavi-symbols" ||
    index.version !== 1 ||
    !Array.isArray(index.entries) ||
    !Array.isArray(index.extendedEntries) ||
    !Array.isArray(index.deviceOrder)
  )
    fail("invalid library index");
  const ids = [...index.entries, ...index.extendedEntries];
  if (
    new Set(ids).size !== ids.length ||
    ids.some((id) => typeof id !== "string" || !/^[a-z][a-z0-9-]*$/.test(id))
  )
    fail("duplicate or invalid indexed component ID");
  const files = await readdir(resolve(root, "definitions"));
  if (
    !same(
      files.filter((file) => file.endsWith(".json")).sort(),
      ids.map((id) => `${id}.json`).sort(),
    )
  )
    fail(
      "definition files and index differ; register every component exactly once",
    );
  const components = await Promise.all(
    ids.map((id) => readComponent(resolve(root, "definitions", `${id}.json`))),
  );
  const byId = new Map(
    components.map((component) => [component.symbol.id, component]),
  );
  for (const [library, group] of [
    ["razavi", index.entries],
    ["extended", index.extendedEntries],
  ]) {
    for (const id of group)
      if (byId.get(id).catalog.library !== library)
        fail(`${id}: library membership mismatch`);
  }
  const electricalIds = components
    .filter((component) => component.electrical !== null)
    .map((component) => component.symbol.id)
    .sort();
  if (!same([...index.deviceOrder].sort(), electricalIds))
    fail("deviceOrder must name every electrical definition exactly once");
  return { index, components, byId };
}

export async function projectRazaviCatalog({ index, byId }) {
  const {
    extendedEntries: _extended,
    deviceOrder: _devices,
    ...catalog
  } = index;
  return {
    ...catalog,
    entries: await Promise.all(
      index.entries.map(async (id) => {
        const component = byId.get(id);
        const { library: _library, ...metadata } = component.catalog;
        const assetHash = createHash("sha256")
          .update(await jsonSource(component.symbol))
          .digest("hex");
        // Retain the established deterministic catalog serialization, even
        // though the byte hash is no longer a separately authored fact.
        return Object.fromEntries(
          Object.entries(metadata).flatMap(([key, value]) =>
            key === "assetPath"
              ? [
                  [key, value],
                  ["assetHash", assetHash],
                ]
              : [[key, value]],
          ),
        );
      }),
    ),
  };
}

/**
 * Family geometry generators consume the existing Symbol DSL/catalog views.
 * This explicit authoring adapter projects those sections from component files;
 * it never reads a second copy of the definitions or a generated runtime file.
 */
export function createComponentLibraryIO(root = componentRoot) {
  const definitionRoot = resolve(root, "definitions");
  const catalogPath = resolve(root, "catalog.json");
  async function readComponentProjection(path) {
    path = resolve(path);
    if (path === catalogPath)
      return jsonSource(
        await projectRazaviCatalog(await loadComponentLibrary(root)),
      );
    if (dirname(path) !== definitionRoot || !path.endsWith(".json"))
      fail(`not a component projection: ${path}`);
    return jsonSource((await readComponent(path)).symbol);
  }

  /** Recalibration replaces only symbol/catalog sections; instance and electrical data are never inferred. */
  async function writeComponentProjection(path, source) {
    path = resolve(path);
    const value = JSON.parse(source);
    if (path === catalogPath) {
      const { index, byId } = await loadComponentLibrary(root);
      if (
        value.schemaVersion !== index.schemaVersion ||
        value.id !== index.id ||
        value.version !== index.version ||
        !same(
          value.entries
            .map((entry) => entry.symbolId)
            .slice()
            .sort(),
          [...index.entries].sort(),
        )
      )
        fail(
          "a geometry generator cannot add/remove components; author and register the complete definition first",
        );
      // Validate the complete update before writing any of its files.
      const updates = value.entries.map((entry) => {
        const { assetHash: _hash, ...metadata } = entry;
        return validateComponentDefinition(
          {
            ...byId.get(entry.symbolId),
            catalog: { library: "razavi", ...metadata },
          },
          entry.symbolId,
        );
      });
      for (const component of updates) {
        const target = resolve(definitionRoot, `${component.symbol.id}.json`);
        const next = await jsonSource(component);
        if (next !== (await readFile(target, "utf8")))
          await writeFile(target, next);
      }
      const nextIndex = {
        ...index,
        entries: value.entries.map((entry) => entry.symbolId),
        semanticPrimitives: value.semanticPrimitives,
      };
      const next = await jsonSource(nextIndex);
      if (next !== (await readFile(path, "utf8"))) await writeFile(path, next);
      return;
    }
    if (dirname(path) !== definitionRoot || !path.endsWith(".json"))
      fail(`not a component projection: ${path}`);
    const component = await readComponent(path);
    const updated = validateComponentDefinition(
      { ...component, symbol: value },
      component.symbol.id,
    );
    await writeFile(path, await jsonSource(updated));
  }
  return { readComponentProjection, writeComponentProjection };
}

export const { readComponentProjection, writeComponentProjection } =
  createComponentLibraryIO();
