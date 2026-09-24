import { describe, expect, it } from "vitest";
import {
  createEmptyDocument,
  createRoutePath,
  type SchematicDocument,
} from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { executeTransaction } from "./transaction.js";
import type { SchematicEdit } from "./edit-schema.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
const pin = (instanceId: string) => ({
  kind: "terminal" as const,
  instanceId,
  pinName: "1",
});
function fixture() {
  const d = createEmptyDocument("rebuild", "Connectivity rebuild");
  for (const [id, x, y] of [
    ["a", 0, 0],
    ["b", 100, 0],
    ["c", 100, 100],
    ["d", 200, 100],
  ] as const) {
    d.instances.push({
      id,
      symbolId: "resistor",
      placement: { position: { x, y }, rotation: 0, mirror: "none" },
    });
  }
  return d;
}
function wire(
  id: string,
  from: string,
  to: string,
  netId = "hint",
): SchematicEdit {
  return {
    kind: "set_route_path",
    route: createRoutePath({
      id,
      netId,
      start: pin(from),
      end: pin(to),
      bends: [],
      modes: ["manual"],
    }),
  };
}
function commit(d: SchematicDocument, edits: SchematicEdit[]) {
  const r = executeTransaction(
    d,
    {
      transactionId: `edit-${d.revision}`,
      documentId: d.id,
      expectedRevision: d.revision,
      actor: { kind: "human", id: "test" },
      edits,
    },
    { symbolResolver: resolver },
  );
  expect(r.ok, JSON.stringify(r)).toBe(true);
  if (!r.ok) throw new Error(r.error.message);
  return r.document;
}
function groups(d: SchematicDocument) {
  return d.nets
    .map((n) =>
      n.terminals
        .map((p) => p.instanceId)
        .sort()
        .join(","),
    )
    .filter(Boolean)
    .sort();
}
describe("connectivity reconstructed from final wire topology", () => {
  it("draws between unwired pins without preassigning Net membership", () => {
    const d = commit(fixture(), [wire("ab", "a", "b")]);
    expect(groups(d)).toEqual(["a,b"]);
  });
  it("repointing a wire detaches its old pin and connects the new one", () => {
    const before = commit(fixture(), [wire("ab", "a", "b")]);
    const after = commit(before, [wire("ab", "a", "c")]);
    expect(groups(after)).toEqual(["a,c", "b"]);
    expect(groups(before)).toEqual(["a,b"]);
  });
  it("keeps a replacement path regardless of cut/draw order", () => {
    const before = commit(fixture(), [
      wire("ab", "a", "b"),
      wire("bc", "b", "c"),
    ]);
    const cut: SchematicEdit = { kind: "cut_connection", routeId: "ab" };
    for (const edits of [
      [cut, wire("ac", "a", "c")],
      [wire("ac", "a", "c"), cut],
    ]) {
      const after = commit(before, edits);
      expect(groups(after)).toEqual(["a,b,c"]);
      expect(after.routes.map((r) => r.id).sort()).toEqual(["ac", "bc"]);
    }
  });
  it("cuts a bridge into separate networks, retaining alternate paths", () => {
    const before = commit(fixture(), [
      wire("ab", "a", "b"),
      wire("bc", "b", "c"),
      wire("cd", "c", "d"),
    ]);
    expect(
      groups(commit(before, [{ kind: "cut_connection", routeId: "bc" }])),
    ).toEqual(["a,b", "c,d"]);
  });
  it("names a split-off network from the revision, not the transaction ID", () => {
    // Planners preview a step under one transaction ID and commit it under
    // another; later steps must still find the Net this one creates.
    const before = commit(fixture(), [
      wire("ab", "a", "b"),
      wire("bc", "b", "c"),
      wire("cd", "c", "d"),
    ]);
    const cutUnder = (transactionId: string) => {
      const result = executeTransaction(
        before,
        {
          transactionId,
          documentId: before.id,
          expectedRevision: before.revision,
          actor: { kind: "human", id: "test" },
          edits: [{ kind: "cut_connection", routeId: "bc" }],
        },
        { symbolResolver: resolver },
      );
      if (!result.ok) throw new Error(result.error.message);
      return result.document.nets.map((net) => net.id).sort();
    };
    const preview = cutUnder("preview-cut");
    expect(preview).toHaveLength(2);
    expect(cutUnder("commit-cut")).toEqual(preview);
  });
  it("does not treat a stale netId hint as an invisible wire", () => {
    expect(
      groups(commit(fixture(), [wire("ab", "a", "b"), wire("cd", "c", "d")])),
    ).toEqual(["a,b", "c,d"]);
  });
  it("keeps an interior crossing disconnected", () => {
    const before = fixture();
    before.instances[1]!.placement!.position = { x: 100, y: 100 };
    before.instances[2]!.placement!.position = { x: 0, y: 100 };
    before.instances[3]!.placement!.position = { x: 100, y: 0 };
    const after = commit(before, [wire("ab", "a", "b"), wire("cd", "c", "d")]);
    expect(groups(after)).toEqual(["a,b", "c,d"]);
    expect(after.junctions).toEqual([]);
  });
  it("joins two existing networks through the new path alone", () => {
    const before = commit(fixture(), [
      wire("ab", "a", "b"),
      wire("cd", "c", "d"),
    ]);
    const after = commit(before, [wire("bc", "b", "c", "outdated-hint")]);
    expect(groups(after)).toEqual(["a,b,c,d"]);
    expect(new Set(after.routes.map((r) => r.netId)).size).toBe(1);
  });
  it("does not regenerate network identities on repeated path submission", () => {
    const before = commit(fixture(), [wire("ab", "a", "b")]);
    const after = commit(before, [
      { kind: "set_route_path", route: before.routes[0]! },
    ]);
    expect(after.nets).toEqual(before.nets);
    expect(after.connectivityEvidence).toEqual(before.connectivityEvidence);
  });
  it("preserves imported connections that have not yet been drawn", () => {
    const before = fixture();
    before.nets.push({
      id: "imported",
      terminals: ["a", "b", "c"].map((instanceId) => ({
        instanceId,
        pinName: "1",
      })),
    });
    const after = commit(before, [wire("ab", "a", "b")]);
    expect(groups(after)).toEqual(["a,b,c"]);
  });
  it("does not replay an earlier connection over a later explicit disconnect", () => {
    const after = commit(fixture(), [
      {
        kind: "connect_endpoints",
        from: pin("a"),
        to: pin("b"),
        newNetId: "intent",
      },
      { kind: "disconnect_endpoint", endpoint: pin("a") },
    ]);
    expect(groups(after)).toEqual(["b"]);
  });
});
