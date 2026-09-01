import { createEmptyDocument } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { diagnoseProjectSnapshot } from "./diagnostic.js";
import { evaluateSubmissionGates } from "../submission-gates.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

/** One NMOS on an otherwise blank sheet: nothing wired, nothing powered. */
function sheetWithOneTransistor() {
  const document = createEmptyDocument("document-main", "Main");
  document.instances.push({
    id: "M1",
    symbolId: "nmos",
    reference: "M1",
    placement: { position: { x: 100, y: 100 }, rotation: 0, mirror: "none" },
  });
  return {
    id: "project-erc",
    schemaVersion: 32,
    name: "ERC",
    topDocumentId: "document-main",
    documents: [document],
  } as unknown as Parameters<typeof diagnoseProjectSnapshot>[0];
}

describe("live diagnostics while drawing", () => {
  it("stays quiet about a part that has only just been placed", () => {
    // The complaint this answers: drop one NMOS on a blank canvas and the
    // editor immediately reports four problems — unresolved bulk, a floating
    // gate, two unconnected pins — before the author has had a chance to
    // wire anything. Drawing a twenty-transistor circuit would raise eighty
    // of them, nearly all of which disappear once the wiring is done. When
    // everything warns, nothing warns.
    const snapshot = diagnoseProjectSnapshot(
      sheetWithOneTransistor(),
      resolver,
      undefined,
      { domains: ["visual"] },
    );
    expect(
      snapshot.diagnostics.filter((diagnostic) => diagnostic.domain === "erc"),
    ).toEqual([]);
  });

  it("still reports the electrical rules when asked for them", () => {
    // On demand is not "not at all": the same sheet, asked directly, still
    // says everything it said before.
    const snapshot = diagnoseProjectSnapshot(
      sheetWithOneTransistor(),
      resolver,
    );
    const codes = snapshot.diagnostics
      .filter((diagnostic) => diagnostic.domain === "erc")
      .map((diagnostic) => diagnostic.code);
    expect(codes).toContain("ERC_BULK_UNRESOLVED");
    expect(codes).toContain("ERC_FLOATING_GATE");
  });

  it("keeps the gallery gate refusing exactly what it refused before", () => {
    // The brake. Quieting the editor must not quiet the gate: this one runs
    // its own checks and never reads the editor's live snapshot, and this
    // test exists so that stays true.
    const gates = evaluateSubmissionGates(sheetWithOneTransistor(), resolver);
    const failureCodes = gates.failures.map((failure) => failure.code);
    // The gate speaks in its own vocabulary, and the floating-endpoint
    // refusal is the one this circuit earns.
    expect(failureCodes).toContain("floating-endpoints");
    const floating = gates.failures.find(
      (failure) => failure.code === "floating-endpoints",
    );
    expect(floating?.count).toBeGreaterThan(0);
  });
});
