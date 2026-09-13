import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import {
  builtInSymbols,
  SymbolDefinitionSchema,
} from "../../packages/symbols/src/index.ts";
import {
  builtInDeviceDescriptors,
  validateDeviceDescriptors,
} from "../../packages/devices/src/index.ts";
import {
  componentRoot,
  createComponentLibraryIO,
  jsonSource,
  loadComponentLibrary,
  validateComponentDefinition,
} from "./component-library.mjs";
import {
  deriveDepletionMosSymbol,
  deriveDmosSymbol,
} from "./derived-mos-symbol.mjs";

const temporaryRoots = [];
afterEach(async () => {
  for (const root of temporaryRoots.splice(0))
    await rm(root, { recursive: true, force: true });
});
const component = async (id = "nmos") =>
  JSON.parse(
    await readFile(resolve(componentRoot, "definitions", `${id}.json`), "utf8"),
  );
async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "icm-component-library-"));
  temporaryRoots.push(root);
  await mkdir(resolve(root, "definitions"));
  await writeFile(
    resolve(root, "definitions/nmos.json"),
    await jsonSource(await component()),
  );
  await writeFile(
    resolve(root, "catalog.json"),
    await jsonSource({
      schemaVersion: 2,
      id: "razavi-symbols",
      version: 1,
      entries: ["nmos"],
      extendedEntries: [],
      deviceOrder: ["nmos"],
      semanticPrimitives: [],
    }),
  );
  return {
    root,
    path: resolve(root, "definitions/nmos.json"),
    indexPath: resolve(root, "catalog.json"),
    ...createComponentLibraryIO(root),
  };
}

