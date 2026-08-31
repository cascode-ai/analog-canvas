/**
 * Issue #394: "Transaction result failed Document validation" while placing
 * an nmos.
 *
 * Placement assembles a new Instance with
 * `schematicReference: netlist?.reference ?? id`, where `netlist.reference`
 * comes from nextReference() — an allocator that only avoids the
 * netlist.reference domain. The document-level schema additionally requires
 * schematicReference to be unique across instances (case-insensitively).
 * Ordinary edits can part the two domains, in either direction:
 * `set_instance_schematic_reference` (Agent API) renames only the visible
 * designator, leaving netlist.reference behind; the properties panel's
 * Netlist reference field (`set_instance_reference`) moves only
 * netlist.reference, leaving the visible designator behind. After either,
 * the lowest free netlist reference can equal an occupied
 * schematicReference, and every subsequent placement of that prefix assembles
 * a duplicate — rejected at commit as INVALID_RESULT with
 * "Duplicate schematic instance reference: <ref>". The user-visible headline
 * is exactly the screenshot in #394, and it recurs on every retry.
 *
 * RED until placement allocation respects both reference domains.
 */
import { executeTransaction } from "@icm/edit-engine";
import type { SchematicEdit } from "@icm/edit-engine";
import { createEmptyDocument, createEmptyProject } from "@icm/model";
import type { Instance, SchematicDocument } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import {
  initialInstanceNetlist,
  nextInstanceDesignator,
} from "../netlist-export/netlist-authoring";
import { createSelectionPropertyCommands } from "../properties/selection-property-commands";
import { defaultRazaviSymbolVariantId } from "../../presentation/razavi-presentation";

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
  if (!result.ok) {
    throw new Error(
      `setup transaction failed: ${result.error.message} :: ${
        result.diagnostics[0]?.message ?? ""
      }`,
    );
  }
  return result.document;
}

/** The exact assembly placeNewComponent performs for a plain symbol click. */
function assemblePlacedNmos(
  document: SchematicDocument,
  x: number,
  y: number,
): Instance {
  const id = nextInstanceDesignator(document, "nmos");
  const symbolVariantId = defaultRazaviSymbolVariantId("nmos");
  const netlist = initialInstanceNetlist(document, "nmos", {}, undefined);
  return {
    id,
    symbolId: "nmos",
    schematicReference: netlist?.reference ?? id,
    ...(symbolVariantId ? { symbolVariantId } : {}),
    placement: { position: { x, y }, rotation: 0, mirror: "none" },
    ...(netlist ? { netlist } : {}),
  } as Instance;
}

describe("placement reference allocation", () => {
  it("places an nmos after delete + rename move a designator between domains (#394)", () => {
    let document = createEmptyDocument("issue-394", "Issue 394");

    // Place two nmos the way the GUI does: M1, then M2.
    const m1 = assemblePlacedNmos(document, 100, 100);
    document = transact(document, [{ kind: "add_instance", instance: m1 }]);
    const m2 = assemblePlacedNmos(document, 200, 100);
    document = transact(document, [{ kind: "add_instance", instance: m2 }]);
    expect([m1.id, m2.id]).toEqual(["M1", "M2"]);

    // Delete M1, then rename M2's visible designator to the vacated "M1".
    // Both edits succeed — the document stays valid throughout.
    document = transact(document, [
      { kind: "remove_instance", instanceId: "M1" },
    ]);
    document = transact(document, [
      {
        kind: "set_instance_schematic_reference",
        instanceId: "M2",
        reference: "M1",
      },
    ]);

    // Place another nmos. The allocator hands out netlist reference "M1"
    // (free in its own domain), placement promotes it to schematicReference,
    // and the commit is refused: "Transaction result failed Document
    // validation — Duplicate schematic instance reference: M1". A plain
    // placement on a valid document must commit instead.
    const next = assemblePlacedNmos(document, 300, 100);
    const result = executeTransaction(
      document,
      {
        transactionId: "ref-alloc-final",
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "human", id: "test" },
        edits: [{ kind: "add_instance", instance: next }],
      },
      { symbolResolver: resolver },
    );

    expect(
      result.ok,
      `placement was refused: ${!result.ok ? result.diagnostics[0]?.message : ""}`,
    ).toBe(true);
  });

  it("places an nmos after a rename alone parts the domains — no delete needed", () => {
    let document = createEmptyDocument("issue-394-rename", "Issue 394 rename");

    // Place M1, then rename its visible designator to "M2". The rename is
    // valid — no other instance shows M2 — but netlist.reference stays "M1",
    // so the allocator's lowest free netlist reference is now "M2": exactly
    // the designator the canvas already shows.
    const m1 = assemblePlacedNmos(document, 100, 100);
    document = transact(document, [{ kind: "add_instance", instance: m1 }]);
    document = transact(document, [
      {
        kind: "set_instance_schematic_reference",
        instanceId: "M1",
        reference: "M2",
      },
    ]);

    const next = assemblePlacedNmos(document, 200, 100);
    const result = executeTransaction(
      document,
      {
        transactionId: "ref-alloc-rename-final",
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "human", id: "test" },
        edits: [{ kind: "add_instance", instance: next }],
      },
      { symbolResolver: resolver },
    );

    expect(
      result.ok,
      `placement was refused: ${!result.ok ? result.diagnostics[0]?.message : ""}`,
    ).toBe(true);
  });

  it("places an nmos after the properties panel renumbers a netlist reference", () => {
    // The GUI's actual domain-splitting entry: the properties panel's
    // Netlist reference field moves only netlist.reference and leaves the
    // visible designator behind. Drive the split through the same producer
    // the panel uses, so this breaks if that producer changes shape.
    let document = createEmptyDocument("issue-394-gui", "Issue 394 GUI");

    const m1 = assemblePlacedNmos(document, 100, 100);
    document = transact(document, [{ kind: "add_instance", instance: m1 }]);

    const commands = createSelectionPropertyCommands({
      project: createEmptyProject("issue-394-gui", "Issue 394 GUI"),
      document,
      resolver,
      selectedInstance: document.instances.find(
        (instance) => instance.id === "M1",
      ),
      selectedInstanceIsMos: true,
      selectedAnnotation: null,
      commitStructure: () => false,
      transact: (edits) => {
        document = transact(document, [...edits]);
        return { ok: true };
      },
      replaceAnnotationSelection: () => {},
      setStatus: () => {},
    });
    expect(commands.updateSelectedReference("M9")).toBe(true);
    // The split state the panel leaves behind: label M1, reference M9.
    const renumbered = document.instances.find(
      (instance) => instance.id === "M1",
    );
    expect(renumbered?.schematicReference).toBe("M1");
    expect(renumbered?.netlist?.reference).toBe("M9");

    const next = assemblePlacedNmos(document, 200, 100);
    const result = executeTransaction(
      document,
      {
        transactionId: "ref-alloc-gui-final",
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "human", id: "test" },
        edits: [{ kind: "add_instance", instance: next }],
      },
      { symbolResolver: resolver },
    );

    expect(
      result.ok,
      `placement was refused: ${!result.ok ? result.diagnostics[0]?.message : ""}`,
    ).toBe(true);
    expect(next.schematicReference).toBe("M2");
  });
});
