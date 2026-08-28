/**
 * Wire-transform audit batch 3, net-label pair: a rigid translation keeps
 * the persisted anchor byte-for-byte (#10), and splitting a labelled wire
 * retargets the label onto the right half instead of rejecting (#13).
 */
import { createEmptyDocument, createRoutePath } from "@icm/model";
import type { SchematicDocument } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { executeTransaction } from "./transaction.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function fixture(): SchematicDocument {
  const document = createEmptyDocument("document-follow", "Follow");
  document.instances.push(
    {
      id: "P1",
      symbolId: "port",
      placement: { position: { x: 140, y: 300 }, rotation: 0, mirror: "none" },
    },
    {
      id: "P2",
      symbolId: "port",
      placement: { position: { x: 460, y: 300 }, rotation: 0, mirror: "x" },
    },
  );
  document.nets.push({
    id: "net-h",
    terminals: [
      { instanceId: "P1", pinName: "P" },
      { instanceId: "P2", pinName: "P" },
    ],
  });
  document.netlist = {
    name: "cell",
    formalParameters: [],
    terminals: [
      {
        id: "cell-terminal-p1",
        name: "T1",
        netId: "net-h",
        direction: "passive",
        interfaceInstanceIds: ["P1"],
      },
      {
        id: "cell-terminal-p2",
        name: "T2",
        netId: "net-h",
        direction: "passive",
        interfaceInstanceIds: ["P2"],
      },
    ],
  };
  const route = createRoutePath({
    id: "r1",
    netId: "net-h",
    start: { kind: "terminal", instanceId: "P1", pinName: "P" },
    end: { kind: "terminal", instanceId: "P2", pinName: "P" },
    bends: [],
    modes: ["manual"],
  });
  document.routes.push(route);
  document.annotations.push({
    id: "nl-1",
    kind: "net-label",
    binding: { kind: "net-name", netId: "net-h" },
    netId: "net-h",
    anchor: {
      kind: "route",
      routeId: "r1",
      legId: route.legs[0]!.id,
      t: 0.3,
      normalOffset: -8,
      direction: "forward",
      orientation: "follow",
      // The exact point (240,292) as the editor persists it: snapped.
      fallbackPosition: { x: 240, y: 290 },
    },
    alignment: "middle",
    rotation: 0,
    locked: false,
  });
  return document;
}

function anchorOf(document: SchematicDocument) {
  const anchor = document.annotations.find((a) => a.id === "nl-1")!.anchor;
  if (anchor.kind !== "route") throw new Error("route anchor expected");
  return anchor;
}

describe("net-label anchors under routing transactions", () => {
  it("a rigid translation preserves t and normalOffset byte-for-byte (#10)", () => {
    let document = fixture();
    // Three consecutive rigid +20x translations: the anchor must not creep.
    for (let step = 1; step <= 3; step += 1) {
      const result = executeTransaction(
        document,
        {
          transactionId: `follow-${step}`,
          documentId: document.id,
          expectedRevision: document.revision,
          actor: { kind: "human", id: "test" },
          edits: [
            {
              kind: "move_instance",
              instanceId: "P1",
              position: { x: 140 + step * 20, y: 300 },
            },
            {
              kind: "move_instance",
              instanceId: "P2",
              position: { x: 460 + step * 20, y: 300 },
            },
          ],
        },
        { symbolResolver: resolver },
      );
      if (!result.ok) throw new Error(result.error.message);
      document = result.document;
      const anchor = anchorOf(document);
      expect(anchor.t).toBe(0.3);
      expect(anchor.normalOffset).toBe(-8);
    }
  });

  it("splitting a labelled route retargets the label onto the right half (#13)", () => {
    const document = fixture();
    const route = document.routes[0]!;
    const result = executeTransaction(
      document,
      {
        transactionId: "split-label",
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "human", id: "test" },
        edits: [
          {
            kind: "add_junction",
            junctionId: "j-split",
            netId: "net-h",
            position: { x: 300, y: 300 },
            split: {
              routeId: "r1",
              firstRouteId: "r1-first",
              secondRouteId: "r1-second",
              legId: route.legs[0]!.id,
            },
          },
        ],
      },
      { symbolResolver: resolver },
    );
    if (!result.ok) throw new Error(result.error.message);
    const anchor = anchorOf(result.document);
    // Label conductor point was at x = 150 + 0.3 * 300 = 240 — the first
    // half (150..300) owns it.
    expect(anchor.routeId).toBe("r1-first");
    expect(anchor.normalOffset).toBe(-8);
    const half = result.document.routes.find((r) => r.id === "r1-first")!;
    expect(half.legs.some((leg) => leg.id === anchor.legId)).toBe(true);
  });
});
