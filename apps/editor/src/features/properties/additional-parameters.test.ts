import { describe, expect, it } from "vitest";

import {
  additionalParameterDrafts,
  planAdditionalParameterPatch,
} from "./additional-parameters";

const instance = (parameters: Record<string, string>) =>
  ({
    id: "instance-r1",
    symbolId: "resistor",
    placement: null,
    reference: "R1",
    netlist: {
      binding: { kind: "primitive" as const, deviceClass: "resistor" as const },
      parameters,
    },
  }) as const;

describe("Additional Parameters", () => {
  it("excludes descriptor-defined fields from the editable additional table", () => {
    expect(
      additionalParameterDrafts(instance({ value: "10k", tc: "0.1" })),
    ).toEqual([
      {
        id: "instance-r1:additional:0",
        originalName: "tc",
        name: "tc",
        value: "0.1",
      },
    ]);
  });

  it("plans rename, update, add, and delete as one parameter patch", () => {
    const result = planAdditionalParameterPatch(
      instance({ value: "10k", tc: "0.1", temp: "25" }),
      [
        { id: "a", originalName: "tc", name: "TC", value: "0.2" },
        { id: "b", originalName: "temp", name: "temp", value: "" },
        { id: "c", originalName: null, name: "mismatch", value: "yes" },
      ],
    );
    expect(result).toEqual({
      kind: "edit",
      edit: {
        kind: "patch_instance_netlist_parameters",
        instanceId: "instance-r1",
        set: { TC: "0.2", mismatch: "yes" },
        unset: ["tc", "temp"],
      },
    });
  });

  it("rejects known or duplicate names before making an edit", () => {
    expect(
      planAdditionalParameterPatch(instance({ value: "10k" }), [
        { id: "a", originalName: null, name: "VALUE", value: "12k" },
      ]),
    ).toMatchObject({ kind: "invalid" });
    expect(
      planAdditionalParameterPatch(instance({ value: "10k" }), [
        { id: "a", originalName: null, name: "tc", value: "0.1" },
        { id: "b", originalName: null, name: "TC", value: "0.2" },
      ]),
    ).toMatchObject({ kind: "invalid" });
  });
});
