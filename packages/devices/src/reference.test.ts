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

  it("uses the ngspice X sequence for every external-subcircuit call", () => {
    const document = createEmptyDocument("main", "Main");
    document.instances.push({
      id: "reviewed-mos",
      symbolId: "nmos",
      placement: null,
      reference: "XM1",
      netlist: {
        binding: {
          kind: "external-subcircuit",
          definitionId: "sky-nfet",
        },
        parameters: {},
      },
    });
    const policy = referencePolicyForInstance(document.instances[0]!);
    expect(policy).toEqual({ kind: "required", prefix: "X" });
    expect(nextReference(createReferenceIndex(document), policy)).toBe("X1");
    expect(createReferenceIndex(document).issues).toEqual([]);
  });

  // All three switches designate `S`, so they draw from one sequence: the
  // index is keyed by prefix, not by device, and the next free suffix skips
  // whatever the other two already occupy. A sheet numbers its switches S1,
  // S2, S3 in placement order regardless of which kind each one is.
  it("shares one sequence across every device that designates S", () => {
    const document = createEmptyDocument("main", "Main");
    document.instances.push(
      {
        id: "a",
        symbolId: "ideal-switch",
        placement: null,
        reference: "S1",
      },
      {
        id: "b",
        symbolId: "voltage-controlled-switch",
        placement: null,
        reference: "S2",
        netlist: {
          binding: { kind: "model", deviceClass: "switch", name: "SW" },
          parameters: {},
        },
      },
      { id: "c", symbolId: "closed-switch", placement: null },
    );
    const index = createReferenceIndex(document);
    for (const instance of document.instances) {
      expect(referencePolicyForInstance(instance)).toEqual({
        kind: "required",
        prefix: "S",
      });
      expect(nextReference(index, referencePolicyForInstance(instance))).toBe(
        "S3",
      );
    }
    // Only the undesignated one is short a reference; the shared prefix does
    // not make the other two look duplicated.
    expect(index.issues).toEqual([
      { code: "MISSING_REFERENCE", instanceId: "c" },
    ]);
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
