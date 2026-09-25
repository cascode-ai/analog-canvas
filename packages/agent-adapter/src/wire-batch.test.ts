import { createEmptyDocument } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { expect, it } from "vitest";
import { createAgentCircuitService } from "./service.js";

function fixture(
  limit = 64,
  positions = [
    [0, 100],
    [100, 100],
    [200, 100],
    [300, 100],
  ],
) {
  let document = createEmptyDocument("doc", "Batch");
  document.instances = positions.map(([x, y], i) => ({
    id: `R${i}`,
    symbolId: "resistor",
    placement: { position: { x: x!, y: y! }, rotation: 0, mirror: "none" },
  }));
  let commits = 0;
  const service = createAgentCircuitService({
    agentId: "test",
    resolver: new InMemorySymbolResolver(builtInSymbols),
    permissions: {
      snapshot: true,
      render: true,
      sourceSpans: false,
      edit: { geometry: true, connectivity: true, presentation: true },
    },
    limits: { maxTransactionEdits: limit },
    store: {
      getDocument: () => document,
      commitDocument: (next) => {
        document = next;
        commits++;
      },
    },
  });
  const wire = (id: string, from: string, to: string) => ({
    id,
    from: {
      kind: "endpoint",
      endpoint: { kind: "terminal", instanceId: from, pinName: "1" },
    },
    to: {
      kind: "endpoint",
      endpoint: { kind: "terminal", instanceId: to, pinName: "1" },
    },
  });
  return {
    wire,
    get document() {
      return document;
    },
    get commits() {
      return commits;
    },
    submit: (wires: unknown[], dryRun = false) =>
      service.handle({
        apiVersion: "3.0",
        requestId: "batch",
        operation: "transact",
        transactionId: "batch",
        documentId: document.id,
        expectedRevision: document.revision,
        dryRun,
        wireIntent: wires,
      }),
  };
}

it("plans shared endpoints against evolving state and commits one revision", () => {
  const f = fixture();
  const before = f.document.revision;
  expect(
    f.submit([f.wire("a", "R0", "R1"), f.wire("b", "R1", "R2")]),
  ).toMatchObject({
    ok: true,
    applied: true,
    terminalConnectivityChanged: true,
  });
  expect(f.commits).toBe(1);
  expect(f.document.revision).toBe(before + 1);
  expect(f.document.nets).toHaveLength(1);
  expect(f.document.nets[0]!.terminals).toHaveLength(3);
});

it("rebases two taps on one original route within a single atomic batch", () => {
  const f = fixture(64, [
    [0, 100],
    [100, 200],
    [200, 200],
    [300, 100],
  ]);
  expect(f.submit([f.wire("base", "R0", "R3")])).toMatchObject({ ok: true });
  const route = f.document.routes[0]!;
  const tap = (id: string, source: string, x: number) => ({
    id,
    from: {
      kind: "endpoint",
      endpoint: { kind: "terminal", instanceId: source, pinName: "1" },
    },
    to: {
      kind: "route-segment",
      routeId: route.id,
      legId: route.legs[0]!.id,
      point: { x, y: 80 },
    },
  });
  const before = f.document.revision;
  expect(
    f.submit([tap("first", "R1", 100), tap("second", "R2", 200)]),
  ).toMatchObject({ ok: true, applied: true });
  expect(f.commits).toBe(2);
  expect(f.document.revision).toBe(before + 1);
  expect(f.document.junctions).toHaveLength(2);
  expect(f.document.nets).toHaveLength(1);
  expect(f.document.nets[0]!.terminals).toHaveLength(4);
});
it("leaves no partial wires when a later wire is invalid", () => {
  const f = fixture();
  const before = structuredClone(f.document);
  expect(
    f.submit([f.wire("a", "R0", "R1"), f.wire("b", "R1", "missing")]),
  ).toMatchObject({ ok: false });
  expect(f.document).toEqual(before);
  expect(f.commits).toBe(0);
});
it("merges two networks created earlier in the same atomic batch", () => {
  const f = fixture();
  expect(
    f.submit([
      f.wire("a", "R0", "R1"),
      f.wire("b", "R2", "R3"),
      f.wire("join", "R1", "R2"),
    ]),
  ).toMatchObject({ ok: true, applied: true });
  expect(f.commits).toBe(1);
  expect(f.document.nets).toHaveLength(1);
  expect(f.document.nets[0]!.terminals).toHaveLength(4);
});
it("keeps a batch preview read-only and enforces the total edit limit", () => {
  const f = fixture();
  const before = structuredClone(f.document);
  expect(
    f.submit([f.wire("a", "R0", "R1"), f.wire("b", "R1", "R2")], true),
  ).toMatchObject({ ok: true, applied: false });
  expect(f.document).toEqual(before);
  expect(f.commits).toBe(0);
  const limited = fixture(1);
  expect(
    limited.submit([
      limited.wire("a", "R0", "R1"),
      limited.wire("b", "R1", "R2"),
    ]),
  ).toMatchObject({
    ok: false,
  });
  expect(limited.commits).toBe(0);
});
