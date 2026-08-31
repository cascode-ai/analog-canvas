/**
 * Issue #394: "Transaction result failed Document validation" while placing
 * an nmos.
 *
 * Placement assembles a new Instance with
 * `schematicReference: netlist?.reference ?? id`, where `netlist.reference`
 * comes from nextReference() — an allocator that only avoids the
 * netlist.reference domain. The document-level schema additionally requires
 * schematicReference to be unique across instances (case-insensitively).
 * Ordinary edits can part the two domains: `set_instance_schematic_reference`
 * renames only the visible designator, leaving netlist.reference behind.
 * After that, the lowest free netlist reference can equal an occupied
 * schematicReference, and every subsequent placement of that prefix assembles
 * a duplicate — rejected at commit as INVALID_RESULT with
 * "Duplicate schematic instance reference: <ref>". The user-visible headline
 * is exactly the screenshot in #394, and it recurs on every retry.
 *
 * RED until placement allocation respects both reference domains.
 */
import { executeTransaction } from "@icm/edit-engine";
import type { SchematicEdit } from "@icm/edit-engine";
import { createEmptyDocument } from "@icm/model";
import type { Instance, SchematicDocument } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import {
  initialInstanceNetlist,
  nextInstanceDesignator,
} from "../netlist-export/netlist-authoring";
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
});
