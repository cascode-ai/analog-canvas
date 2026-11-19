import { describe, expect, it } from "vitest";

import { createEmptyDocument, createEmptyProject } from "@icm/model";

import { levelScope } from "./import-scope.js";
import type { LevelModel, RnlLevelSnapshot } from "./rnl-snapshot.js";

describe("RNL level scope", () => {
  it("finds a card the conversion from Spectre renamed by the name as written", () => {
    // Spectre's M1 calls a subcircuit, so its SPICE form is XM1; the
    // capacitor Cm1 is no M1, though both read m1 after their first letter.
    const project = createEmptyProject("scope", "Scope");
    const document = createEmptyDocument("dut", "dut");
    for (const id of ["XM1", "Cm1", "XM3"])
      document.instances.push({
        id,
        reference: id,
        symbolId: id.startsWith("C") ? "capacitor" : "pmos",
        placement: null,
      });
    const scope = levelScope(
      project,
      document,
      { kind: "subckt", name: "dut" } as RnlLevelSnapshot,
      { objects: [], symbols: [] } as unknown as LevelModel,
      "spectre",
      [],
    );
    const id = (name: string) => scope.instanceOf(name)?.id;
    expect(id("M1")).toBe("XM1");
    expect(id("m1")).toBe("Cm1");
    expect(id("Cm1")).toBe("Cm1");
    // In any case where the name's letters name one card only.
    expect(id("m3")).toBe("XM3");
    expect(id("M2")).toBeUndefined();
  });

  it("does not take a card the file names as it is for a renamed one", () => {
    // CM3 is the capacitor's own name; only XM3 can be Spectre's M3.
    const project = createEmptyProject("scope", "Scope");
    const document = createEmptyDocument("dut", "dut");
    for (const id of ["CM3", "XM3"])
      document.instances.push({
        id,
        reference: id,
        symbolId: id.startsWith("C") ? "capacitor" : "pmos",
        placement: null,
      });
    const level = {
      kind: "subckt",
      name: "dut",
      host: { instances: [{ id: "#CM3" }, { id: "#M3" }] },
    } as unknown as RnlLevelSnapshot;
    const scope = levelScope(
      project,
      document,
      level,
      { objects: [], symbols: [] } as unknown as LevelModel,
      "spectre",
      [],
    );
    expect(scope.instanceOf("M3")?.id).toBe("XM3");
    expect(scope.instanceOf("CM3")?.id).toBe("CM3");
  });
});
