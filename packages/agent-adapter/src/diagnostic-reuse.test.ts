import { readFileSync } from "node:fs";
import {
  createEmptyProject,
  parseProjectSnapshot,
  restoreProjectSnapshot,
  type CircuitProject,
} from "@icm/model";
import { parseProject } from "@icm/project-protocol";
import {
  InMemorySymbolResolver,
  builtInSymbols,
  createProjectSymbolResolver,
  externalSubcircuitSymbolId,
  type SymbolResolver,
} from "@icm/symbols";
import { afterEach, expect, it, vi } from "vitest";
import * as evidence from "./diagnostics.js";
import { createAgentCircuitService } from "./service.js";
import { diagnosticDeltaOf } from "./diagnostic-report.js";

afterEach(() => {
  vi.restoreAllMocks();
});

function fixture() {
  return parseProjectSnapshot(
    parseProject(
      readFileSync(
        "fixtures/projects/hierarchical-gain-stage/project.icproj.json",
        "utf8",
      ),
    ),
  );
}

function live(initial: CircuitProject, symbols: SymbolResolver) {
  let project = initial;
  let resolver = symbols;
  const service = createAgentCircuitService({
    agentId: "diagnostics",
    host: {
      getProject: () => project,
      getDocument: (id) =>
        project.documents.find((doc) => doc.id === id) ?? null,
      getResolver: () => resolver,
      dispatchTransaction: () => {
        throw new Error("unexpected edit");
      },
    },
    permissions: {
      snapshot: true,
      render: true,
      sourceSpans: false,
      edit: { geometry: true, connectivity: true, presentation: true },
    },
  });
  return {
    change(next: CircuitProject, catalog: SymbolResolver) {
      project = next;
      resolver = catalog;
    },
    read(fields: Record<string, unknown>, id = project.topDocumentId) {
      const result = service.handle({
        apiVersion: "3.0",
        requestId: "read",
        documentId: id,
        operation: "snapshot",
        ...fields,
      });
      expect(result.ok).toBe(true);
      return result;
    },
  };
}

it("reads one ordered report across state, full, render and a restored Project with fresh revisions", () => {
  const project = fixture();
  const resolver = createProjectSymbolResolver(project, builtInSymbols);
  const service = live(project, resolver);
  const doc = project.documents.find((d) => d.id === project.topDocumentId)!;
  const original = evidence.agentProjectDiagnostics(
    project,
    resolver,
    doc.id,
    doc.revision,
  );
  expect(original.length).toBeGreaterThan(0);
  const reads = vi.spyOn(evidence, "agentProjectDiagnostics");
  service.read({ projection: "state" });
  for (const fields of [
    { projection: "state", diagnosticDetail: "items" },
    { projection: "full" },
    { operation: "render", mode: "diagnostics" },
  ]) {
    const result = service.read(fields);
    expect("diagnostics" in result && result.diagnostics).toEqual(original);
  }
  const child = project.documents.find((d) => d.id !== doc.id)!;
  service.read({ projection: "state" }, child.id);
  expect(reads).toHaveBeenCalledTimes(2);
  const restored = restoreProjectSnapshot(project, 13, () => 12);
  service.change(
    restored,
    createProjectSymbolResolver(restored, builtInSymbols),
  );
  expect(
    service.read({ projection: "state", diagnosticDetail: "items" }),
  ).toMatchObject({
    revision: 12,
    diagnostics: original.map((item) => ({ ...item, revision: 12 })),
  });
  expect(reads).toHaveBeenCalledTimes(2);
  const switched = parseProjectSnapshot({ ...project, id: "other-project" });
  service.change(switched, resolver);
  service.read({ projection: "state" });
  expect(reads).toHaveBeenCalledTimes(3);
});

it("invalidates an unchanged Cell when its model source changes, even with the same resolver", () => {
  const project = createEmptyProject("ext-proof", "Model source");
  const doc = project.documents[0]!;
  const source = {
    id: "src",
    language: "spice" as const,
    revision: 1,
    entry: "main.spice",
    dependencies: [],
    files: [
      { path: "main.spice", text: ".subckt gain A B\nR1 A B 1k\n.ends gain\n" },
    ],
  };
  project.modelSources = [source];
  project.externalSubcircuitDefinitions = [
    {
      id: "gain",
      name: "gain",
      interfaceStatus: "declared",
      terminals: ["A", "B"].map((name) => ({
        id: name,
        name,
        direction: "passive",
      })),
      formalParameters: [],
      implementation: { kind: "source", sourceId: "src", entry: "gain" },
    },
  ];
  doc.instances.push({
    id: "X1",
    reference: "X1",
    symbolId: externalSubcircuitSymbolId("gain"),
    netlist: {
      binding: { kind: "external-subcircuit", definitionId: "gain" },
      parameters: {},
    },
    placement: null,
  });
  for (const pinName of ["A", "B"])
    doc.noConnects.push({
      id: pinName,
      endpoint: { kind: "terminal", instanceId: "X1", pinName },
    });
  const original = parseProjectSnapshot(project);
  const resolver = createProjectSymbolResolver(original, builtInSymbols);
  const service = live(original, resolver);
  const read = { projection: "state", diagnosticDetail: "items" };
  const before = service.read(read);
  const changed = parseProjectSnapshot(
    {
      ...original,
      modelSources: [
        {
          ...source,
          revision: 2,
          files: [
            {
              path: "main.spice",
              text: ".subckt unrelated A B\nR1 A B 1k\n.ends unrelated\n",
            },
          ],
        },
      ],
    },
    original,
  );
  expect(changed.documents[0]).toBe(original.documents[0]);
  service.change(changed, resolver);
  const after = service.read(read);
  expect(after).toEqual(live(changed, resolver).read(read));
  expect(after).not.toEqual(before);
});

