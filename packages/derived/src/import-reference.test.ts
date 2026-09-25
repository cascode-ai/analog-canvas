import { describe, expect, it } from "vitest";
import {
  createEmptyDocument,
  createEmptyProject,
  createRoutePath,
} from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { assessImportReference } from "./import-reference.js";
import { buildProjectConnectivityIndex } from "./connectivity-index.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
function fixture() {
  const doc = createEmptyDocument("main", "Main");
  doc.instances = ["A", "B", "C", "D"].map((id, i) => ({
    id,
    symbolId: "port",
    placement: { position: { x: i * 100, y: 0 }, rotation: 0, mirror: "none" },
  }));
  doc.nets = [
    ["A", "B"],
    ["C", "D"],
  ].map((ids, i) => ({
    id: `N${i}`,
    terminals: ids.map((instanceId) => ({ instanceId, pinName: "P" })),
  }));
  doc.importReference = {
    files: [],
    nets: doc.nets.map((n) => ({
      id: n.id,
      name: n.id,
      scope: "local",
      terminals: structuredClone(n.terminals),
    })),
  };
  return doc;
}
const pairs = (doc: ReturnType<typeof fixture>) =>
  assessImportReference(doc, resolver).guides.map((g) =>
    [g.from, g.to]
      .map((e) => (e.kind === "terminal" ? e.instanceId : "junction"))
      .sort()
      .join("-"),
  );

