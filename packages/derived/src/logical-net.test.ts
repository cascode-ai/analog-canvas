import { createEmptyDocument } from "@icm/model";
import { describe, expect, it } from "vitest";

import { resolveDocumentLogicalNets } from "./logical-net.js";

describe("resolved logical Nets", () => {
  it("keeps source provenance non-electrical while resolving scoped names deterministically", () => {
    const document = createEmptyDocument("document", "Document");
    document.nets.push(
      { id: "net-d", terminals: [] },
      { id: "net-a", terminals: [] },
      { id: "net-c", terminals: [] },
      { id: "net-b", terminals: [] },
    );
    document.connectivityEvidence.push(
      {
        id: "claim-a",
        kind: "name-claim",
        netId: "net-a",
        name: "Bias",
        owner: { kind: "explicit-net-property" },
        scope: "local",
      },
      {
        id: "claim-b",
        kind: "name-claim",
        netId: "net-b",
        name: "BIAS",
        owner: { kind: "explicit-net-property" },
        scope: "local",
      },
      {
        id: "source-b",
        kind: "spice-source",
        netId: "net-b",
        sourceNetId: "source-shared",
      },
      {
        id: "source-c",
        kind: "spice-source",
        netId: "net-c",
        sourceNetId: "source-shared",
      },
    );

    const resolved = resolveDocumentLogicalNets(document);
    expect(resolved.groups).toEqual([
      expect.objectContaining({
        id: "net-a",
        baseNetIds: ["net-a", "net-b"],
        name: "Bias",
        scope: "local",
        sourceNetIds: ["source-shared"],
        conflicts: [],
      }),
      expect.objectContaining({
        id: "net-c",
        baseNetIds: ["net-c"],
        sourceNetIds: ["source-shared"],
        conflicts: [],
      }),
      expect.objectContaining({
        id: "net-d",
        baseNetIds: ["net-d"],
        sourceNetIds: [],
        conflicts: [],
      }),
    ]);
    expect(resolved.byBaseNetId.get("net-d")?.id).toBe("net-d");
  });

  it("keeps conflicting claims on one physical Base Net inspectable", () => {
    const document = createEmptyDocument("document", "Document");
    document.nets.push({ id: "net-a", terminals: [] });
    document.connectivityEvidence.push(
      {
        id: "claim-a",
        kind: "name-claim",
        netId: "net-a",
        name: "A",
        owner: { kind: "explicit-net-property" },
        scope: "local",
      },
      {
        id: "claim-b",
        kind: "name-claim",
        netId: "net-a",
        name: "B",
        owner: { kind: "explicit-net-property" },
        scope: "global",
      },
    );
    expect(resolveDocumentLogicalNets(document).groups[0]).toMatchObject({
      baseNetIds: ["net-a"],
      conflicts: ["name-conflict", "scope-conflict"],
    });
    expect(resolveDocumentLogicalNets(document).groups[0]).not.toHaveProperty(
      "name",
    );
  });

  it("ignores inert legacy projections when resolving marker-owned names", () => {
    const document = createEmptyDocument("document", "Document");
    document.nets.push(
      { id: "legacy", terminals: [] },
      { id: "marker", terminals: [] },
    );
    document.connectivityEvidence.push({
      id: "claim-vdd",
      kind: "name-claim",
      netId: "marker",
      name: "vdd",
      owner: { kind: "explicit-net-property" },
      scope: "local",
      powerDomain: "vdd",
    });

    expect(resolveDocumentLogicalNets(document).groups).toEqual([
      expect.objectContaining({ baseNetIds: ["legacy"], powerDomain: "none" }),
      expect.objectContaining({
        baseNetIds: ["marker"],
        name: "vdd",
        powerDomain: "vdd",
      }),
    ]);
  });

  it("does not let an inert legacy projection conflict with a marker claim", () => {
    const document = createEmptyDocument("document", "Document");
    document.nets.push({
      id: "net",

      terminals: [],
    });
    document.connectivityEvidence.push({
      id: "claim-bias",
      kind: "name-claim",
      netId: "net",
      name: "BIAS",
      owner: { kind: "explicit-net-property" },
      scope: "local",
    });

    expect(resolveDocumentLogicalNets(document).groups[0]).toMatchObject({
      name: "BIAS",
      conflicts: [],
      powerDomain: "none",
    });
  });

  it("keeps a formal Cell Pin name distinct from the connected logical Net name", () => {
    const document = createEmptyDocument("document", "Document");
    document.nets.push(
      { id: "net-port", terminals: [] },
      { id: "net-label", terminals: [] },
    );
    document.netlist = {
      name: "Document",
      formalParameters: [],
      terminals: [
        {
          id: "terminal-p1",
          name: "P1",
          netId: "net-port",
          direction: "input",
          interfaceInstanceIds: ["P1"],
        },
      ],
    };
    document.connectivityEvidence.push({
      id: "claim-p1",
      kind: "name-claim",
      netId: "net-label",
      name: "P1",
      owner: { kind: "explicit-net-property" },
      scope: "local",
    });

    expect(resolveDocumentLogicalNets(document).groups).toEqual([
      expect.objectContaining({
        baseNetIds: ["net-label"],
        name: "P1",
        conflicts: [],
      }),
      expect.objectContaining({
        baseNetIds: ["net-port"],
        conflicts: [],
      }),
    ]);
    expect(resolveDocumentLogicalNets(document).groups[1]).not.toHaveProperty(
      "name",
    );
    expect(document.connectivityEvidence).toHaveLength(1);
  });
});
