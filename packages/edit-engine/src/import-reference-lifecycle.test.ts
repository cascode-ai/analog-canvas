import { describe, expect, it } from "vitest";
import { importSpiceSources } from "../../spice/src/importer.js";
import {
  parseProject,
  serializeProject,
} from "../../project-protocol/src/index.js";
import { analyzeDesignNetlist } from "../../netlist/src/extract.js";
import { printSpiceNetlist } from "../../netlist/src/index.js";
import { assessImportReference, endpointKey } from "@icm/derived";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import { DocumentHistory } from "./history.js";
import type { SchematicEdit } from "./edit-schema.js";

async function fixture() {
  const text =
    "* topology-only import reference regression\nR1 A B 1k\nR2 A B 2k\nR3 C D 3k\nR4 C D 4k\n.end\n";
  const imported = await importSpiceSources(
    [{ path: "input.spi", bytes: new TextEncoder().encode(text) }],
    "input.spi",
  );
  if (!imported.project) throw new Error(JSON.stringify(imported.diagnostics));
  const project = imported.project;
  const doc = project.documents.find((d) => d.id === project.topDocumentId)!;
  const resolver = createProjectSymbolResolver(project, builtInSymbols);
  const history = new DocumentHistory(doc, { symbolResolver: resolver });
  let sequence = 0;
  const apply = (edits: SchematicEdit[]) => {
    const result = history.transact({
      transactionId: `ref-${sequence++}`,
      documentId: doc.id,
      expectedRevision: history.document.revision,
      actor: { kind: "human", id: "test" },
      edits,
    });
    if (!result.ok) throw new Error(result.error.message);
    return history.document;
  };
  return { project, doc, resolver, history, apply };
}

describe("import reference through real edit lifecycle", () => {
  it("accepts different child Ports sharing a parent node without changing the child interface", async () => {
    const source =
      "* hierarchy\n.subckt leaf A B\nR1 A B 1k\n.ends leaf\n.subckt top N M\nX1 N N leaf\nX2 N M leaf\n.ends top\n.end\n";
    const project = (
      await importSpiceSources(
        [{ path: "hierarchy.spi", bytes: new TextEncoder().encode(source) }],
        "hierarchy.spi",
      )
    ).project!;
    const resolver = createProjectSymbolResolver(project, builtInSymbols);
    for (const document of project.documents)
      expect(assessImportReference(document, resolver).issues).toEqual([]);
    const result = analyzeDesignNetlist(project);
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual(
      [],
    );
    const text = printSpiceNetlist(result.ir!);
    expect(text).toContain(".subckt leaf A B");
    expect(text).toContain("X1 N N leaf");
    expect(text).toContain("X2 N M leaf");
  });
  it("keeps source membership through merge, save/reload, reset and undo while exporting current connectivity", async () => {
    const { project, doc, resolver, history, apply } = await fixture();
    const reference = structuredClone(doc.importReference);
    const first = doc.nets.find((n) =>
      n.terminals.some((t) => t.instanceId === "R1" && t.pinName === "1"),
    )!;
    const second = doc.nets.find((n) =>
      n.terminals.some((t) => t.instanceId === "R3" && t.pinName === "1"),
    )!;
    const merged = apply([
      { kind: "merge_nets", targetNetId: first.id, sourceNetId: second.id },
    ]);
    expect(merged.importReference).toEqual(reference);
    expect(
      assessImportReference(merged, resolver).issues.map((i) => i.code),
    ).toContain("IMPORT_REFERENCE_SHORT");
    const before = analyzeDesignNetlist(project);
    const changed = {
      ...project,
      documents: project.documents.map((d) => (d.id === doc.id ? merged : d)),
    };
    const after = analyzeDesignNetlist(changed);
    expect(before.ir).not.toBeNull();
    expect(after.ir).not.toBeNull();
    const nodes = (result: typeof before, id: string) =>
      result
        .ir!.cells.flatMap((c) => c.instances)
        .find((i) => i.reference === id)?.nodes[0]?.netName;
    expect(nodes(before, "R1")).not.toBe(nodes(before, "R3"));
    expect(nodes(after, "R1")).toBe(nodes(after, "R3"));
    const loaded = parseProject(serializeProject(changed));
    expect(
      loaded.documents.find((d) => d.id === doc.id)?.importReference,
    ).toEqual(reference);
    const guides = assessImportReference(merged, resolver).guides;
    expect(
      guides.some(
        (g) =>
          [endpointKey(g.from), endpointKey(g.to)].some((k) =>
            k.includes("R1"),
          ) &&
          [endpointKey(g.from), endpointKey(g.to)].some((k) =>
            k.includes("R3"),
          ),
      ),
    ).toBe(false);
    apply([{ kind: "reset_cell_body" }]);
    expect(history.document.importReference).toEqual(reference);
    expect(
      assessImportReference(history.document, resolver).issues.some(
        (i) => i.code === "IMPORT_REFERENCE_MISSING_ENDPOINT",
      ),
    ).toBe(true);
    apply([{ kind: "undo" }]);
    expect(history.document.nets).toEqual(merged.nets);
    apply([{ kind: "undo" }]);
    expect(history.document.nets).toEqual(doc.nets);
    expect(history.document.importReference).toEqual(reference);
    apply([{ kind: "redo" }]);
    expect(history.document.nets).toEqual(merged.nets);
  });

  it("preserves source-position mapping when a symbol's pins are renamed", async () => {
    const { doc, resolver, apply } = await fixture();
    // Switching symmetric resistor pins is an explicit pinMap, not a name guess.
    const mapped = apply([
      {
        kind: "set_instance_symbol",
        instanceId: "R1",
        symbolId: "resistor",
        pinMap: { "1": "2", "2": "1" },
      },
    ]);
    expect(mapped.importReference).toEqual(doc.importReference);
    expect(assessImportReference(mapped, resolver).issues).toEqual([]);
  });
});
