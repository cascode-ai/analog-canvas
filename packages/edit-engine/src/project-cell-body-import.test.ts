import { describe, expect, it } from "vitest";
import {
  createEmptyProject,
  createEmptyDocument,
  type SchematicDocument,
} from "@icm/model";
import { planProjectCellBodyImport } from "./project-cell-body-import.js";
import { createHierarchyInstance } from "./hierarchy-planner.js";
import { resolveMosBulkConnection } from "@icm/derived";

function circuit(id: string, ref: string, ports = ["A", "B"]) {
  const project = createEmptyProject(id, id);
  const doc = project.documents[0]!;
  for (const name of ports) {
    const pid = `${id}-pin-${name}`,
      nid = `${id}-net-${name}`;
    doc.instances.push({ id: pid, symbolId: "port", placement: null });
    doc.nets.push({ id: nid, terminals: [{ instanceId: pid, pinName: "P" }] });
    doc.netlist!.terminals.push({
      id: `${id}-formal-${name}`,
      name,
      direction: "passive",
      netId: nid,
      interfaceInstanceIds: [pid],
    });
  }
  doc.instances.push({
    id: `${id}-r`,
    reference: ref,
    symbolId: "resistor",
    placement: null,
    netlist: {
      parameters: { value: "1k" },
      binding: { kind: "primitive", deviceClass: "resistor" },
    },
  });
  doc.nets[0]!.terminals.push({ instanceId: `${id}-r`, pinName: "1" });
  doc.nets[1]!.terminals.push({ instanceId: `${id}-r`, pinName: "2" });
  return { project, doc };
}
describe("staged Cell body composition", () => {
  it("replaces the body while preserving target identity, ordered formal IDs and callers; source order may differ", () => {
    const old = circuit("old", "R1");
    const source = circuit("source", "R2", ["B", "A"]);
    const parent = createEmptyDocument("parent", "Parent");
    parent.instances.push(
      createHierarchyInstance(
        "x",
        old.doc,
        { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
        "X1",
      ),
    );
    old.project.documents.push(parent);
    const before = structuredClone(old.project);
    const result = planProjectCellBodyImport(
      old.project,
      source.project,
      source.doc.id,
      old.doc.id,
      "replace-body",
      "candidate-1",
    );
    const changed = result.project.documents.find((d) => d.id === old.doc.id)!;
    expect(changed.id).toBe(old.doc.id);
    expect(
      changed.netlist!.terminals.map((t) => [t.id, t.name, t.direction]),
    ).toEqual(
      old.doc.netlist!.terminals.map((t) => [t.id, t.name, t.direction]),
    );
    expect(changed.instances.some((i) => i.reference === "R1")).toBe(false);
    expect(changed.instances.some((i) => i.reference === "R2")).toBe(true);
    const resistor = changed.instances.find((i) => i.reference === "R2")!;
    // Formal order is destination-owned; source B still connects resistor pin 1.
    for (const [name, pinName] of [
      ["A", "2"],
      ["B", "1"],
    ]) {
      const terminal = changed.netlist!.terminals.find((t) => t.name === name)!;
      expect(
        changed.nets.find((n) => n.id === terminal.netId)!.terminals,
      ).toContainEqual({
        instanceId: resistor.id,
        pinName,
      });
    }
    expect(result.project.documents.find((d) => d.id === parent.id)).toEqual(
      parent,
    );
    expect(old.project).toEqual(before);
  });
  it("appends through declared ports without replacing existing marker owners or names", () => {
    const old = circuit("old", "R1"),
      source = circuit("source", "R2");
    const result = planProjectCellBodyImport(
      old.project,
      source.project,
      source.doc.id,
      old.doc.id,
      "append",
      "candidate-2",
    );
    const changed = result.project.documents.find((d) => d.id === old.doc.id)!;
    expect(changed.netlist).toEqual(old.doc.netlist);
    expect(changed.instances).toHaveLength(4);
    expect(changed.instances.filter((i) => i.symbolId === "port")).toEqual(
      old.doc.instances.filter((i) => i.symbolId === "port"),
    );
    expect(changed.nets).toHaveLength(2);
    expect(changed.nets.map((n) => n.terminals.length)).toEqual([3, 3]);
  });
  it("rejects reference/interface/local-name conflicts without changing either input", () => {
    const old = circuit("old", "R1"),
      source = circuit("source", "R1");
    const before = structuredClone(old.project);
    expect(() =>
      planProjectCellBodyImport(
        old.project,
        source.project,
        source.doc.id,
        old.doc.id,
        "append",
        "c",
      ),
    ).toThrow(/Reference collision/);
    source.doc.netlist!.terminals[0]!.name = "OTHER";
    expect(() =>
      planProjectCellBodyImport(
        old.project,
        source.project,
        source.doc.id,
        old.doc.id,
        "replace-body",
        "c",
      ),
    ).toThrow(/terminal mismatch/);
    expect(old.project).toEqual(before);
    source.doc.netlist!.terminals[0]!.name = "A";
    source.doc.instances.find((i) => i.reference === "R1")!.reference = "R2";
    function addName(doc: SchematicDocument) {
      doc.nets.push({
        id: `${doc.id}-${doc.instances[0]!.id}-internal`,
        terminals: [],
      });
      const netId = doc.nets.at(-1)!.id;
      const annotationId = `${netId}-label`;
      doc.annotations.push({
        id: annotationId,
        kind: "net-label",
        netId,
        binding: { kind: "net-name", netId },
        anchor: { kind: "free", position: { x: 0, y: 0 } },
        alignment: "middle",
        rotation: 0,
        locked: false,
      });
      doc.connectivityEvidence.push({
        id: `${netId}-claim`,
        kind: "name-claim",
        netId,
        name: "INTERNAL",
        scope: "local",
        owner: { kind: "net-label", annotationId },
      });
    }
    addName(old.doc);
    addName(source.doc);
    expect(() =>
      planProjectCellBodyImport(
        old.project,
        source.project,
        source.doc.id,
        old.doc.id,
        "append",
        "c",
      ),
    ).toThrow(/Local Net name collision/);
  });
  it("imports dependencies and adopts an interface only for an uncalled empty-interface Cell", () => {
    const old = createEmptyProject("old", "old"),
      source = circuit("source", "R2");
    const child = createEmptyDocument("nested", "Nested");
    source.project.documents.push(child);
    source.doc.instances.push(
      createHierarchyInstance(
        "x",
        child,
        { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
        "X1",
      ),
    );
    const result = planProjectCellBodyImport(
      old,
      source.project,
      source.doc.id,
      old.topDocumentId,
      "replace-body",
      "c",
    );
    expect(result.importedDocumentIds).toHaveLength(1);
    expect(result.project.documents).toHaveLength(2);
    expect(
      result.project.documents[0]!.netlist!.terminals.map((t) => t.name),
    ).toEqual(["A", "B"]);
    const x = result.project.documents[0]!.instances.find(
      (i) => i.reference === "X1",
    )!;
    expect(x.netlist?.binding).toMatchObject({
      childDocumentId: result.importedDocumentIds[0],
    });
  });
  it("materializes incoming default bulk without overriding the destination default", () => {
    const old = circuit("old", "R1"),
      source = circuit("source", "R2");
    old.doc.mosBulkDefaults = { nmosNetId: old.doc.nets[0]!.id };
    source.doc.mosBulkDefaults = { nmosNetId: source.doc.nets[1]!.id };
    old.doc.instances.push({
      id: "old-mos",
      symbolId: "nmos",
      reference: "M1",
      placement: null,
    });
    source.doc.instances.push({
      id: "source-mos",
      symbolId: "nmos",
      reference: "M2",
      placement: null,
    });
    const sourceBefore = structuredClone(source.project);
    const { project } = planProjectCellBodyImport(
      old.project,
      source.project,
      source.doc.id,
      old.doc.id,
      "append",
      "bulk-candidate",
    );
    const changed = project.documents.find((d) => d.id === old.doc.id)!;
    expect(changed.mosBulkDefaults).toEqual(old.doc.mosBulkDefaults);
    expect(resolveMosBulkConnection(changed, "old-mos")?.net?.id).toBe(
      old.doc.nets[0]!.id,
    );
    const incoming = changed.instances.find((i) => i.reference === "M2")!;
    expect(resolveMosBulkConnection(changed, incoming)?.net?.id).toBe(
      old.doc.nets[1]!.id,
    );
    expect(source.project).toEqual(sourceBefore);
    delete source.doc.mosBulkDefaults;
    expect(() =>
      planProjectCellBodyImport(
        old.project,
        source.project,
        source.doc.id,
        old.doc.id,
        "append",
        "bulk-candidate",
      ),
    ).toThrow(/Resolve imported MOS bulk/);
  });
});
