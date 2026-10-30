import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { cpus } from "node:os";
import { editSampling } from "./lib/edit-performance.mjs";
import { compareEditPerformance } from "./lib/edit-performance-comparison.mjs";

import { createAgentCircuitService } from "../packages/agent-adapter/dist/index.js";
import {
  executeTransaction,
  prepareTransaction,
  parseProjectSnapshot,
} from "../packages/edit-engine/dist/index.js";
import { buildProjectConnectivityIndex } from "../packages/derived/dist/index.js";
import {
  CircuitProjectSchema,
  createEmptyProject,
  createRoutePath,
} from "../packages/model/dist/index.js";
import { serializeProject } from "../packages/project-protocol/dist/index.js";
import { renderDocumentSvg } from "../packages/render-svg/dist/index.js";
import { importSpiceSources } from "../packages/spice/dist/index.js";
import {
  InMemorySymbolResolver,
  builtInSymbols,
  createSymbolCatalog,
  createProjectSymbolResolver,
} from "../packages/symbols/dist/index.js";

const budgets = {
  generateProject: 2000,
  serialize: 1000,
  renderSvg: 2000,
  agentSnapshot: 1000,
  editTransaction: 1000,
  connectivityIndex: 1000,
  connectivityRenderSvg: 2000,
  spiceImport: 2000,
  preparedCommit: 1000,
  libraryOverlay: 1000,
};

const args = process.argv.slice(2);
if (
  args.length > 1 ||
  args.some(
    (arg) => arg !== "--verify-edit-budgets" && !arg.startsWith("--slow-edit="),
  )
)
  throw new Error(
    "Use no argument, --verify-edit-budgets, or --slow-edit=NAME",
  );
const verifyingBudgets = args.includes("--verify-edit-budgets");
const slowEdit = args
  .find((arg) => arg.startsWith("--slow-edit="))
  ?.slice("--slow-edit=".length);
if (
  slowEdit !== undefined &&
  !["rotate", "undo", "paste", "wireCommit"].includes(slowEdit)
)
  throw new Error(`Unknown editing workload: ${slowEdit}`);