describe("one-file component library", () => {
  it("projects every complete canonical definition into the unchanged runtime boundaries", async () => {
    const { components, byId, index } = await loadComponentLibrary();
    expect(new Set(components.map((c) => c.symbol.id))).toEqual(
      new Set(builtInSymbols.map((s) => s.id)),
    );
    for (const symbol of builtInSymbols) {
      expect(SymbolDefinitionSchema.parse(byId.get(symbol.id).symbol)).toEqual(
        symbol,
      );
    }
    expect(index.deviceOrder.map((id) => byId.get(id).electrical)).toEqual(
      builtInDeviceDescriptors,
    );
    expect(validateDeviceDescriptors(builtInDeviceDescriptors)).toEqual([]);
    for (const entry of components.filter((c) => c.electrical === null)) {
      expect(
        builtInDeviceDescriptors.some(
          (device) => device.symbolId === entry.symbol.id,
        ),
      ).toBe(false);
    }
  });

  it("preserves electrical parameters while a geometry generator updates its Symbol section", async () => {
    const f = await fixture();
    const before = JSON.parse(await readFile(f.path, "utf8"));
    const symbol = JSON.parse(await f.readComponentProjection(f.path));
    symbol.name = "Recalibrated NMOS";
    await f.writeComponentProjection(f.path, await jsonSource(symbol));
    const after = JSON.parse(await readFile(f.path, "utf8"));
    expect(after.symbol.name).toBe(symbol.name);
    expect(after.electrical).toEqual(before.electrical);
    expect(after.catalog).toEqual(before.catalog);
    const catalog = JSON.parse(await f.readComponentProjection(f.indexPath));
    expect(catalog.entries[0].assetHash).toBe(
      createHash("sha256")
        .update(await jsonSource(symbol))
        .digest("hex"),
    );
  });

  it("writes catalog metadata back to the same component file without copying generated hashes", async () => {
    const f = await fixture();
    const before = JSON.parse(await readFile(f.path, "utf8"));
    const catalog = JSON.parse(await f.readComponentProjection(f.indexPath));
    catalog.entries[0].palette = false;
    await f.writeComponentProjection(f.indexPath, await jsonSource(catalog));
    const after = JSON.parse(await readFile(f.path, "utf8"));
    expect(after.catalog.palette).toBe(false);
    expect(after.catalog).not.toHaveProperty("assetHash");
    expect(after.electrical).toEqual(before.electrical);
    expect(after.symbol).toEqual(before.symbol);
    expect(JSON.parse(await readFile(f.indexPath, "utf8")).entries).toEqual([
      "nmos",
    ]);
  });

  it("rejects missing registration, missing electrical registration, duplicate IDs and escaping IDs", async () => {
    const f = await fixture();
    const index = JSON.parse(await readFile(f.indexPath, "utf8"));
    for (const invalid of [
      { ...index, entries: [] },
      { ...index, entries: ["nmos", "nmos"] },
      { ...index, entries: ["../nmos"] },
      { ...index, deviceOrder: [] },
    ]) {
      await writeFile(f.indexPath, await jsonSource(invalid));
      await expect(loadComponentLibrary(f.root)).rejects.toThrow(
        /index|indexed|deviceOrder/,
      );
    }
  });

  it("requires explicit electrical support and rejects identity, pin-order and parameter drift", async () => {
    const original = await component();
    for (const edit of [
      (c) => delete c.electrical,
      (c) => (c.symbol.id = "pmos"),
      (c) => c.electrical.pinOrder.reverse(),
      (c) => c.catalog.pinOrder.reverse(),
      (c) => (c.symbol.pins[0].at.x += 1),
      (c) => c.electrical.parameters.push(c.electrical.parameters[0]),
    ]) {
      const invalid = structuredClone(original);
      edit(invalid);
      expect(() => validateComponentDefinition(invalid, "nmos")).toThrow();
    }
  });

  it("fails a malformed generator update without overwriting the canonical file", async () => {
    const f = await fixture();
    const before = await readFile(f.path, "utf8");
    const symbol = JSON.parse(await f.readComponentProjection(f.path));
    symbol.pins.reverse();
    await expect(
      f.writeComponentProjection(f.path, await jsonSource(symbol)),
    ).rejects.toThrow(/pin-order/);
    await expect(
      f.writeComponentProjection(resolve(f.root, "outside.json"), "{}"),
    ).rejects.toThrow(/not a component/);
    expect(await readFile(f.path, "utf8")).toBe(before);
  });

  it("keeps each DMOS definition derived from its declared MOS body without changing electrical facts", async () => {
    for (const id of ["ndmos", "pdmos"]) {
      const derived = await component(id);
      const base = await component(derived.catalog.derivedFrom);
      expect(deriveDmosSymbol(base.symbol, id, derived.symbol.name)).toEqual(
        derived.symbol,
      );
      expect(derived.electrical.pinOrder).toEqual(base.electrical.pinOrder);
      const changed = structuredClone(base.symbol);
      changed.viewBox.width += 10;
      expect(
        deriveDmosSymbol(changed, id, derived.symbol.name).viewBox,
      ).toEqual(changed.viewBox);
    }
  });

  it("derives depletion MOS devices by adding only one wire-width channel mark", async () => {
    for (const id of ["depletion-nmos", "depletion-pmos"]) {
      const derived = await component(id);
      const base = await component(derived.catalog.derivedFrom);
      expect(
        deriveDepletionMosSymbol(base.symbol, id, derived.symbol.name),
      ).toEqual(derived.symbol);
      expect(derived.electrical.pinOrder).toEqual(base.electrical.pinOrder);
      expect(derived.symbol.primitives.slice(0, -1)).toEqual(
        base.symbol.primitives,
      );
      expect(derived.symbol.primitives.at(-1)).toMatchObject({
        kind: "line",
        from: { x: -0.368217, y: -7.776744 },
        to: { x: -0.368217, y: 7.776744 },
        part: "depletion-channel",
        style: { strokeRole: "normal", lineCap: "butt" },
      });
      expect(derived.symbol.variants).toEqual(base.symbol.variants);
    }
  });
});