describe("frozen import reference", () => {
  it("reports lost global identity even if local membership is unchanged", () => {
    const doc = fixture();
    doc.importReference!.nets[0]!.scope = "global";
    doc.importReference!.nets[0]!.name = "VDD";
    expect(
      assessImportReference(doc, resolver).issues.map((i) => i.code),
    ).toEqual(["IMPORT_REFERENCE_SCOPE_CHANGED"]);
  });
  it("uses folded owner labels as virtual drawing edges and recomputes after removal", () => {
    const doc = fixture();
    doc.nets = [
      { id: "A", terminals: [{ instanceId: "A", pinName: "P" }] },
      { id: "B", terminals: [{ instanceId: "B", pinName: "P" }] },
      doc.nets[1]!,
    ];
    doc.annotations = ["A", "B"].map((id, index) => ({
      id: `label-${id}`,
      kind: "net-label",
      netId: id,
      binding: { kind: "net-name", netId: id },
      anchor: { kind: "free", position: { x: index * 100, y: 0 } },
      alignment: "middle",
      rotation: 0,
      locked: false,
    }));
    doc.connectivityEvidence = ["A", "B"].map((id, index) => ({
      id: `claim-${id}`,
      kind: "name-claim",
      netId: id,
      name: index ? "vbias" : "VBIAS",
      scope: "local",
      owner: { kind: "net-label", annotationId: `label-${id}` },
    }));
    expect(pairs(doc)).toEqual(["C-D"]);
    const removed = structuredClone(doc);
    removed.annotations = [];
    removed.connectivityEvidence = [];
    expect(pairs(removed)).toEqual(["A-B", "C-D"]);
  });
  it("shows unrouted original membership without reporting an electrical open", () => {
    const doc = fixture();
    expect(pairs(doc)).toEqual(["A-B", "C-D"]);
    expect(assessImportReference(doc, resolver).issues).toEqual([]);
  });
  it("never recruits foreign terminals after merge and split lineage pollution", () => {
    const doc = fixture();
    const original = structuredClone(doc.importReference);
    doc.nets = [
      { id: "merged", terminals: doc.nets.flatMap((n) => n.terminals) },
    ];
    doc.connectivityEvidence = ["N0", "N1"].map((sourceNetId) => ({
      id: sourceNetId,
      kind: "spice-source",
      netId: "merged",
      sourceNetId,
    }));
    expect(pairs(doc)).toEqual(["A-B", "C-D"]);
    expect(
      assessImportReference(doc, resolver).issues.map((i) => i.code),
    ).toContain("IMPORT_REFERENCE_SHORT");
    const split = structuredClone(doc);
    split.nets = doc.nets[0]!.terminals.map((t) => ({
      id: t.instanceId,
      terminals: [t],
    }));
    split.connectivityEvidence = split.nets.flatMap((n) =>
      ["N0", "N1"].map((sourceNetId) => ({
        id: n.id + sourceNetId,
        kind: "spice-source" as const,
        netId: n.id,
        sourceNetId,
      })),
    );
    expect(pairs(split)).toEqual(["A-B", "C-D"]);
    expect(
      assessImportReference(split, resolver).issues.map((i) => i.code),
    ).toEqual(["IMPORT_REFERENCE_OPEN", "IMPORT_REFERENCE_OPEN"]);
    expect(split.importReference).toEqual(original);
  });
  it("accepts same-name formal Ports as a drawing expression across Base Nets", () => {
    const doc = fixture();
    doc.nets = [
      { id: "A", terminals: [{ instanceId: "A", pinName: "P" }] },
      { id: "B", terminals: [{ instanceId: "B", pinName: "P" }] },
      doc.nets[1]!,
    ];
    doc.netlist = {
      name: "main",
      formalParameters: [],
      terminals: ["A", "B"].map((id, i) => ({
        id: `pin-${id}`,
        name: i ? "vin" : "VIN",
        netId: id,
        direction: "input",
        interfaceInstanceIds: [id],
      })),
    };
    expect(pairs(doc)).toEqual(["C-D"]);
    expect(assessImportReference(doc, resolver).issues).toEqual([]);
  });
  it("keeps guides to disconnected but extant terminals in the document index", () => {
    const doc = fixture();
    doc.nets[0]!.terminals = doc.nets[0]!.terminals.filter(
      (t) => t.instanceId !== "B",
    );
    const project = createEmptyProject("project", "Project");
    project.documents = [doc];
    project.topDocumentId = doc.id;
    const guides = buildProjectConnectivityIndex(
      project,
      resolver,
    ).documents.get(doc.id)!.routingGuidance;
    expect(guides).toHaveLength(2);
    expect(guides.some((g) => g.fromNetId === null || g.toNetId === null)).toBe(
      true,
    );
  });
  it("reports missing and unplaced members without inventing coordinates", () => {
    const doc = fixture();
    doc.instances = doc.instances.filter((i) => i.id !== "B");
    doc.nets[0]!.terminals = doc.nets[0]!.terminals.filter(
      (t) => t.instanceId !== "B",
    );
    doc.instances.find((i) => i.id === "C")!.placement = null;
    const result = assessImportReference(doc, resolver);
    expect(result.guides).toEqual([]);
    expect(result.issues.map((i) => i.code)).toEqual([
      "IMPORT_REFERENCE_MISSING_ENDPOINT",
      "IMPORT_REFERENCE_UNPLACED",
    ]);
  });
  it("does not hide a wrong short even when physical routing is complete", () => {
    const doc = fixture();
    doc.nets = [
      { id: "merged", terminals: doc.nets.flatMap((n) => n.terminals) },
    ];
    doc.routes = ["A", "B", "C"].map((id, i) =>
      createRoutePath({
        id: `wire${i}`,
        netId: "merged",
        start: { kind: "terminal", instanceId: id, pinName: "P" },
        end: {
          kind: "terminal",
          instanceId: ["B", "C", "D"][i]!,
          pinName: "P",
        },
        bends: [],
        modes: ["manual"],
      }),
    );
    const result = assessImportReference(doc, resolver);
    expect(result.guides).toEqual([]);
    expect(result.issues.map((i) => i.code)).toEqual([
      "IMPORT_REFERENCE_SHORT",
    ]);
  });
  it("never reconstructs an old reference from source evidence", () => {
    const doc = fixture();
    delete doc.importReference;
    doc.connectivityEvidence = [
      {
        id: "source",
        kind: "spice-source",
        netId: "N0",
        sourceNetId: "original",
      },
    ];
    expect(assessImportReference(doc, resolver)).toMatchObject({
      available: false,
      guides: [],
      issues: [{ code: "IMPORT_REFERENCE_UNAVAILABLE" }],
    });
  });
});
