import { createEmptyProject } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as visual from "../visual.js";
import * as electrical from "./erc.js";

import { diagnoseProjectSnapshot } from "./diagnostic.js";
import { evaluateSubmissionGates } from "../submission-gates.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
afterEach(() => vi.restoreAllMocks());

/** One NMOS on an otherwise blank sheet: nothing wired, nothing powered. */
function sheetWithOneTransistor() {
  const project = createEmptyProject("project-erc", "ERC");
  const document = project.documents[0]!;
  document.instances.push({
    id: "M1",
    symbolId: "nmos",
    reference: "M1",
    placement: { position: { x: 100, y: 100 }, rotation: 0, mirror: "none" },
  });
  return project;
}

describe("explicit diagnostic producer selection", () => {
  it("does not execute an unrequested producer", () => {
    const erc = vi.spyOn(electrical, "runErcChecks");
    const geometry = vi.spyOn(visual, "diagnoseVisualQuality");
    diagnoseProjectSnapshot(sheetWithOneTransistor(), resolver, undefined, {
      domains: ["erc"],
    });
    expect(erc).toHaveBeenCalledTimes(1);
    expect(geometry).not.toHaveBeenCalled();
    erc.mockClear();
    diagnoseProjectSnapshot(sheetWithOneTransistor(), resolver, undefined, {
      domains: ["visual"],
    });
    expect(erc).not.toHaveBeenCalled();
    expect(geometry).toHaveBeenCalledTimes(1);
  });
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

  it("keeps Gallery quality advice independent of editor results", () => {
    // This evaluator supplies advice, not a server-side publication veto.
    const gates = evaluateSubmissionGates(sheetWithOneTransistor(), resolver);
    const failureCodes = gates.failures.map((failure) => failure.code);
    expect(failureCodes).toContain("floating-endpoints");
    const floating = gates.failures.find(
      (failure) => failure.code === "floating-endpoints",
    );
    expect(floating?.count).toBeGreaterThan(0);
  });
});
