import { describe, expect, it } from "vitest";
import { netlistRunWarnings } from "./netlist-warnings.js";

describe("the netlist findings a run shows", () => {
  it("leaves generated names and conventional body supplies to the netlist review", () => {
    expect(
      netlistRunWarnings([
        {
          code: "GENERATED_NET_NAME",
          message: "Unnamed logical Net exports as net0",
        },
        {
          code: "MOS_BODY_DEFAULT_SUPPLY",
          message: "MP's body has no Net and takes the conventional VDD",
        },
        {
          code: "MOS_BODY_OTHER_SUPPLY",
          message: "M1's body follows the Cell's PMOS default VDDL",
        },
        {
          code: "SIMULATION_NATIVE_SOURCE_DC_MODE",
          message: 'V1: dc is used only with type="dc"',
        },
      ]),
    ).toEqual([
      "M1's body follows the Cell's PMOS default VDDL",
      'V1: dc is used only with type="dc"',
    ]);
  });
});
