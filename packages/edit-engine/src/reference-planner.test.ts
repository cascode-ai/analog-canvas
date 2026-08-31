import { createEmptyDocument } from "@icm/model";
import { describe, expect, it } from "vitest";

import { planSetInstanceReference } from "./reference-planner.js";

describe("planSetInstanceReference", () => {
  it("plans a prefix-valid, case-fold unique rename", () => {
    const document = createEmptyDocument("main", "Main");
    document.instances.push({
      id: "R1",
      symbolId: "resistor",
      placement: null,
      reference: "R1",
      netlist: { parameters: {} },
    });

    expect(
      planSetInstanceReference(document, {
        instanceId: "R1",
        reference: " R2 ",
      }),
    ).toEqual({
      ok: true,
      reference: "R2",
      edits: [
        { kind: "set_instance_reference", instanceId: "R1", reference: "R2" },
      ],
    });
  });

  it("rejects a wrong prefix and a case-folded duplicate before transaction", () => {
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
        id: "R2",
        symbolId: "resistor",
        placement: null,
        reference: "R2",
        netlist: { parameters: {} },
      },
    );

    const wrongPrefix = planSetInstanceReference(document, {
      instanceId: "R1",
      reference: "C1",
    });
    expect(wrongPrefix).toMatchObject({ ok: false });
    if (wrongPrefix.ok) throw new Error("expected rejected plan");
    expect(wrongPrefix.message).toContain("Reference C1 does not match");

    const duplicate = planSetInstanceReference(document, {
      instanceId: "R1",
      reference: "r2",
    });
    expect(duplicate).toMatchObject({ ok: false });
    if (duplicate.ok) throw new Error("expected rejected plan");
    expect(duplicate.message).toContain("Reference r2 is already used");
  });
});
