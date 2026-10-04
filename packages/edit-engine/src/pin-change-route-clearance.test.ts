import {
  buildProjectConnectivityIndex,
  resolveRouteGeometry,
  runErcChecks,
} from "@icm/derived";
import { createEmptyProject, createRoutePath } from "@icm/model";
import type { SchematicDocument } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { planPinChangeRouteClearance } from "./pin-change-route-clearance.js";
import type { SchematicEdit } from "./edit-schema.js";
import { executeTransaction } from "./transaction.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

/**
 * The difference amplifier of #1309: X3 at (260, 0), IN- at (220, -10) and
 * IN+ at (220, 10), fed down and up the one column x = 200.
 */
function fedOpamp() {
  const project = createEmptyProject("swap", "Swap", "doc");
  const document = project.documents[0]!;
  document.instances.push({
    id: "X3",
    symbolId: "opamp",
    placement: { position: { x: 260, y: 0 }, rotation: 0, mirror: "none" },
  });
  for (const [netId, pinName, far, bend] of [
    ["net1", "IN-", { x: 200, y: -60 }, { x: 200, y: -10 }],
    ["net5", "IN+", { x: 200, y: 100 }, { x: 200, y: 10 }],
  ] as const) {
    document.nets.push({
      id: netId,
      terminals: [{ instanceId: "X3", pinName }],
    });
    document.junctions.push({ id: `${netId}-far`, netId, position: far });
    document.routes.push(
      createRoutePath({
        id: `${netId}-wire`,
        netId,
        start: { kind: "junction", junctionId: `${netId}-far` },
        end: { kind: "terminal", instanceId: "X3", pinName },
        bends: [bend],
        modes: ["manual", "manual"],
      }),
    );
  }
  return project;
}

function committed(document: SchematicDocument, edits: SchematicEdit[]) {
  const result = executeTransaction(
    document,
    {
      transactionId: "swap",
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

function overlaps(document: SchematicDocument) {
  const project = { ...fedOpamp(), documents: [document] };
  return runErcChecks(
    project,
    buildProjectConnectivityIndex(project, resolver),
    resolver,
  ).filter((item) => item.code === "ERC_OVERLAPPING_NETS");
}

describe("swapping a wired op-amp's inputs (#1309)", () => {
  const swap: SchematicEdit[] = [
    {
      kind: "set_instance_symbol",
      instanceId: "X3",
      symbolId: "opamp-inputs-swapped",
    },
  ];

  it("stretched alone, lays the two input Nets on one line", () => {
    const document = fedOpamp().documents[0]!;
    expect(overlaps(committed(document, swap))).toHaveLength(1);
  });

  it("draws the stretched wires clear of each other, Nets unchanged", () => {
    const document = fedOpamp().documents[0]!;
    const clearing = planPinChangeRouteClearance(document, resolver, swap);
    expect(clearing.length).toBeGreaterThan(0);
    const after = committed(document, [...swap, ...clearing]);
    expect(overlaps(after)).toEqual([]);
    expect(after.nets).toEqual(document.nets);
    // Each wire still runs from its far end to its own pin.
    for (const route of after.routes) {
      const line = resolveRouteGeometry(after, resolver, route)!.centerline;
      const far = document.junctions.find(
        (junction) => junction.netId === route.netId,
      )!.position;
      expect(line[0]).toEqual(far);
    }
  });

  it("never brings a redrawn wire onto another Net's open end", () => {
    // Each pin of a differential amplifier runs straight out to an open end
    // 20 apart; after the swap a clear path for one input could pass the
    // other input's end, which would join the two Nets.
    const project = createEmptyProject("diff", "Diff", "doc");
    const document = project.documents[0]!;
    document.instances.push({
      id: "X1",
      symbolId: "opamp-differential-lettered",
      placement: { position: { x: 360, y: 230 }, rotation: 0, mirror: "none" },
      signalFlowParameters: { formula: "G" },
    });
    for (const [pinName, x, y] of [
      ["IN+", 180, 240],
      ["IN-", 180, 220],
      ["OUT+", 520, 240],
      ["OUT-", 520, 220],
    ] as const) {
      document.nets.push({
        id: `net-${pinName}`,
        terminals: [{ instanceId: "X1", pinName }],
      });
      document.junctions.push({
        id: `end-${pinName}`,
        netId: `net-${pinName}`,
        position: { x, y },
      });
      document.routes.push(
        createRoutePath({
          id: `wire-${pinName}`,
          netId: `net-${pinName}`,
          start: { kind: "terminal", instanceId: "X1", pinName },
          end: { kind: "junction", junctionId: `end-${pinName}` },
          bends: [],
          modes: ["manual"],
        }),
      );
    }
    for (const symbolId of [
      "opamp-differential-lettered-inputs-swapped",
      "opamp-differential-crossed-lettered",
    ]) {
      const change: SchematicEdit[] = [
        { kind: "set_instance_symbol", instanceId: "X1", symbolId },
      ];
      const after = committed(document, [
        ...change,
        ...planPinChangeRouteClearance(document, resolver, change),
      ]);
      expect(after.nets).toEqual(document.nets);
      expect(after.routes.map((route) => route.netId)).toEqual(
        document.routes.map((route) => route.netId),
      );
    }
  });

  it("plans nothing for a change that moves no pin", () => {
    const document = fedOpamp().documents[0]!;
    expect(
      planPinChangeRouteClearance(document, resolver, [
        { kind: "move_instance", instanceId: "X3", position: { x: 300, y: 0 } },
      ]),
    ).toEqual([]);
  });
});
