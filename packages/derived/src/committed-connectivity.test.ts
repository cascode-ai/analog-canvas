import { describe, expect, it } from "vitest";
import {
  createEmptyProject,
  freezeSnapshot,
  recordCommittedDocumentChanges,
  type CircuitProject,
  type SchematicDocument,
} from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import {
  buildCommittedProjectConnectivityIndex,
  buildProjectConnectivityIndex,
} from "./connectivity-index.js";
import {
  deriveVisibleConnectivity,
  deriveNetConnectivityContext,
} from "./connectivity.js";
import { computeNetHighlight } from "./net-highlight.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function indexed(project: CircuitProject) {
  return buildCommittedProjectConnectivityIndex(
    project,
    resolver,
  ).documents.get(project.topDocumentId)!;
}

function conductors(count: number) {
  const project = createEmptyProject("drafts", "Conductors");
  const cell = project.documents[0]!;
  for (const [i, netId] of [
    "b",
    "a",
    ...Array.from({ length: count }, (_, n) => "bg-" + n),
  ].entries()) {
    cell.nets.push({ id: netId, terminals: [] });
    cell.junctions.push({
      id: "j-" + netId,
      netId,
      position: { x: 20 * i, y: 0 },
    });
  }
  return freezeSnapshot(project);
}

function install(before: CircuitProject, change: Partial<SchematicDocument>) {
  const cell = before.documents[0]!;
  const after = freezeSnapshot({
    ...before,
    documents: [
      { ...cell, ...change, revision: cell.revision + 1 },
      ...before.documents.slice(1),
    ],
  });
  recordCommittedDocumentChanges(before, after);
  return after;
}

function compareToFresh(project: CircuitProject) {
  const current = buildCommittedProjectConnectivityIndex(project, resolver);
  const control = buildProjectConnectivityIndex(
    structuredClone(project),
    new InMemorySymbolResolver(builtInSymbols),
  );
  const id = project.topDocumentId;
  const actual = current.documents.get(id)!,
    full = control.documents.get(id)!;
  expect([...actual.endpointToBaseNetId]).toEqual([
    ...full.endpointToBaseNetId,
  ]);
  expect([...actual.logicalNetByBaseNetId]).toEqual([
    ...full.logicalNetByBaseNetId,
  ]);
  expect([...actual.logicalNets]).toEqual([...full.logicalNets]);
  expect([...current.globalNets]).toEqual([...control.globalNets]);
  for (const net of project.documents[0]!.nets)
    expect(computeNetHighlight(current, id, net.id)).toEqual(
      computeNetHighlight(control, id, net.id),
    );
  return actual;
}

