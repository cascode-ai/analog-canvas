import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { sampleCount, sha256 } from "./scaling-metrics.mjs";

export const productModule = (checkout, name) =>
  import(pathToFileURL(join(checkout, "packages", name, "dist/index.js")).href);

async function measureModel(checkout, file) {
  const { parseProject } = await productModule(checkout, "project-protocol");
  const { createProjectSymbolResolver, createSymbolCatalog, builtInSymbols } =
    await productModule(checkout, "symbols");
  const { executeTransaction } = await productModule(checkout, "edit-engine");
  const { parseProjectSnapshot } = await productModule(checkout, "model");
  const { buildProjectConnectivityIndex } = await productModule(
    checkout,
    "derived",
  );
  const catalog = createSymbolCatalog(builtInSymbols);
  const bytes = readFileSync(file, "utf8");
  const metrics = { parse: [], moveTransaction: [] };
  let signatures;
  for (let i = 0; i <= sampleCount.edit; i++) {
    let start = performance.now();
    const project = parseProject(bytes);
    const parse = performance.now() - start;
    const snapshot = parseProjectSnapshot(project);
    const doc = snapshot.documents[0],
      instance = doc.instances[0];
    const { x, y } = instance.placement.position;
    const position = { x: x + 10, y: y + 10 };
    const resolver = createProjectSymbolResolver(snapshot, catalog);
    buildProjectConnectivityIndex(snapshot, resolver);
    const transaction = {
      transactionId: "scaling",
      documentId: doc.id,
      expectedRevision: doc.revision,
      actor: { kind: "human", id: "benchmark" },
      dryRun: false,
      edits: [{ kind: "move_instance", instanceId: instance.id, position }],
    };
    start = performance.now();
    const response = executeTransaction(doc, transaction, {
      symbolResolver: resolver,
    });
    const moveTransaction = performance.now() - start;
    assert.ok(response.ok, JSON.stringify(response.diagnostics));
    assert.equal(response.document.revision, doc.revision + 1);
    assert.deepEqual(
      response.document.instances.find((item) => item.id === instance.id)
        .placement.position,
      position,
    );
    if (!signatures)
      signatures = {
        parsedSnapshot: sha256(JSON.stringify(project)),
        movedSnapshot: sha256(JSON.stringify(response.document)),
      };
    if (i > 0) {
      metrics.parse.push(parse);
      metrics.moveTransaction.push(moveTransaction);
    }
  }
  return { metrics, signatures };
}

export async function sharedSupply(checkout, project) {
  const { createProjectSymbolResolver, builtInSymbols } = await productModule(
    checkout,
    "symbols",
  );
  const { buildProjectConnectivityIndex, resolveEndpointConnection } =
    await productModule(checkout, "derived");
  const resolver = createProjectSymbolResolver(project, builtInSymbols);
  const index = buildProjectConnectivityIndex(project, resolver);
  const top = index.globalNets
    .get("vdd")
    ?.nets.find((n) => n.documentId === project.topDocumentId);
  assert.ok(top, "Expected the top-level shared VDD net");
  const document = project.documents.find((cell) => cell.id === top.documentId);
  const endpoint = { kind: "terminal", instanceId: "Rtop", pinName: "1" };
  const point = resolveEndpointConnection(
    document,
    resolver,
    endpoint,
  )?.contactPoint;
  assert.ok(point, "Missing top VDD resistor contact");
  return { index, top, point };
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const [checkout, file] = process.argv.slice(2);
  console.log(JSON.stringify(await measureModel(checkout, file)));
}
