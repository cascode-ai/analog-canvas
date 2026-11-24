import { createEmptyDocument, createEmptyProject } from "@icm/model";
import { describe, expect, it } from "vitest";

import { deriveProjectNetNameProjection } from "./net-name-projection.js";

function addClaim(
  document: ReturnType<typeof createEmptyDocument>,
  input: {
    id: string;
    netId: string;
    name: string;
    owner: "label" | "global-declaration";
  },
): void {
  if (input.owner === "label") {
    const annotationId = `annotation-${input.id}`;
    document.annotations.push({
      id: annotationId,
      kind: "net-label",
      binding: { kind: "net-name", netId: input.netId },
      netId: input.netId,
      anchor: { kind: "free", position: { x: 0, y: 0 } },
      alignment: "start",
      rotation: 0,
      locked: false,
    });
    document.connectivityEvidence.push({
      id: input.id,
      kind: "name-claim",
      netId: input.netId,
      name: input.name,
      scope: "global",
      owner: { kind: "net-label", annotationId },
    });
    return;
  }
  document.connectivityEvidence.push({
    id: input.id,
    kind: "name-claim",
    netId: input.netId,
    name: input.name,
    scope: "global",
    owner: { kind: "global-declaration", sourceNetId: input.netId },
  });
}

describe("Project Net name projection", () => {
  it("reads naming evidence in proportion to the number of independent Nets", () => {
    function countReads(count: number) {
      const project = createEmptyProject("project", "Project", "top");
      const doc = project.documents[0]!;
      let reads = 0;
      for (let i = 0; i < count; i++) {
        const id = `n-${i}`;
        doc.nets.push({ id, terminals: [] });
        doc.connectivityEvidence.push({
          kind: "net-name-hint",
          id: `hint-${i}`,
          get netId() {
            reads++;
            return id;
          },
          sourceName: `sig${i}`,
          origin: "spice-import",
        });
      }
      const projected = deriveProjectNetNameProjection(
        project,
      ).byDocumentId.get(doc.id)!;
      expect(projected.size).toBe(count);
      expect(projected.get(`n-${count - 1}`)?.preferredSpelling).toBe(
        `sig${count - 1}`,
      );
      return reads;
    }
    expect(countReads(64)).toBeLessThanOrEqual(5 * countReads(16));
  });

  it("prefers current object-owned spelling independently of Evidence ID", () => {
    const project = createEmptyProject("project", "Project", "top");
    const top = project.documents[0]!;
    top.nets.push({ id: "net-vdd", terminals: [] });
    addClaim(top, {
      id: "a-imported",
      netId: "net-vdd",
      name: "vdd",
      owner: "global-declaration",
    });
    addClaim(top, {
      id: "z-visible",
      netId: "net-vdd",
      name: "VDD",
      owner: "label",
    });

    const projected = deriveProjectNetNameProjection(project)
      .byDocumentId.get("top")
      ?.get("net-vdd");

    expect(projected).toMatchObject({
      spellings: ["VDD", "vdd"],
      preferredSpelling: "VDD",
      scope: "global",
    });
  });

  it("uses the nearest reachable spelling and ignores orphan influence", () => {
    const project = createEmptyProject("project", "Project", "top");
    const top = project.documents[0]!;
    const child = createEmptyDocument("child", "Child");
    const orphan = createEmptyDocument("orphan", "Orphan");
    project.documents.push(child, orphan);
    top.instances.push({
      id: "X1",
      symbolId: "child-symbol",
      placement: null,
      reference: "X1",
      netlist: {
        binding: { kind: "subcircuit", childDocumentId: "child" },
        parameters: {},
      },
    });
    for (const [document, netId, spelling] of [
      [top, "net-top", "VDD"],
      [child, "net-child", "vdd"],
      [orphan, "net-orphan", "Vdd"],
    ] as const) {
      document.nets.push({ id: netId, terminals: [] });
      addClaim(document, {
        id: `claim-${netId}`,
        netId,
        name: spelling,
        owner: "label",
      });
    }

    const projection = deriveProjectNetNameProjection(project);
    expect(projection.byDocumentId.get("top")?.get("net-top")).toMatchObject({
      spellings: ["VDD", "vdd"],
      preferredSpelling: "VDD",
    });
    expect(
      projection.byDocumentId.get("child")?.get("net-child"),
    ).toMatchObject({
      spellings: ["VDD", "vdd"],
      preferredSpelling: "VDD",
    });
    expect(
      projection.byDocumentId.get("orphan")?.get("net-orphan"),
    ).toMatchObject({
      spellings: ["VDD", "vdd"],
      preferredSpelling: "VDD",
    });
  });

  it("assigns each scalar spelling of a bus label and a formal port to its current logical Net", () => {
    const project = createEmptyProject("project", "Bus", "top");
    const doc = project.documents[0]!;
    for (const id of ["bundle", "high", "low"])
      doc.nets.push({ id, terminals: [] });
    const members = [
      { id: "m1", netId: "high", name: "bus<1>" },
      { id: "m0", netId: "low", name: "bus<0>" },
    ];
    doc.netlist = {
      name: "top",
      formalParameters: [],
      terminals: [
        {
          id: "port",
          name: "BUS<1:0>",
          netId: "bundle",
          direction: "inout",
          interfaceInstanceIds: [],
          signal: {
            expression: "BUS<1:0>",
            members: members.map((m) => ({ ...m, name: m.name.toUpperCase() })),
          },
        },
      ],
    };
    doc.connectivityEvidence.push({
      id: "claim",
      kind: "name-claim",
      owner: { kind: "net-label", annotationId: "label" },
      netId: "bundle",
      scope: "local",
      name: "bus<1:0>",
      signal: { expression: "bus<1:0>", members },
    });
    function names(id: string) {
      return deriveProjectNetNameProjection(project)
        .byDocumentId.get(doc.id)
        ?.get(id)?.spellings;
    }
    expect(names("bundle")).toEqual([]);
    expect(names("high")).toEqual(["BUS<1>", "bus<1>"]);
    expect(names("low")).toEqual(["BUS<0>", "bus<0>"]);
    members.reverse();
    expect(names("high")).toEqual(["BUS<1>", "bus<1>"]);
  });

  it("uses a unique source hint only for an otherwise unnamed Net", () => {
    const project = createEmptyProject("project", "Project", "top");
    const top = project.documents[0]!;
    top.nets.push({ id: "net-imported", terminals: [] });
    top.connectivityEvidence.push({
      id: "hint",
      kind: "net-name-hint",
      netId: "net-imported",
      sourceName: "bias.p",
      origin: "spice-import",
    });

    expect(
      deriveProjectNetNameProjection(project)
        .byDocumentId.get("top")
        ?.get("net-imported"),
    ).toMatchObject({
      spellings: ["bias.p"],
      preferredSpelling: "bias.p",
      scope: "local",
    });
  });
});
