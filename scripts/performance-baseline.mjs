import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";

import { createAgentCircuitService } from "../packages/agent-adapter/dist/index.js";
import { buildProjectConnectivityIndex } from "../packages/derived/dist/index.js";
import {
  CircuitProjectSchema,
  createEmptyProject,
  createRoutePath,
} from "../packages/model/dist/index.js";
import {
  saveProject,
  serializeProject,
} from "../packages/project-protocol/dist/index.js";
import { RootedProjectStorage } from "../packages/platform-node/dist/index.js";
import { renderDocumentSvg } from "../packages/render-svg/dist/index.js";
import { importSpiceSources } from "../packages/spice/dist/index.js";
import {
  InMemorySymbolResolver,
  builtInSymbols,
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
  atomicSave: 1000,
};

async function measure(action) {
  const started = performance.now();
  const result = await action();
  return { result, milliseconds: performance.now() - started };
}

const generated = await measure(() => {
  const base = createEmptyProject("phase-7-large", "Phase 7 Large Project");
  return CircuitProjectSchema.parse({
    ...base,
    documents: [
      {
        ...base.documents[0],
        instances: Array.from({ length: 500 }, (_, index) => ({
          id: `R${index + 1}`,
          symbolId: "resistor",
          placement: {
            position: {
              x: 60 + (index % 25) * 80,
              y: 60 + Math.floor(index / 25) * 80,
            },
            rotation: index % 2 === 0 ? 0 : 90,
            mirror: "none",
          },
          reference: `R${index + 1}`,
          netlist: {
            binding: { kind: "primitive", deviceClass: "resistor" },
            parameters: { value: `${index + 1}k` },
          },
        })),
      },
    ],
  });
});
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
    apiVersion: "2.0",
    requestId: "performance-snapshot",
    operation: "snapshot",
    documentId: document.id,
  }),
);
const edit = await measure(() =>
  service.handle({
    apiVersion: "2.0",
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
const storageRoot = await mkdtemp(resolve(tmpdir(), "icm-performance-"));
const saved = await measure(() =>
  saveProject(
    new RootedProjectStorage(storageRoot),
    "large.icproj.json",
    project,
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
  atomicSave: saved.milliseconds,
};
const failures = Object.entries(measurements).filter(
  ([name, value]) => value > budgets[name],
);
const report = {
  version: "0.1.0",
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
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
  measurements: Object.fromEntries(
    Object.entries(measurements).map(([name, value]) => [
      name,
      Number(value.toFixed(3)),
    ]),
  ),
  budgets,
  passed: failures.length === 0,
};
await mkdir(resolve("output/performance"), { recursive: true });
await writeFile(
  resolve("output/performance/phase-7-baseline.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (failures.length > 0) process.exitCode = 1;
