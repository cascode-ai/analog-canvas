import { buildProjectConnectivityRelations } from "./project-connectivity-relations.js";
import {
  createEmptyDocument,
  createEmptyProject,
  freezeSnapshot,
  recordCommittedDocumentChanges,
} from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { expect, it } from "vitest";
import {
  buildCellDiagnosticIndex,
  buildCommittedProjectConnectivityIndex,
  buildProjectConnectivityIndex,
} from "./connectivity-index.js";

it("retains project relations after a local edit in a flat Cell", () => {
  const project = createEmptyProject("local", "Local");
  const other = createEmptyDocument("other", "Other");
  other.nets.push({ id: "bias", terminals: [] });
  other.connectivityEvidence.push({
    id: "global-bias",
    kind: "name-claim",
    netId: "bias",
    name: "VBIAS",
    scope: "global",
    owner: { kind: "net-label", annotationId: "bias-label" },
  });
  project.documents.push(other);
  const before = freezeSnapshot(project);
  const resolver = new InMemorySymbolResolver(builtInSymbols);
  const original = buildCommittedProjectConnectivityIndex(before, resolver);
  expect(original.globalNets.get("vbias")?.nets).toEqual([
    { documentId: "other", netId: "bias" },
  ]);
  const cell = before.documents[0]!;
  const edited = freezeSnapshot({
    ...before,
    documents: [
      {
        ...cell,
        revision: cell.revision + 1,
        nets: [...cell.nets, { id: "added", terminals: [] }],
      },
      other,
    ],
  });
  const next = buildCommittedProjectConnectivityIndex(edited, resolver);
  expect(next.hierarchy).toBe(original.hierarchy);
  expect(next.globalNets).toBe(original.globalNets);
});

it("updates only affected call edges as a captured child is removed, restored or changes its formals", () => {
  const project = createEmptyProject("hierarchy", "Hierarchy", "top");
  const parent = project.documents[0]!;
  for (const id of ["child", "sibling"]) {
    const child = createEmptyDocument(id, id);
    child.nets.push({ id: "n", terminals: [] });
    child.netlist!.terminals.push({
      id: "p",
      name: "P",
      netId: "n",
      direction: "passive",
      interfaceInstanceIds: ["p"],
    });
    project.documents.push(child);
    parent.instances.push({
      id: "x-" + id,
      symbolId: "port",
      placement: null,
      netlist: {
        parameters: {},
        binding: { kind: "subcircuit", childDocumentId: id },
      },
    });
  }
  const before = freezeSnapshot(project);
  const resolver = new InMemorySymbolResolver(builtInSymbols);
  const read = (input: typeof project) =>
    buildCommittedProjectConnectivityIndex(input, resolver).hierarchy;
  const first = read(before);
  expect(first.edges.map((e) => e.childDocumentId)).toEqual([
    "child",
    "sibling",
  ]);
  const removed = freezeSnapshot({
    ...before,
    documents: before.documents.filter((d) => d.id !== "child"),
  });
  expect(read(removed).calls.map((c) => c.childDocumentId)).toEqual([
    "sibling",
  ]);
  const child = before.documents[1]!;
  const renamed = freezeSnapshot({
    ...before,
    documents: [
      before.documents[2]!,
      before.documents[0]!,
      {
        ...child,
        revision: child.revision + 1,
        netlist: {
          ...child.netlist!,
          terminals: child.netlist!.terminals.map((t) => ({ ...t, name: "Q" })),
        },
      },
    ],
  });
  const changed = read(renamed);
  expect(changed.calls).toEqual(first.calls);
  expect(changed.edges).toEqual([first.edges[1]]);
  expect(changed.edges[0]).toBe(first.edges[1]);
  expect(read(before)).toEqual(first);
});

