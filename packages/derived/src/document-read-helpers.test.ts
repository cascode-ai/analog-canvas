import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "@icm/model";

import { resolveDocumentLogicalNets } from "./logical-net.js";
import {
  annotationNetId,
  buildTerminalBaseNetMap,
  logicalNetIdsOf,
  memberNetIds,
  terminalPinKey,
  visibleDocumentAnnotations,
} from "./document-read-helpers.js";

describe("document-read-helpers", () => {
  it("expands multi-bit member net IDs and falls back to scalar netId", () => {
    expect(memberNetIds({ netId: "n1" })).toEqual(["n1"]);
    expect(memberNetIds({ netId: "n1", members: [] })).toEqual(["n1"]);
    expect(
      memberNetIds({
        netId: "bus-net",
        members: [{ netId: "b0" }, { netId: "b1" }],
      }),
    ).toEqual(["b0", "b1"]);
  });

  it("collects multi-net terminal membership and resolves logical nets", () => {
    const doc = createEmptyDocument("doc-1", "Doc");
    doc.nets.push(
      {
        id: "n0",
        terminals: [{ instanceId: "U1", pinName: "D", memberId: "m0" }],
      },
      {
        id: "n1",
        terminals: [{ instanceId: "U1", pinName: "D", memberId: "m1" }],
      },
    );
    const map = buildTerminalBaseNetMap(doc);
    const baseIds = map.get(terminalPinKey("U1", "D"));
    expect([...(baseIds ?? [])].sort()).toEqual(["n0", "n1"]);

    const logical = resolveDocumentLogicalNets(doc);
    expect([...logicalNetIdsOf(baseIds ?? [], logical)].sort()).toEqual([
      "n0",
      "n1",
    ]);
  });

  it("resolves annotation net ownership and filters hidden annotations", () => {
    const doc = createEmptyDocument("doc-1", "Doc");
    doc.annotations.push(
      {
        id: "a-vis",
        kind: "net-label",
        netId: "legacy-net",
        binding: { kind: "net-name", netId: "bound-net" },
        anchor: { kind: "free", position: { x: 0, y: 0 } },
        alignment: "start",
        rotation: 0,
        locked: false,
      },
      {
        id: "a-hidden",
        kind: "net-label",
        netId: "hidden-net",
        visible: false,
        anchor: { kind: "free", position: { x: 0, y: 0 } },
        alignment: "start",
        rotation: 0,
        locked: false,
      },
    );
    expect(annotationNetId(doc.annotations[0]!)).toBe("bound-net");
    expect(annotationNetId(doc.annotations[1]!)).toBe("hidden-net");
    expect(visibleDocumentAnnotations(doc).map((a) => a.id)).toEqual(["a-vis"]);
  });
});