it("rechecks mutable Project content and caller-owned parameter callbacks in state and full reads", () => {
  const project = fixture();
  const reads = vi.spyOn(evidence, "agentProjectDiagnostics");
  const catalog = new InMemorySymbolResolver(
    builtInSymbols,
    undefined,
    () => undefined,
  );
  const service = live(project, catalog);
  for (const fields of [
    { projection: "state" },
    { projection: "full" },
    { projection: "full" },
  ])
    service.read(fields);
  expect(reads).toHaveBeenCalledTimes(3);
  const draft = structuredClone(project);
  const stable = new InMemorySymbolResolver(builtInSymbols);
  service.change(draft, stable);
  service.read({ projection: "full" });
  draft.documents.find(
    (d) => d.id === draft.topDocumentId,
  )!.instances[0]!.placement = null;
  const expected = live(structuredClone(draft), stable).read({
    projection: "full",
  });
  expect(service.read({ projection: "full" })).toEqual(expected);
  expect(reads).toHaveBeenCalledTimes(6);
});

it("refreshes child endpoints in a global trace after a same-revision working copy edit", () => {
  const project = structuredClone(fixture());
  const resolver = createProjectSymbolResolver(project, builtInSymbols);
  const service = live(project, resolver);
  const request = { projection: "full", traceNet: { netId: "net-top-in" } };
  const before = service.read(request);
  const child = project.documents.find(
    (cell) => cell.id === "document-gain-stage",
  )!;
  child.nets.find((net) => net.id === "net-in")!.terminals.splice(0);
  const actual = service.read(request);
  const expected = live(structuredClone(project), resolver).read(request);
  expect("trace" in before && before.trace).not.toEqual(
    "trace" in expected && expected.trace,
  );
  expect(actual).toEqual(expected);
});

it("reuses committed identities between two distinct previews while evaluating both proposals", () => {
  const project = fixture();
  const resolver = createProjectSymbolResolver(project, builtInSymbols);
  const doc = project.documents.find(
    (cell) => cell.id === project.topDocumentId,
  )!;
  const service = createAgentCircuitService({
    agentId: "preview",
    permissions: {
      snapshot: true,
      render: true,
      sourceSpans: false,
      edit: { geometry: true, presentation: true, connectivity: true },
    },
    resolver,
    store: {
      getProject: () => project,
      getDocument: () => doc,
      commitDocument: () => {
        throw new Error("committed a preview");
      },
    },
  });
  const keys = vi.spyOn(evidence, "agentDiagnosticIdentity");
  const reports = vi.spyOn(evidence, "agentProjectDiagnostics");
  for (const [i, position] of [
    { x: 340, y: 240 },
    { x: 460, y: 320 },
  ].entries()) {
    keys.mockClear();
    const reply = service.handle({
      apiVersion: "3.0",
      requestId: "preview" + i,
      transactionId: "preview" + i,
      operation: "transact",
      dryRun: true,
      expectedRevision: doc.revision,
      documentId: doc.id,
      edits: [{ kind: "move_instance", instanceId: "X1", position }],
    });
    if (!reply.ok || reply.operation !== "transact")
      throw new Error("Expected a preview");
    expect(reply.applied).toBe(false);
    if (i === 1) expect(keys).toHaveBeenCalledTimes(reply.diagnostics.length);
  }
  expect(reports).toHaveBeenCalledTimes(3);
});

it("compares ordered identities once per side and retains duplicate findings, notes and compact IDs", () => {
  const [item] = evidence.agentProjectDiagnostics(
    fixture(),
    new InMemorySymbolResolver(builtInSymbols),
    fixture().topDocumentId,
    1,
  );
  const a = { ...item!, code: "A" },
    b = { ...item!, code: "B" },
    common = { ...item!, code: "COMMON" };
  const keys = vi.spyOn(evidence, "agentDiagnosticIdentity");
  const before = [a, common, a],
    after = [b, { ...common, revision: 2 }, b];
  const expectedId = JSON.stringify({
    domain: a.domain ?? null,
    code: a.code,
    objectIds: a.objectIds ?? [],
    parameters: a.parameters ?? {},
  });
  expect(diagnosticDeltaOf(before, after, [common], "compact")).toEqual({
    added: [common, b, b],
    removed: [],
    removedIds: [expectedId, expectedId],
  });
  expect(keys.mock.calls.length).toBeLessThanOrEqual(
    before.length + after.length,
  );
  expect(diagnosticDeltaOf(before, after, [common], "full")).toEqual({
    added: [common, b, b],
    removed: [a, a],
  });
  keys.mockClear();
  expect(diagnosticDeltaOf(before, before, [a], "compact")).toEqual({
    added: [a],
    removed: [],
    removedIds: [],
  });
  expect(keys).not.toHaveBeenCalled();
});
