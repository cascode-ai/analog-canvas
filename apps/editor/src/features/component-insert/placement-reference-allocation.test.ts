import { executeTransaction, type SchematicEdit } from "@icm/edit-engine";
import { createEmptyDocument, createEmptyProject } from "@icm/model";
import type { Instance, SchematicDocument } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import {
  initialInstanceNetlist,
  nextInstanceId,
  nextInstanceReference,
} from "../netlist-export/netlist-authoring";
import { createSelectionPropertyCommands } from "../properties/selection-property-commands";

const resolver = new InMemorySymbolResolver(builtInSymbols);
let transactionCounter = 0;

function transact(
  document: SchematicDocument,
  edits: SchematicEdit[],
): SchematicDocument {
  const result = executeTransaction(
    document,
    {
      transactionId: `ref-alloc-${transactionCounter++}`,
      documentId: document.id,
      expectedRevision: document.revision,
      actor: { kind: "human", id: "test" },
      edits,
    },
    { symbolResolver: resolver },
  );
  if (!result.ok) throw new Error(result.error.message);
  return result.document;
}

function assemblePlacedNmos(document: SchematicDocument, x: number): Instance {
  return {
    id: nextInstanceId(document, "nmos"),
    symbolId: "nmos",
    reference: nextInstanceReference(document, "nmos")!,
    placement: { position: { x, y: 100 }, rotation: 0, mirror: "none" },
    netlist: initialInstanceNetlist("nmos", {})!,
  };
}

describe("placement Reference allocation", () => {
  it("allocates object identity and authored Reference from independent domains", () => {
    const document = createEmptyDocument("main", "Main");
    document.instances.push({
      id: "M1",
      symbolId: "nmos",
      reference: "M9",
      placement: null,
      netlist: { parameters: {} },
    });

    expect(nextInstanceId(document, "nmos")).toBe("M2");
    expect(nextInstanceReference(document, "nmos")).toBe("M1");
  });

  it("a rename moves the sole Reference authority used by later allocation", () => {
    let document = createEmptyDocument("rename", "Rename");
    document = transact(document, [
      { kind: "add_instance", instance: assemblePlacedNmos(document, 100) },
    ]);
    document = transact(document, [
      { kind: "set_instance_reference", instanceId: "M1", reference: "M2" },
    ]);

    const next = assemblePlacedNmos(document, 200);
    expect(next.id).toBe("M2");
    expect(next.reference).toBe("M1");
    expect(() =>
      transact(document, [{ kind: "add_instance", instance: next }]),
    ).not.toThrow();
  });

  it("the Properties field edits the same Reference shown and emitted", () => {
    let document = createEmptyDocument("properties", "Properties");
    document = transact(document, [
      { kind: "add_instance", instance: assemblePlacedNmos(document, 100) },
    ]);
    const commands = createSelectionPropertyCommands({
      project: createEmptyProject("properties", "Properties"),
      document,
      resolver,
      selectedInstance: document.instances[0],
      selectedInstanceIsMos: true,
      selectedAnnotation: null,
      commitStructure: () => false,
      transact: (edits) => {
        document = transact(document, [...edits]);
        return { ok: true };
      },
      replaceAnnotationSelection: () => {},
      nextId: (prefix) => `${prefix}-1`,
      setStatus: () => {},
    });

    expect(commands.updateSelectedReference("M9")).toBe(true);
    expect(document.instances[0]?.reference).toBe("M9");
    expect(nextInstanceReference(document, "nmos")).toBe("M1");
  });
});