it("retains authored order for equal-collating global references when Cells move or global claims change", () => {
  const project = createEmptyProject("order", "Order");
  const cells = ["\u00e9", "e\u0301"].map((id) => {
    const cell = createEmptyDocument(id, id);
    cell.nets.push({ id: "n", terminals: [] });
    cell.connectivityEvidence.push({
      id: "c",
      kind: "name-claim",
      netId: "n",
      name: "VDD",
      scope: "global",
      owner: { kind: "net-label", annotationId: "label" },
    });
    return cell;
  });
  project.documents.push(...cells);
  const before = freezeSnapshot(project);
  const resolver = new InMemorySymbolResolver(builtInSymbols);
  const read = (input: typeof project) =>
    buildCommittedProjectConnectivityIndex(input, resolver).globalNets;
  expect(
    read(before)
      .get("vdd")
      ?.nets.map((n) => n.documentId),
  ).toEqual(cells.map((c) => c.id));
  const [a, b] = cells;
  const reversed = freezeSnapshot({
    ...before,
    documents: [before.documents[0]!, b!, a!],
  });
  expect(
    read(reversed)
      .get("vdd")
      ?.nets.map((n) => n.documentId),
  ).toEqual([b!.id, a!.id]);
  const bias = createEmptyDocument("other", "Other");
  bias.nets.push({ id: "bias", terminals: [] });
  bias.connectivityEvidence.push({
    id: "claim",
    kind: "name-claim",
    name: "VBIAS",
    netId: "bias",
    scope: "global",
    owner: { kind: "net-label", annotationId: "label" },
  });
  const withBias = freezeSnapshot({
    ...reversed,
    documents: [...reversed.documents, bias],
  });
  const stableGroup = read(withBias).get("vbias");
  const renamed = freezeSnapshot({
    ...reversed,
    documents: [
      before.documents[0]!,
      {
        ...b!,
        revision: b!.revision + 1,
        connectivityEvidence: b!.connectivityEvidence.map((e) =>
          e.kind === "name-claim" ? { ...e, name: "VSS" } : e,
        ),
      },
      a!,
      bias,
    ],
  });
  expect(read(renamed).get("vbias")).toBe(stableGroup);
  expect(
    [...read(renamed)].map(([name, group]) => [
      name,
      group.nets.map((n) => n.documentId),
    ]),
  ).toEqual([
    ["vbias", ["other"]],
    ["vdd", [a!.id]],
    ["vss", [b!.id]],
  ]);
});

it("reads mutable symbol pins again and keeps structural calls when electrical edges disappear", () => {
  const project = createEmptyProject("mutable", "Mutable");
  const parent = project.documents[0]!;
  const child = createEmptyDocument("child", "Child");
  child.nets.push({ id: "n", terminals: [] });
  child.netlist!.terminals.push({
    id: "p",
    name: "P",
    netId: "n",
    direction: "passive",
    interfaceInstanceIds: ["p"],
  });
  project.documents.push(child);
  parent.instances.push({
    id: "x",
    symbolId: "port",
    placement: null,
    netlist: {
      parameters: {},
      binding: { kind: "subcircuit", childDocumentId: "child" },
    },
  });
  const frozen = freezeSnapshot(project);
  const base = new InMemorySymbolResolver(builtInSymbols);
  const definition = structuredClone(base.resolve("port")!.definition);
  const resolver = {
    resolve: (id: string) =>
      id === "port" ? { definition } : base.resolve(id),
  };
  const first = buildCommittedProjectConnectivityIndex(
    frozen,
    resolver,
  ).hierarchy;
  expect(first.edges.map((e) => e.parentPinName)).toEqual(["P"]);
  definition.pins[0]!.name = "Q";
  const next = buildCommittedProjectConnectivityIndex(
    frozen,
    resolver,
  ).hierarchy;
  expect(next.calls).toEqual(first.calls);
  expect(next.edges).toEqual([]);
  const draft = structuredClone(frozen);
  expect(
    buildCommittedProjectConnectivityIndex(draft, resolver).hierarchy.calls,
  ).toHaveLength(1);
  draft.documents.pop();
  expect(
    buildCommittedProjectConnectivityIndex(draft, resolver).hierarchy.calls,
  ).toEqual([]);
});
it("does not read sibling instance bindings on a local edit to a flat Cell", () => {
  const project = createEmptyProject("locality", "Locality");
  const flat = project.documents[0]!;
  const caller = createEmptyDocument("caller", "Caller");
  const child = createEmptyDocument("child", "Child");
  let reads = 0;
  for (let i = 0; i < 96; i++) {
    const netlist = {
      parameters: {},
      binding: { kind: "subcircuit" as const, childDocumentId: child.id },
    };
    caller.instances.push({
      id: "x-" + i,
      placement: null,
      symbolId: "port",
      get netlist() {
        reads++;
        return netlist;
      },
    });
  }
  project.documents.push(caller, child);
  freezeSnapshot(project);
  const resolver = new InMemorySymbolResolver(builtInSymbols);
  const original = buildCommittedProjectConnectivityIndex(project, resolver);
  expect(original.hierarchy.calls).toHaveLength(96);
  expect(reads).toBeGreaterThan(0);
  const next = freezeSnapshot({
    ...project,
    documents: [
      {
        ...flat,
        revision: flat.revision + 1,
        nets: [...flat.nets, { id: "local-n", terminals: [] }],
      },
      caller,
      child,
    ],
  });
  reads = 0;
  expect(buildCommittedProjectConnectivityIndex(next, resolver).hierarchy).toBe(
    original.hierarchy,
  );
  expect(reads).toBe(0);
});
it("isolates caller-mutable public relation arrays across unrelated frozen Projects", () => {
  const resolver = new InMemorySymbolResolver(builtInSymbols);
  const first = freezeSnapshot(createEmptyProject("first", "First"));
  const second = freezeSnapshot(createEmptyProject("second", "Second"));
  const index = buildProjectConnectivityIndex(first, resolver);
  Object.assign(index.hierarchy.calls, [
    { parentDocumentId: "bad", instanceId: "bad", childDocumentId: "bad" },
  ]);
  expect(
    buildProjectConnectivityIndex(second, resolver).hierarchy.calls,
  ).toEqual([]);
  expect(
    buildProjectConnectivityIndex(first, resolver).hierarchy.calls,
  ).toEqual([]);
});