describe("committed connectivity", () => {
  it.each([true, false])(
    "isolates writable public indexes and standalone geometry when the committed index is read first: %s",
    (committedFirst) => {
      const before = conductors(4),
        cell = before.documents[0]!;
      const publicIndex = buildProjectConnectivityIndex(
        before,
        resolver,
      ).documents.get(cell.id)!;
      if (committedFirst) indexed(before);
      const visible = deriveVisibleConnectivity(cell, resolver);
      visible.find((net) => net.netId === "a")!.components[0]!.nodes[0]!.point =
        { x: 444, y: 333 };
      const standalone = deriveNetConnectivityContext(cell, resolver);
      (standalone.routeDegreeByEndpointKey as Map<string, number>).set(
        "forged",
        12,
      );
      const record = publicIndex.logicalNets.get("a")!;
      record.netId = "forged";
      record.routedComponents[0]!.nodes[0]!.point = { x: 777, y: 888 };
      (publicIndex.endpointToBaseNetId as Map<string, string>).set(
        "junction:j-a",
        "fake",
      );
      const protectedIndex = indexed(before);
      expect(protectedIndex.routeDegreeByEndpointKey.has("forged")).toBe(false);
      expect(
        protectedIndex.logicalNets.get("a")?.routedComponents[0]?.nodes[0]
          ?.point,
      ).toEqual(cell.junctions[1]!.position);
      expect(protectedIndex.logicalNets.get("a")?.netId).toBe("a");
      expect(
        protectedIndex.logicalNets.get("a")?.routedComponents[0]?.nodes[0]
          ?.point,
      ).not.toEqual({ x: 777, y: 888 });
      const next = install(before, {
        junctions: cell.junctions.map((row) =>
          row.netId === "b" ? { ...row, position: { x: 23, y: 7 } } : row,
        ),
      });
      const expected = buildProjectConnectivityIndex(
        structuredClone(next),
        resolver,
      ).documents.get(cell.id)!;
      const result = buildProjectConnectivityIndex(
        next,
        resolver,
      ).documents.get(cell.id)!;
      const owned = buildCommittedProjectConnectivityIndex(
        next,
        resolver,
      ).documents.get(cell.id)!;
      expect([...owned.logicalNets]).toEqual([...expected.logicalNets]);
      expect([...owned.endpointToBaseNetId]).toEqual([
        ...expected.endpointToBaseNetId,
      ]);
      expect([...result.logicalNets]).toEqual([...expected.logicalNets]);
      expect([...result.endpointToBaseNetId]).toEqual([
        ...expected.endpointToBaseNetId,
      ]);
    },
  );

  it("retains electrical records when a model-filled blank placement replaces the resolver but preserves every previously used symbol", () => {
    const before = conductors(16);
    const initial = indexed(before);
    const cell = before.documents[0]!;
    const updated = {
      ...cell,
      revision: 1,
      instances: [
        ...cell.instances,
        { id: "M1", symbolId: "nmos", placement: null },
      ],
    };
    const after = freezeSnapshot({ ...before, documents: [updated] });
    recordCommittedDocumentChanges(before, after);
    const freshCatalog = new InMemorySymbolResolver([], resolver);
    const result = buildCommittedProjectConnectivityIndex(
      after,
      freshCatalog,
    ).documents.get(cell.id)!;
    expect(result.logicalNets.get("bg-4")).toBe(
      initial.logicalNets.get("bg-4"),
    );
    expect(result.endpointToBaseNetId).toBe(initial.endpointToBaseNetId);
    expect(result.logicalNets).toBe(initial.logicalNets);
    expect(result.logicalNetByBaseNetId).toBe(initial.logicalNetByBaseNetId);
  });

  it("preserves the fresh order for distinct endpoint spellings that compare equally during a reorder", () => {
    const project = createEmptyProject("spelling", "Spelling");
    const cell = project.documents[0]!;
    cell.nets.push({ id: "n", terminals: [] });
    for (const id of ["é", "e\u0301"])
      cell.junctions.push({
        id,
        netId: "n",
        position: { x: cell.junctions.length * 10, y: 0 },
      });
    const before = freezeSnapshot(project);
    indexed(before);
    const after = freezeSnapshot({
      ...before,
      documents: [
        { ...cell, revision: 1, junctions: [...cell.junctions].reverse() },
      ],
    });
    recordCommittedDocumentChanges(before, after);
    const actual = indexed(after),
      control = indexed(structuredClone(after));
    expect([...actual.endpointToBaseNetId]).toEqual([
      ...control.endpointToBaseNetId,
    ]);
    expect([...actual.logicalNets]).toEqual([...control.logicalNets]);
  });

  it("keeps unaffected body and signal records and refreshes only the Net whose MOS body becomes visible under a new supply", () => {
    const project = structuredClone(conductors(16)),
      cell = project.documents[0]!;
    cell.instances.push({
      id: "M1",
      symbolId: "nmos",
      symbolVariantId: "textbook-3terminal",
      placement: { position: { x: 400, y: 400 }, rotation: 0, mirror: "none" },
    });
    cell.nets[0]!.terminals.push({ instanceId: "M1", pinName: "B" });
    cell.mosBulkDefaults = { nmosNetId: "b" };
    const before = freezeSnapshot(project);
    const initial = indexed(before);
    const moved = install(before, {
      junctions: cell.junctions.map((j) =>
        j.netId === "a" ? { ...j, position: { x: 200, y: 200 } } : j,
      ),
    });
    const stillHidden = compareToFresh(moved);
    expect(stillHidden.logicalNets.get("b")).toBe(initial.logicalNets.get("b"));
    const after = install(moved, { mosBulkDefaults: { nmosNetId: "a" } });
    const visible = compareToFresh(after);
    const body = { kind: "terminal", instanceId: "M1", pinName: "B" };
    expect(initial.logicalNets.get("b")?.visibleEndpoints).not.toContainEqual(
      body,
    );
    expect(visible.logicalNets.get("b")?.visibleEndpoints).toContainEqual(body);
    expect(visible.logicalNets.get("bg-3")).toBe(
      initial.logicalNets.get("bg-3"),
    );
  });

  it("regroups two labeled globals, removes the retired representative and updates the first trace after rename", () => {
    const project = structuredClone(conductors(6)),
      cell = project.documents[0]!;
    for (const id of ["b", "a"]) {
      cell.annotations.push({
        id: "label-" + id,
        kind: "net-label",
        netId: id,
        binding: { kind: "net-name", netId: id },
        anchor: {
          kind: "object",
          objectId: "j-" + id,
          localOffset: { x: 0, y: 0 },
          fallbackPosition: { x: 0, y: 0 },
        },
        alignment: "start",
        rotation: 0,
        locked: false,
      });
      cell.connectivityEvidence.push({
        id: "claim-" + id,
        kind: "name-claim",
        scope: "global",
        netId: id,
        name: "VDD",
        owner: { kind: "net-label", annotationId: "label-" + id },
      });
    }
    const before = freezeSnapshot(project),
      initial = indexed(before);
    expect(initial.logicalNetByBaseNetId.get("a")).toBe(
      initial.logicalNetByBaseNetId.get("b"),
    );
    const renamed = install(before, {
      connectivityEvidence: cell.connectivityEvidence.map((row) =>
        row.id === "claim-b" ? { ...row, name: "AVDD" } : row,
      ),
    });
    const result = compareToFresh(renamed);
    expect(result.logicalNetByBaseNetId.get("a")).not.toBe(
      result.logicalNetByBaseNetId.get("b"),
    );
    expect(result.logicalNets.get("bg-1")).toBe(
      initial.logicalNets.get("bg-1"),
    );
  });

  it("falls back for a bus member with a colliding scalar spelling and an independent same-ID snapshot", () => {
    const project = structuredClone(conductors(4)),
      cell = project.documents[0]!;
    cell.junctions.push(
      { id: "leg:member:m", netId: "a", position: { x: 0, y: 40 } },
      {
        id: "leg",
        netId: "b",
        position: { x: 100, y: 40 },
        members: [
          { id: "m", netId: "b" },
          { id: "m2", netId: "bg-1" },
        ],
      },
    );
    const before = freezeSnapshot(project),
      initial = indexed(before);
    const after = install(before, {
      junctions: cell.junctions.map((j) =>
        j.id === "leg" ? { ...j, position: { x: 200, y: 40 } } : j,
      ),
    });
    const changed = compareToFresh(after);
    expect(changed.logicalNets.get("bg-2")).not.toBe(
      initial.logicalNets.get("bg-2"),
    );
    const detached = freezeSnapshot(structuredClone(after));
    expect(compareToFresh(detached).logicalNets.get("b")).not.toBe(
      changed.logicalNets.get("b"),
    );
  });

  it.each([16, 128])(
    "retains unaffected records on a two-sided merge with %d unrelated Nets and orders endpoints like a fresh index",
    (count) => {
      const before = conductors(count);
      const initial = indexed(before);
      const cell = before.documents[0]!;
      const updated = {
        ...cell,
        revision: cell.revision + 1,
        nets: cell.nets.filter((net) => net.id !== "b"),
        junctions: cell.junctions.map((junction) =>
          junction.netId === "b" ? { ...junction, netId: "a" } : junction,
        ),
      };
      const after = freezeSnapshot({ ...before, documents: [updated] });
      recordCommittedDocumentChanges(before, after);
      const changed = indexed(after);
      const control = indexed(structuredClone(after));
      expect([...changed.endpointToBaseNetId]).toEqual([
        ...control.endpointToBaseNetId,
      ]);
      expect([...changed.logicalNets]).toEqual([...control.logicalNets]);
      expect([...changed.logicalNetByBaseNetId]).toEqual([
        ...control.logicalNetByBaseNetId,
      ]);
      expect(
        [...changed.logicalNets]
          .filter(([id, record]) => initial.logicalNets.get(id) !== record)
          .map(([id]) => id),
      ).toEqual(["a"]);
      expect(changed.endpointToBaseNetId.get("junction:j-b")).toBe("a");
      expect(initial.endpointToBaseNetId.get("junction:j-b")).toBe("b");
      expect(changed.logicalNets.has("b")).toBe(false);
    },
  );
});
