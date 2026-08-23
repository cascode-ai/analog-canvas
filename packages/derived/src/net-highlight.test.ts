import { createEmptyDocument, createEmptyProject } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { buildProjectConnectivityIndex } from "./connectivity-index.js";
import { traceHierarchyNet } from "./net-highlight.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

const single = {
  schemaVersion: 1 as const,
  id: "single",
  name: "Single",
  viewBox: { x: -20, y: -20, width: 40, height: 40 },
  pins: [
    {
      name: "P",
      role: "passive",
      at: { x: -20, y: 0 },
      direction: "west" as const,
      presentation: { visibility: "visible" as const },
    },
  ],
  primitives: [],
  variants: [],
};

describe("Net highlight", () => {
  it("groups equal global Net names across Cells without merging local Net objects", () => {
    const project = createEmptyProject("project", "Project", "top");
    project.documents[0]!.id = "top";
    project.documents[0]!.nets.push({
      id: "net-vdd-top",
      name: "VDD",
      scope: "global",
      powerDomain: "vdd",
      terminals: [],
    });
    project.documents[0]!.connectivityEvidence.push({
      id: "claim-vdd-top",
      kind: "name-claim",
      netId: "net-vdd-top",
      name: "VDD",
      scope: "global",
      powerDomain: "vdd",
      owner: { kind: "explicit-net-property" },
    });
    const child = createEmptyDocument("child", "Child");
    child.nets.push({
      id: "net-vdd-child",
      name: "vdd",
      scope: "global",
      powerDomain: "vdd",
      terminals: [],
    });
    child.connectivityEvidence.push({
      id: "claim-vdd-child",
      kind: "name-claim",
      netId: "net-vdd-child",
      name: "vdd",
      scope: "global",
      powerDomain: "vdd",
      owner: { kind: "explicit-net-property" },
    });
    project.documents.push(child);

    const index = buildProjectConnectivityIndex(project, resolver);

    expect(index.globalNets.get("vdd")).toEqual({
      foldedName: "vdd",
      nets: [
        { documentId: "child", netId: "net-vdd-child" },
        { documentId: "top", netId: "net-vdd-top" },
      ],
    });
    const trace = traceHierarchyNet(index, "top", "net-vdd-top");
    expect(
      trace?.highlights.map((item) => [item.documentId, item.netId]),
    ).toEqual([
      ["child", "net-vdd-child"],
      ["top", "net-vdd-top"],
    ]);
    expect(trace?.hops).toContainEqual({
      direction: "global",
      from: { documentId: "top", netId: "net-vdd-top" },
      to: { documentId: "child", netId: "net-vdd-child" },
      foldedName: "vdd",
    });
  });

  it("traces a hierarchy pin attached to any Base Net in a logical group", () => {
    const project = createEmptyProject("project", "Project", "top");
    const top = project.documents[0]!;
    top.instances.push({
      id: "X1",
      symbolId: "single",
      placement: null,
      netlist: {
        reference: "X1",
        parameters: {},
        binding: {
          kind: "subcircuit",
          childDocumentId: "child",
        },
      },
    });
    top.nets.push(
      { id: "net-a", scope: "local", terminals: [] },
      {
        id: "net-b",
        scope: "local",
        terminals: [{ instanceId: "X1", pinName: "P" }],
      },
    );
    top.connectivityEvidence.push(
      {
        id: "claim-a",
        kind: "name-claim",
        netId: "net-a",
        name: "SIGNAL",
        owner: { kind: "explicit-net-property" },
        scope: "local",
      },
      {
        id: "claim-b",
        kind: "name-claim",
        netId: "net-b",
        name: "signal",
        owner: { kind: "explicit-net-property" },
        scope: "local",
      },
    );
    const child = createEmptyDocument("child", "Child");
    child.instances.push({ id: "P1", symbolId: "port", placement: null });
    child.nets.push({
      id: "child-net",
      scope: "local",
      terminals: [{ instanceId: "P1", pinName: "P" }],
    });
    child.netlist = {
      name: "child",
      formalParameters: [],
      terminals: [
        {
          id: "terminal-p",
          name: "P",
          netId: "child-net",
          direction: "passive",
          interfaceInstanceIds: ["P1"],
        },
      ],
    };
    project.documents.push(child);

    const index = buildProjectConnectivityIndex(
      project,
      new InMemorySymbolResolver([...builtInSymbols, single]),
    );
    const trace = traceHierarchyNet(index, "top", "net-b");

    expect(
      trace?.highlights.map((item) => [item.documentId, item.netId]),
    ).toEqual([
      ["child", "child-net"],
      ["top", "net-a"],
    ]);
    expect(trace?.hops).toContainEqual(
      expect.objectContaining({
        direction: "down",
        from: { documentId: "top", netId: "net-a" },
        to: { documentId: "child", netId: "child-net" },
      }),
    );
  });
});
