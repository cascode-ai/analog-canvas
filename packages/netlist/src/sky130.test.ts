import { describe, expect, it } from "vitest";

import { bindSky130Netlist, sky130Micrometres } from "./sky130";
import { printSpiceNetlist } from "./printers";
import type { DesignNetlistIR } from "./ir";

function mosIr(parameters: Record<string, string>): DesignNetlistIR {
  return {
    topCellName: "amp",
    globals: [],
    cells: [
      {
        name: "amp",
        ports: [
          { name: "d", direction: "inout" },
          { name: "g", direction: "inout" },
        ],
        instances: [
          {
            reference: "M1",
            deviceClass: "mos",
            target: "nch",
            nodes: [
              { pinName: "D", netName: "d" },
              { pinName: "G", netName: "g" },
              { pinName: "S", netName: "0" },
              { pinName: "B", netName: "0" },
            ],
            parameters: Object.entries(parameters).map(([name, value]) => ({
              name,
              rawValue: value,
            })),
          },
        ],
      },
    ],
  } as unknown as DesignNetlistIR;
}

describe("sky130 geometry units", () => {
  /**
   * The model libraries set `scale=1u`, so l and w are plain micrometre
   * numbers. Getting this wrong does not fail — it simulates a device a
   * million times the intended size — so every suffix is pinned here.
   */
  it("converts SPICE-suffixed lengths to plain micrometres", () => {
    expect(sky130Micrometres("60n")).toBe("0.06");
    expect(sky130Micrometres("2u")).toBe("2");
    expect(sky130Micrometres("1.5u")).toBe("1.5");
    expect(sky130Micrometres("0.15u")).toBe("0.15");
    expect(sky130Micrometres("96u")).toBe("96");
    expect(sky130Micrometres("1e-6")).toBe("1");
    expect(sky130Micrometres("150n")).toBe("0.15");
    // A bare number is metres, the SPICE convention our own netlist uses.
    expect(sky130Micrometres("3e-6")).toBe("3");
  });

  it("refuses a value it cannot read rather than guessing", () => {
    expect(() => sky130Micrometres("wide")).toThrow(/wide/);
    expect(() => sky130Micrometres("")).toThrow();
  });
});

describe("sky130 device binding", () => {
  it("calls the PDK wrapper as a subcircuit, in d g s b order", () => {
    const bound = bindSky130Netlist(mosIr({ w: "2u", l: "150n", nf: "2" }), {
      modelByTarget: { nch: "sky130_fd_pr__nfet_01v8" },
    });
    const line = printSpiceNetlist(bound)
      .split("\n")
      .find((candidate) => candidate.startsWith("XM1"));
    // X prefix: a sky130 device is a subcircuit, not a SPICE primitive.
    // Parameter order follows the design's own, which SPICE reads by name.
    expect(line).toBe("XM1 d g 0 0 sky130_fd_pr__nfet_01v8 w=2 l=0.15 nf=2");
  });

  it("leaves every other device class untouched", () => {
    const ir = mosIr({ w: "2u", l: "150n" });
    ir.cells[0]!.instances.push({
      reference: "R1",
      deviceClass: "resistor",
      target: null,
      nodes: [
        { pinName: "1", netName: "d" },
        { pinName: "2", netName: "0" },
      ],
      parameters: [{ name: "value", rawValue: "10k" }],
    } as (typeof ir.cells)[number]["instances"][number]);
    const bound = bindSky130Netlist(ir, {
      modelByTarget: { nch: "sky130_fd_pr__nfet_01v8" },
    });
    const printed = printSpiceNetlist(bound);
    expect(printed).toContain("R1 d 0 10k");
    expect(printed).not.toContain("XR1");
  });

  it("names the instance whose model has no sky130 binding", () => {
    // Silence here would produce a netlist that simulates the wrong circuit.
    expect(() =>
      bindSky130Netlist(mosIr({ w: "2u", l: "150n" }), {
        modelByTarget: { pch: "sky130_fd_pr__pfet_01v8" },
      }),
    ).toThrow(/M1.*nch/);
  });
});

describe("the five-transistor OTA, bound end to end", () => {
  /**
   * The acceptance case from the simulation ADR. This netlist was run through
   * ngspice 46 against the Sky130 `tt` models beside the published reference
   * for the same circuit: both produce the same DC operating point to every
   * printed digit (v(vout) 0.897856700, v(tail) 0.212126300, v(nleft)
   * 0.613375000, v(ibias) 0.742923000; worst node difference 0.0 V).
   *
   * Pinning the text here keeps the three silent conventions honest in CI,
   * where no PDK is installed: the X prefix, the d/g/s/b node order, and the
   * micrometre geometry.
   */
  const mos = (
    reference: string,
    target: string,
    nodes: readonly [string, string, string, string],
    w: string,
    l: string,
    nf: string,
  ) => ({
    id: reference,
    reference,
    deviceClass: "mos" as const,
    target,
    nodes: (["D", "G", "S", "B"] as const).map((pinName, index) => ({
      pinName,
      netName: nodes[index]!,
    })),
    parameters: [
      { name: "w", rawValue: w },
      { name: "l", rawValue: l },
      { name: "nf", rawValue: nf },
    ],
  });

  it("prints the wrappers, order, and micrometres the PDK reads", () => {
    const ir = {
      topCellName: "ota_5t",
      globals: [],
      cells: [
        {
          id: "ota_5t",
          name: "ota_5t",
          ports: ["vss", "ibias", "vdd", "vinn", "vinp", "vout"].map(
            (name) => ({ id: name, name, netName: name }),
          ),
          nets: [],
          instances: [
            mos(
              "M1",
              "nch",
              ["nleft", "vinp", "tail", "vss"],
              "96u",
              "1u",
              "12",
            ),
            mos(
              "M2",
              "nch",
              ["vout", "vinn", "tail", "vss"],
              "96u",
              "1u",
              "12",
            ),
            mos(
              "M3",
              "pch",
              ["nleft", "nleft", "vdd", "vdd"],
              "64u",
              "1u",
              "8",
            ),
            mos("M4", "pch", ["vout", "nleft", "vdd", "vdd"], "64u", "1u", "8"),
            mos(
              "M5",
              "nch",
              ["tail", "ibias", "vss", "vss"],
              "100u",
              "3u",
              "20",
            ),
            mos(
              "M6",
              "nch",
              ["ibias", "ibias", "vss", "vss"],
              "30u",
              "3u",
              "6",
            ),
          ],
        },
      ],
    } as unknown as DesignNetlistIR;

    const printed = printSpiceNetlist(
      bindSky130Netlist(ir, {
        modelByTarget: {
          nch: "sky130_fd_pr__nfet_01v8",
          pch: "sky130_fd_pr__pfet_01v8",
        },
      }),
    );

    expect(printed).toContain(".subckt ota_5t vss ibias vdd vinn vinp vout");
    expect(printed).toContain(
      "XM1 nleft vinp tail vss sky130_fd_pr__nfet_01v8 w=96 l=1 nf=12",
    );
    expect(printed).toContain(
      "XM3 nleft nleft vdd vdd sky130_fd_pr__pfet_01v8 w=64 l=1 nf=8",
    );
    expect(printed).toContain(
      "XM5 tail ibias vss vss sky130_fd_pr__nfet_01v8 w=100 l=3 nf=20",
    );
    // No device may reach the deck as a bare SPICE primitive.
    expect(printed).not.toMatch(/^M\d/mu);
  });
});
