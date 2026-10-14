import { buildProjectConnectivityIndex } from "@icm/derived";
import { createEmptyProject, createRoutePath } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import {
  selectionNetHighlights,
  selectionNetIds,
} from "./selection-net-highlights";
import type { VisualSelection } from "./visual-selection";

const resolver = new InMemorySymbolResolver(builtInSymbols);
const nothing: VisualSelection = {
  instanceIds: [],
  routeIds: [],
  junctionIds: [],
  annotationIds: [],
  draftingIds: [],
};

/** R1–R2 and R3–R4 are wired apart but both named OUT; R1's other end is C. */
function namedApart() {
  const project = createEmptyProject("project", "Project");
  const document = project.documents[0]!;
  document.instances = ["R1", "R2", "R3", "R4"].map((id, index) => ({
    id,
    reference: id,
    symbolId: "resistor",
    placement: {
      position: { x: 100 + (index % 2) * 200, y: 100 + (index >> 1) * 200 },
      rotation: 0 as const,
      mirror: "none" as const,
    },
    netlist: {
      binding: { kind: "primitive" as const, deviceClass: "resistor" as const },
      parameters: { value: "1k" },
    },
  }));
  document.nets = [
    {
      id: "net-a",
      terminals: [
        { instanceId: "R1", pinName: "1" },
        { instanceId: "R2", pinName: "1" },
      ],
    },
    {
      id: "net-b",
      terminals: [
        { instanceId: "R3", pinName: "1" },
        { instanceId: "R4", pinName: "1" },
      ],
    },
    { id: "net-c", terminals: [{ instanceId: "R1", pinName: "2" }] },
  ];
  document.routes = [
    ["wire-a", "net-a", "R1", "R2"],
    ["wire-b", "net-b", "R3", "R4"],
  ].map(([id, netId, from, to]) =>
    createRoutePath({
      id: id!,
      netId: netId!,
      start: { kind: "terminal", instanceId: from!, pinName: "1" },
      end: { kind: "terminal", instanceId: to!, pinName: "1" },
      bends: [],
      modes: ["manual"],
    }),
  );
  document.connectivityEvidence.push(
    ...["net-a", "net-b"].map((netId, index) => ({
      id: `claim-${netId}`,
      kind: "name-claim" as const,
      netId,
      name: "OUT",
      owner: { kind: "net-label" as const, annotationId: `label-${index}` },
      scope: "local" as const,
    })),
  );
  const index = buildProjectConnectivityIndex(project, resolver);
  const lit = (selection: Partial<VisualSelection>) =>
    selectionNetHighlights(
      index,
      document.id,
      selectionNetIds(document, resolver, { ...nothing, ...selection }, null),
      [],
    );
  return { document, lit };
}

describe("what a clicked thing connects to (2026-10-14)", () => {
  it("lights every wire that shares a clicked wire's name", () => {
    const { lit } = namedApart();
    const highlights = lit({ routeIds: ["wire-a"] });
    expect(highlights).toHaveLength(1);
    expect([...highlights[0]!.routes].sort()).toEqual(["wire-a", "wire-b"]);
  });

  it("lights the nets on a clicked part's pins, and a clicked pin's net", () => {
    const { document, lit } = namedApart();
    expect(
      lit({ instanceIds: ["R1"] })
        .flatMap(({ routes }) => routes)
        .sort(),
    ).toEqual(["wire-a", "wire-b"]);
    expect(lit({ instanceIds: ["R1"] })).toHaveLength(2);
    expect(
      selectionNetIds(document, resolver, nothing, {
        endpoint: { kind: "terminal", instanceId: "R4", pinName: "1" },
      }),
    ).toEqual(["net-b"]);
  });

  it("lights nothing for several parts or for nothing", () => {
    const { lit } = namedApart();
    expect(lit({ instanceIds: ["R1", "R2"] })).toEqual([]);
    expect(lit({})).toEqual([]);
  });
});