it("isolates mutable public fields in structural calls, electrical edges and global references", () => {
  const project = createEmptyProject("first", "First", "top");
  const parent = project.documents[0]!;
  const child = createEmptyDocument("child", "Child");
  parent.instances.push({
    id: "x",
    symbolId: "port",
    placement: null,
    netlist: {
      parameters: {},
      binding: { kind: "subcircuit", childDocumentId: "child" },
    },
  });
  child.nets.push({ id: "n", terminals: [] });
  child.netlist!.terminals.push({
    id: "p",
    name: "P",
    netId: "n",
    direction: "passive",
    interfaceInstanceIds: ["p"],
  });
  child.connectivityEvidence.push({
    id: "claim",
    kind: "name-claim",
    netId: "n",
    name: "VDD",
    scope: "global",
    owner: { kind: "net-label", annotationId: "label" },
  });
  project.documents.push(child);
  freezeSnapshot(project);
  const resolver = new InMemorySymbolResolver(builtInSymbols);
  const first = buildProjectConnectivityIndex(project, resolver);
  const expected = structuredClone({
    hierarchy: first.hierarchy,
    globalNets: first.globalNets,
  });
  first.hierarchy.calls[0]!.childDocumentId = "broken";
  first.hierarchy.edges[0]!.parentPinName = "broken";
  first.globalNets.get("vdd")!.nets[0]!.netId = "broken";
  first.globalNets.get("vdd")!.foldedName = "broken";
  for (const input of [
    project,
    freezeSnapshot({ ...project, id: "second" }),
    freezeSnapshot(structuredClone(project)),
  ]) {
    const { hierarchy, globalNets } = buildProjectConnectivityIndex(
      input,
      resolver,
    );
    expect(hierarchy).toEqual(expected.hierarchy);
    expect(globalNets).toEqual(expected.globalNets);
  }
});

it("classifies only changed instances when a primitive is appended beside a retained call", () => {
  const project = createEmptyProject("mixed", "Mixed");
  const cell = project.documents[0]!;
  const child = createEmptyDocument("child", "Child");
  project.documents.push(child);
  let reads = 0;
  for (let i = 0; i < 8192; i++)
    cell.instances.push({
      id: "m-" + i,
      symbolId: "nmos",
      placement: null,
      get netlist() {
        reads++;
        return undefined;
      },
    });
  cell.instances.push({
    id: "x",
    symbolId: "port",
    placement: null,
    netlist: {
      parameters: {},
      binding: { kind: "subcircuit", childDocumentId: child.id },
    },
  });
  freezeSnapshot(project);
  const resolver = new InMemorySymbolResolver(builtInSymbols);
  const empty = Object.freeze([]);
  const documentsFor = (input: typeof project) =>
    new Map(
      input.documents.flatMap((doc) => [
        ...buildCellDiagnosticIndex(doc, resolver).documents,
      ]),
    );
  const original = buildProjectConnectivityRelations(
    project,
    resolver,
    documentsFor(project),
    () => empty,
    true,
  );
  const updated = freezeSnapshot({
    ...project,
    documents: [
      {
        ...cell,
        revision: cell.revision + 1,
        instances: [
          ...cell.instances,
          { id: "r", symbolId: "resistor", placement: null },
        ],
      },
      child,
    ],
  });
  recordCommittedDocumentChanges(project, updated);
  const nextDocuments = documentsFor(updated);
  reads = 0;
  const next = buildProjectConnectivityRelations(
    updated,
    resolver,
    nextDocuments,
    () => empty,
    true,
  );
  expect(next.hierarchy.calls).toEqual(original.hierarchy.calls);
  expect(next.hierarchy.calls).toHaveLength(1);
  expect(reads).toBe(0);
});
