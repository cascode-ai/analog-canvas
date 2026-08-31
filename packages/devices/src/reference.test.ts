import { describe, expect, it } from "vitest";

import { createEmptyDocument } from "@icm/model";

import {
  createReferenceIndex,
  nextReference,
  referencePolicyForInstance,
} from "./reference.js";

describe("ReferencePolicy and ReferenceIndex", () => {
  it("allocates the lowest free reviewed prefix suffix per Cell", () => {
    const document = createEmptyDocument("main", "Main");
    document.instances.push(
      {
        id: "R1",
        symbolId: "resistor",
        placement: null,
        reference: "R1",
        netlist: { parameters: {} },
      },
      {
        id: "R3",
        symbolId: "resistor",
        placement: null,
        reference: "R3",
        netlist: { parameters: {} },
      },
      {
        id: "M1",
        symbolId: "nmos",
        placement: null,
        reference: "M1",
        netlist: { parameters: {} },
      },
    );
    const index = createReferenceIndex(document);
    expect(
      nextReference(index, referencePolicyForInstance(document.instances[0]!)),
    ).toBe("R2");
    expect(
      nextReference(index, referencePolicyForInstance(document.instances[2]!)),
    ).toBe("M2");
  });

  it("reports missing, unexpected, prefix, and case-folded duplicate evidence", () => {
    const document = createEmptyDocument("main", "Main");
    document.instances.push(
      { id: "R1", symbolId: "resistor", placement: null },
      {
        id: "R2",
        symbolId: "resistor",
        placement: null,
        reference: "C1",
        netlist: { parameters: {} },
      },
      {
        id: "R3",
        symbolId: "resistor",
        placement: null,
        reference: "c1",
        netlist: { parameters: {} },
      },
      {
        id: "G1",
        symbolId: "ground",
        placement: null,
        reference: "G1",
        netlist: { parameters: {} },
      },
    );
    expect(
      createReferenceIndex(document).issues.map((issue) => issue.code),
    ).toEqual([
      "MISSING_REFERENCE",
      "WRONG_REFERENCE_PREFIX",
      "WRONG_REFERENCE_PREFIX",
      "DUPLICATE_REFERENCE",
      "DUPLICATE_REFERENCE",
    ]);
  });

  it("does not allocate a reference already claimed by an invalid prefix", () => {
    const document = createEmptyDocument("main", "Main");
    document.instances.push({
      id: "R1",
      symbolId: "resistor",
      placement: null,
      reference: "X1",
      netlist: { parameters: {} },
    });

    expect(
      nextReference(createReferenceIndex(document), {
        kind: "required",
        prefix: "X",
      }),
    ).toBe("X2");
  });
});
