import {
  createEmptyDocument,
  createRoutePath,
  type Annotation,
  type SchematicDocument,
} from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { executeTransaction, type SchematicEdit } from "./transaction.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function label(
  id: string,
  netId: string,
  position: { x: number; y: number },
): Annotation {
  return {
    id,
    kind: "net-label",
    netId,
    binding: { kind: "net-name", netId },
    anchor: { kind: "free", position },
    alignment: "start",
    rotation: 0,
    locked: false,
  };
}

/**
 * R1's lower pin (0, 20) runs down a stub to the dangling end E at (0, 60),
 * named OUT by a free label just beside it. A second OUT label sits far
 * away, and a label of another Net sits beside E too.
 */
function stub(): SchematicDocument {
  const document = createEmptyDocument("stub", "Stub");
  for (const [id, x] of [
    ["R1", 0],
    ["R2", 200],
  ] as const) {
    document.instances.push({
      id,
      reference: id,
      symbolId: "resistor",
      placement: { position: { x, y: 0 }, rotation: 0, mirror: "none" },
      netlist: { parameters: { value: "1k" } },
    });
  }
  document.nets.push(
    { id: "out", terminals: [{ instanceId: "R1", pinName: "2" }] },
    { id: "other", terminals: [{ instanceId: "R2", pinName: "2" }] },
  );
  document.junctions.push({
    id: "E",
    netId: "out",
    position: { x: 0, y: 60 },
    role: "branch",
  });
  document.routes.push(
    createRoutePath({
      id: "stub",
      netId: "out",
      start: { kind: "terminal", instanceId: "R1", pinName: "2" },
      end: { kind: "junction", junctionId: "E" },
      bends: [],
      modes: ["manual"],
    }),
  );
  document.annotations.push(
    label("out-at-end", "out", { x: 6, y: 64 }),
    label("out-far", "out", { x: 0, y: 200 }),
    label("other-at-end", "other", { x: -8, y: 56 }),
  );
  document.connectivityEvidence.push(
    ...[
      ["out-at-end", "out", "OUT"],
      ["out-far", "out", "OUT"],
      ["other-at-end", "other", "OTHER"],
    ].map(([annotationId, netId, name]) => ({
      id: `claim-${annotationId}`,
      kind: "name-claim" as const,
      netId: netId!,
      name: name!,
      owner: { kind: "net-label" as const, annotationId: annotationId! },
      scope: "local" as const,
    })),
  );
  return document;
}

function apply(document: SchematicDocument, edits: SchematicEdit[]) {
  const result = executeTransaction(
    document,
    {
      transactionId: "move",
      documentId: document.id,
      expectedRevision: document.revision,
      actor: { kind: "human", id: "test" },
      edits,
    },
    { symbolResolver: resolver },
  );
  if (!result.ok) throw new Error(result.error.message);
  return result.document;
}

const annotation = (document: SchematicDocument, id: string) =>
  document.annotations.find((candidate) => candidate.id === id)!;

describe("free Net labels at a stub end (#2293)", () => {
  it("move with the stub end's Junction and keep their Net", () => {
    const before = stub();
    const moved = apply(before, [
      { kind: "move_junction", junctionId: "E", position: { x: 0, y: 90 } },
      {
        kind: "set_route_path",
        route: createRoutePath({
          id: "stub",
          netId: "out",
          start: { kind: "terminal", instanceId: "R1", pinName: "2" },
          end: { kind: "junction", junctionId: "E" },
          bends: [],
          modes: ["manual"],
        }),
      },
    ]);
    expect(annotation(moved, "out-at-end")).toEqual({
      ...annotation(before, "out-at-end"),
      anchor: { kind: "free", position: { x: 6, y: 94 } },
    });
    expect(annotation(moved, "out-far")).toEqual(annotation(before, "out-far"));
    expect(annotation(moved, "other-at-end")).toEqual(
      annotation(before, "other-at-end"),
    );
    expect(moved.connectivityEvidence).toEqual(before.connectivityEvidence);
  });

  it("move when a part move carries the stub end", () => {
    const moved = apply(stub(), [
      {
        kind: "move_instance",
        instanceId: "R1",
        position: { x: 40, y: 0 },
      },
    ]);
    expect(moved.junctions.find(({ id }) => id === "E")!.position).toEqual({
      x: 40,
      y: 60,
    });
    expect(annotation(moved, "out-at-end").anchor).toEqual({
      kind: "free",
      position: { x: 46, y: 64 },
    });
    expect(annotation(moved, "out-far").anchor).toEqual({
      kind: "free",
      position: { x: 0, y: 200 },
    });
  });

  it("stay where the transaction itself puts them", () => {
    const before = stub();
    const placed = { kind: "free" as const, position: { x: 100, y: 100 } };
    const moved = apply(before, [
      { kind: "move_junction", junctionId: "E", position: { x: 0, y: 90 } },
      {
        kind: "set_route_path",
        route: createRoutePath({
          id: "stub",
          netId: "out",
          start: { kind: "terminal", instanceId: "R1", pinName: "2" },
          end: { kind: "junction", junctionId: "E" },
          bends: [],
          modes: ["manual"],
        }),
      },
      {
        kind: "upsert_schematic_annotation",
        annotation: { ...annotation(before, "out-at-end"), anchor: placed },
      },
    ]);
    expect(annotation(moved, "out-at-end").anchor).toEqual(placed);
  });
});
