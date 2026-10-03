import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  loadFullCatalog,
  catalogMarkdown,
} from "../../../packages/virtuoso-import/dist/adapter/index.js";
import { builtInSymbols } from "../../../packages/symbols/dist/index.js";
test("full catalog covers installed symbol assets without claiming conversion support", async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const catalog = await loadFullCatalog({ root });
  assert.deepEqual(
    catalog.symbols.map((s) => s.id).sort(),
    builtInSymbols.map((s) => s.id).sort(),
  );
  assert.equal(
    catalog.symbols.filter((s) => s.conversion === "supported").length,
    12,
  );
  for (const symbol of ["npn", "pnp"]) {
    const entry = catalog.symbols.find((s) => s.id === symbol);
    assert.equal(entry.conversion, "supported");
    assert.deepEqual(entry.pins, ["C", "B", "E"]);
  }
  assert.equal(
    catalog.symbols.find((s) => s.id === "adc").conversion,
    "not-implemented",
  );
  assert.equal(
    catalog.symbols.find((s) => s.id === "ground").conversion,
    "supported",
  );
  assert.match(catalogMarkdown(catalog), /adc/);
});