const outputDirectory = resolve("output/performance");
const comparison = await compareEditPerformance(
  outputDirectory,
  verifyingBudgets,
  slowEdit,
);
if (verifyingBudgets) {
  const report = { mode: "rejection-verification", ...comparison };
  await writeFile(
    resolve(outputDirectory, "edit-rejection.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(report.passed ? 0 : 1);
}
const editWorkloads = comparison.runs[0].result?.editWorkloads;
if (
  !editWorkloads ||
  comparison.runs[0].exitCode !== (comparison.runs[0].result.passed ? 0 : 1)
)
  throw new Error(
    `Editing measurement failed: ${JSON.stringify(comparison.runs[0])}`,
  );
const { createEditPerformanceProject } = await import(
  pathToFileURL(resolve(outputDirectory, "edit-workloads.mjs")).href
);
async function measure(action) {
  const started = performance.now();
  const result = await action();
  return { result, milliseconds: performance.now() - started };
}

const generated = await measure(createEditPerformanceProject);
const project = generated.result;
let document = project.documents[0];
const resolver = new InMemorySymbolResolver(builtInSymbols);
const connectivityProject = createEmptyProject(
  "connectivity-performance",
  "Connectivity Performance",
);
const connectivityDocument = connectivityProject.documents[0];
for (let index = 0; index < 200; index += 1) {
  const netId = `net-${index}`;
  const leftJunctionId = `J${index}-left`;
  const rightJunctionId = `J${index}-right`;
  const y = index * 20;
  connectivityDocument.nets.push({ id: netId, terminals: [] });
  connectivityDocument.junctions.push(
    { id: leftJunctionId, netId, position: { x: 0, y } },
    { id: rightJunctionId, netId, position: { x: 40, y } },
  );
  const route = createRoutePath({
    id: `route-${index}`,
    netId,
    start: { kind: "junction", junctionId: leftJunctionId },
    end: { kind: "junction", junctionId: rightJunctionId },
    bends: [],
    modes: ["manual"],
  });
  connectivityDocument.routes.push(route);
  const annotationId = `label-${index}`;
  connectivityDocument.annotations.push({
    id: annotationId,
    kind: "net-label",
    binding: { kind: "net-name", netId },
    netId,
    anchor: {
      kind: "route",
      routeId: route.id,
      legId: route.legs[0].id,
      t: 0.5,
      normalOffset: 10,
      direction: "forward",
      orientation: "horizontal",
      fallbackPosition: { x: 20, y: y - 10 },
    },
    alignment: "middle",
    rotation: 0,
    locked: false,
  });
  connectivityDocument.connectivityEvidence.push({
    id: `claim-${index}`,
    kind: "name-claim",
    netId,
    name: `NET_${index}`,
    owner: { kind: "net-label", annotationId },
    scope: "local",
  });
}
const validatedConnectivityProject =
  CircuitProjectSchema.parse(connectivityProject);

// Catalog loading is a boundary cost; an edit must not revalidate unused
// artwork. Keep the Project fixed and measure a 10,000-definition catalog's
// overlay plus the actual placed-instance lookups after loading it once.
const catalogLoad = await measure(() =>
  createSymbolCatalog([
    ...builtInSymbols,
    ...Array.from({ length: 10_000 }, (_, index) => ({
      ...builtInSymbols.find((symbol) => symbol.id === "resistor"),
      id: `unused-${index}`,
    })),
  ]),
);
const largeCatalog = catalogLoad.result;
const ownedProject = parseProjectSnapshot(project);
createProjectSymbolResolver(ownedProject, largeCatalog);
const libraryOverlay = await measure(() => {
  const current = createProjectSymbolResolver(ownedProject, largeCatalog);
  return ownedProject.documents[0].instances.map((instance) =>
    current.resolve(instance.symbolId),
  );
});
if (libraryOverlay.result.some((symbol) => !symbol))
  throw new Error("Catalog lost a placed symbol");
const ownedDocument = ownedProject.documents[0];
const preparedRequest = {
  transactionId: "prepared-benchmark",
  documentId: ownedDocument.id,
  expectedRevision: ownedDocument.revision,
  actor: { kind: "human", id: "benchmark" },
  dryRun: true,
  edits: [
    { kind: "move_instance", instanceId: "R1", position: { x: 80, y: 80 } },
  ],
};
const preparation = prepareTransaction(ownedDocument, preparedRequest, {
  symbolResolver: resolver,
});
if (!preparation.result.ok) throw new Error("Preparation failed");
const preparedCommit = await measure(() =>
  executeTransaction(
    ownedDocument,
    { ...preparedRequest, dryRun: false },
    {
      symbolResolver: resolver,
      preparedTransactions: [preparation.prepared],
    },
  ),
);
if (
  !preparedCommit.result.ok ||
  preparedCommit.result.document.revision !== ownedDocument.revision + 1
)
  throw new Error("Prepared commit lost its revision fence");

const serialized = await measure(() => serializeProject(project));
const rendered = await measure(() =>
  renderDocumentSvg(document, resolver, { title: project.name }),
);
const service = createAgentCircuitService({
  agentId: "performance-agent",
  store: {
    getDocument: () => document,
    commitDocument: (next) => {
      document = next;
    },
  },
  resolver,
  permissions: {
    snapshot: true,
    render: true,
    sourceSpans: false,
    edit: { geometry: true, connectivity: false, presentation: false },
  },
});
const snapshot = await measure(() =>
  service.handle({
    apiVersion: "3.0",
    requestId: "performance-snapshot",
    operation: "snapshot",
    documentId: document.id,
  }),
);
const edit = await measure(() =>
  service.handle({
    apiVersion: "3.0",
    requestId: "performance-edit",
    operation: "transact",
    documentId: document.id,
    transactionId: "performance-edit-1",
    expectedRevision: document.revision,
    edits: [
      { kind: "move_instance", instanceId: "R1", position: { x: 80, y: 80 } },
    ],
  }),
);
const connectivityIndex = await measure(() =>
  buildProjectConnectivityIndex(validatedConnectivityProject, resolver),
);
const connectivityRender = await measure(() =>
  renderDocumentSvg(validatedConnectivityProject.documents[0], resolver, {
    title: validatedConnectivityProject.name,
  }),
);
const sourcePath = resolve("fixtures/spice-baseline/core.cir");
const modelPath = resolve("fixtures/spice-baseline/models.lib");
const imported = await measure(async () =>
  importSpiceSources(
    [
      { path: "core.cir", bytes: await readFile(sourcePath) },
      { path: "models.lib", bytes: await readFile(modelPath) },
    ],
    "core.cir",
  ),
);
const measurements = {
  generateProject: generated.milliseconds,
  serialize: serialized.milliseconds,
  renderSvg: rendered.milliseconds,
  agentSnapshot: snapshot.milliseconds,
  editTransaction: edit.milliseconds,
  connectivityIndex: connectivityIndex.milliseconds,
  connectivityRenderSvg: connectivityRender.milliseconds,
  spiceImport: imported.milliseconds,
  libraryOverlay: libraryOverlay.milliseconds,
  preparedCommit: preparedCommit.milliseconds,
};
const failures = Object.entries(measurements).filter(
  ([name, value]) => value > budgets[name],
);
for (const [name, result] of Object.entries(editWorkloads)) {
  if (result.passed === false) failures.push([name, result.medianMs]);
}
const report = {
  version: "0.1.0",
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpu: cpus()[0]?.model,
    runner: process.env.RUNNER_OS,
    sha: process.env.GITHUB_SHA,
  },
  fixture: {
    instances: 500,
    serializedBytes: Buffer.byteLength(serialized.result),
    svgBytes: Buffer.byteLength(rendered.result),
  },
  connectivityFixture: {
    nets: connectivityDocument.nets.length,
    routes: connectivityDocument.routes.length,
    junctions: connectivityDocument.junctions.length,
    annotations: connectivityDocument.annotations.length,
  },
  catalogFixture: {
    unusedDefinitions: 10_000,
    placedInstances: 500,
    loadingExcluded: true,
    loadingMs: Number(catalogLoad.milliseconds.toFixed(3)),
  },
  measurements: Object.fromEntries(
    Object.entries(measurements).map(([name, value]) => [
      name,
      Number(value.toFixed(3)),
    ]),
  ),
  budgets,
  editSampling,
  editReference: comparison.baselineCommit,
  editBaseline: comparison.baseline,
  editBudgets: comparison.budgets,
  editWorkloads,
  slowEdit,
  mode: slowEdit ? "slowdown-injection" : "check",
  passed: failures.length === 0,
  failures,
};
await mkdir(resolve("output/performance"), { recursive: true });
await writeFile(
  resolve(
    outputDirectory,
    slowEdit ? `edit-slow-${slowEdit}.json` : "phase-7-baseline.json",
  ),
  `${JSON.stringify(report, null, 2)}\n`,
);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (failures.length > 0) process.exitCode = 1;
