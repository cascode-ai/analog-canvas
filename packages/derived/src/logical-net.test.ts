import { createEmptyDocument } from "@icm/model";
import { describe, expect, it } from "vitest";

import {
  resolveCommittedDocumentLogicalNets,
  resolveDocumentLogicalNets,
} from "./logical-net.js";

describe("resolved logical Nets", () => {
  it("reuses only explicitly committed Document revisions", () => {
    const document = createEmptyDocument("document-cache", "Document cache");
    document.nets.push({ id: "net-a", terminals: [] });

    const first = resolveCommittedDocumentLogicalNets(document);
    const repeated = resolveCommittedDocumentLogicalNets(document);
    expect(repeated).toBe(first);

    document.nets.push({ id: "net-b", terminals: [] });
    document.revision += 1;
    const revised = resolveCommittedDocumentLogicalNets(document);
    expect(revised).not.toBe(first);
    expect(revised.groups.map((group) => group.id)).toEqual(["net-a", "net-b"]);
  });

  it("keeps the raw resolver live for mutable transaction drafts", () => {
    const document = createEmptyDocument("document-draft", "Document draft");
    document.nets.push({ id: "net-a", terminals: [] });
    expect(resolveDocumentLogicalNets(document).groups).toHaveLength(1);

    document.nets.push({ id: "net-b", terminals: [] });
    expect(resolveDocumentLogicalNets(document).groups).toHaveLength(2);
  });

  it("keeps source name hints non-electrical while resolving visible scoped names deterministically", () => {
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
        owner: { kind: "net-label", annotationId: "label-a" },
        scope: "local",
      },
      {
        id: "claim-b",
        kind: "name-claim",
        netId: "net-b",
        name: "BIAS",
        owner: { kind: "net-label", annotationId: "label-b" },
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
      {
        id: "hint-c",
        kind: "net-name-hint",
        netId: "net-c",
        sourceName: "OUT",
        origin: "spice-import",
      },
      {
        id: "hint-d",
        kind: "net-name-hint",
        netId: "net-d",
        sourceName: "out",
        origin: "spice-import",
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
        owner: { kind: "net-label", annotationId: "label-a" },
        scope: "local",
      },
      {
        id: "claim-b",
        kind: "name-claim",
        netId: "net-a",
        name: "B",
        owner: { kind: "net-label", annotationId: "label-b" },
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

  it("derives global scope for same-name local and global claims on one physical Net", () => {
    const document = createEmptyDocument("document", "Document");
    document.nets.push({ id: "net-vdd", terminals: [] });
    document.connectivityEvidence.push(
      {
        id: "claim-local",
        kind: "name-claim",
        netId: "net-vdd",
        name: "VDD",
        owner: { kind: "net-label", annotationId: "label-local" },
        scope: "local",
      },
      {
        id: "claim-global",
        kind: "name-claim",
        netId: "net-vdd",
        name: "vdd",
        owner: { kind: "power-marker", objectId: "VDD1" },
        scope: "global",
        powerDomain: "vdd",
      },
    );

    expect(resolveDocumentLogicalNets(document).groups[0]).toMatchObject({
      name: "vdd",
      scope: "global",
      conflicts: [],
      evidenceIds: ["claim-global", "claim-local"],
    });
    expect(document.connectivityEvidence).toHaveLength(2);
  });

  it("does not promote a legacy source spelling into a Logical Net name", () => {
    const document = createEmptyDocument("document", "Document");
    document.nets.push(
      { id: "legacy", terminals: [] },
      { id: "marker", terminals: [] },
    );
    document.connectivityEvidence.push({
      id: "claim-vdd",
      kind: "net-name-hint",
      netId: "marker",
      sourceName: "vdd",
      origin: "legacy-explicit-net-property",
    });

    expect(resolveDocumentLogicalNets(document).groups).toEqual([
      expect.objectContaining({ baseNetIds: ["legacy"], powerDomain: "none" }),
      expect.objectContaining({
        baseNetIds: ["marker"],
        powerDomain: "none",
      }),
    ]);
    expect(resolveDocumentLogicalNets(document).groups[1]).not.toHaveProperty(
      "name",
    );
  });

  it("does not let a source name hint conflict with a visible marker claim", () => {
    const document = createEmptyDocument("document", "Document");
    document.nets.push({
      id: "net",

      terminals: [],
    });
    document.connectivityEvidence.push(
      {
        id: "hint-bias",
        kind: "net-name-hint",
        netId: "net",
        sourceName: "BIAS",
        origin: "spice-import",
      },
      {
        id: "claim-output",
        kind: "name-claim",
        netId: "net",
        name: "OUTPUT",
        owner: { kind: "power-marker", objectId: "marker" },
        scope: "local",
        powerDomain: "vdd",
      },
    );

    expect(resolveDocumentLogicalNets(document).groups[0]).toMatchObject({
      name: "OUTPUT",
      conflicts: [],
      powerDomain: "vdd",
    });
  });

  it("joins formal Cell Pins and visible labels through the same scoped name", () => {
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
      owner: { kind: "net-label", annotationId: "label-p1" },
      scope: "local",
    });

    expect(resolveDocumentLogicalNets(document).groups).toEqual([
      expect.objectContaining({
        baseNetIds: ["net-label", "net-port"],
        name: "P1",
        conflicts: [],
      }),
    ]);
    expect(document.connectivityEvidence).toHaveLength(1);
  });

  it("uses one visible formal Port spelling as the current Logical Net name", () => {
    const document = createEmptyDocument("document", "Document");
    document.nets.push({ id: "net-out", terminals: [] });
    document.netlist = {
      name: "Cell",
      terminals: [
        {
          id: "terminal-out-a",
          name: "Vout",
          netId: "net-out",
          direction: "output",
          interfaceInstanceIds: ["port-out-a"],
        },
        {
          id: "terminal-out-b",
          name: "VOUT",
          netId: "net-out",
          direction: "output",
          interfaceInstanceIds: ["port-out-b"],
        },
      ],
      formalParameters: [],
    };

    expect(resolveDocumentLogicalNets(document).groups[0]).toMatchObject({
      name: "Vout",
      baseNetIds: ["net-out"],
      formalTerminalIds: ["terminal-out-a", "terminal-out-b"],
      conflicts: [],
    });
  });
});
