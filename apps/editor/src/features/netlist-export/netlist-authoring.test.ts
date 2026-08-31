import { createEmptyDocument } from "@icm/model";
import { describe, expect, it } from "vitest";

import {
  bindingForEditedModel,
  initialInstanceNetlist,
  instanceIdPrefix,
  nextInstanceId,
  nextInstanceReference,
} from "./netlist-authoring";

describe("netlist authoring", () => {
  it("allocates References only from the case-folded Reference domain", () => {
    const document = createEmptyDocument("main", "Main");
    document.instances.push(
      {
        id: "opaque-a",
        symbolId: "resistor",
        placement: null,
        reference: "R1",
        netlist: { parameters: {} },
      },
      {
        id: "R2",
        symbolId: "resistor",
        placement: null,
        reference: "R3",
        netlist: { parameters: {} },
      },
    );
    expect(nextInstanceReference(document, "resistor")).toBe("R2");
    expect(nextInstanceReference(document, "variable-resistor")).toBe("R2");
    expect(nextInstanceReference(document, "nmos")).toBe("M1");
  });

  it("allocates object IDs without treating Reference as identity", () => {
    const document = createEmptyDocument("main", "Main");
    document.instances.push({
      id: "M1",
      symbolId: "nmos",
      placement: null,
      reference: "M8",
      netlist: { parameters: {} },
    });
    expect(nextInstanceId(document, "nmos")).toBe("M2");
    expect(nextInstanceReference(document, "nmos")).toBe("M1");
    expect(nextInstanceId(document, "ground")).toBe("GND1");
    expect(instanceIdPrefix("inductor")).toBe("L");
  });

  it("creates typed netlist facts without duplicating Reference", () => {
    expect(initialInstanceNetlist("resistor", { value: "10k" })).toEqual({
      binding: { kind: "primitive", deviceClass: "resistor" },
      parameters: { value: "10k" },
    });
    expect(initialInstanceNetlist("nmos", { w: "2u", l: "60n" })).toEqual({
      parameters: { w: "2u", l: "60n" },
    });
    expect(initialInstanceNetlist("ground", {})).toBeUndefined();
  });

  it("creates a model binding only from explicit edited text", () => {
    expect(bindingForEditedModel("nmos", " nch_mac ")).toEqual({
      kind: "model",
      deviceClass: "mos",
      name: "nch_mac",
    });
    expect(bindingForEditedModel("nmos", "")).toBeUndefined();
  });
});
