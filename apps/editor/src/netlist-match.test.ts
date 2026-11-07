import { describe, expect, it } from "vitest";

import { matchDevices, netlistDevices } from "./netlist-match";

const pairsOf = (left: string, right: string) =>
  Object.fromEntries(matchDevices(netlistDevices(left), netlistDevices(right)));

describe("matching two netlists' devices", () => {
  it("pairs a dataset's devices with ours by what they connect to", () => {
    // AnalogGenie's style against ours: other names, other order, other
    // ground, drain and source swapped on one device.
    const dataset = [
      "M2 (VOUT1 VB2 VDD VDD) pmos4",
      "M0 (net18 VIN1 0 0) nmos4",
      "M1 (net18 VB1 VOUT1 0) nmos4",
    ].join("\n");
    const ours = [
      ".subckt dut VDD VSS VB2 VB1 VIN1 VOUT1",
      "XM1 net0 VIN1 VSS VSS sky130_fd_pr__nfet_01v8 l=0.15 w=1",
      "XM2 VOUT1 VB1 net0 VSS sky130_fd_pr__nfet_01v8 l=0.15 w=1",
      "XM3 VOUT1 VB2 VDD VDD sky130_fd_pr__pfet_01v8 l=0.15 w=1",
      ".ends dut",
    ].join("\n");
    expect(pairsOf(dataset, ours)).toEqual({
      M0: "XM1",
      M1: "XM2",
      M2: "XM3",
    });
  });

  it("follows one choice through a symmetric pair", () => {
    // A five-transistor OTA: the input halves tie, but the diode-connected
    // load decides which input device is which.
    const dataset = [
      "MM1 x inp tail 0 nmos",
      "MM2 out inn tail 0 nmos",
      "MM3 x x vdd vdd pmos",
      "MM4 out x vdd vdd pmos",
      "MM5 tail bias 0 0 nmos",
    ].join("\n");
    const ours = [
      ".subckt opamp_core VDD VSS",
      "XU1 a b c VSS sky130_fd_pr__nfet_01v8",
      ".ends opamp_core",
      ".subckt dut VDD VSS VINP VINN VBIAS VOUT",
      "XM5 net1 VBIAS VSS VSS sky130_fd_pr__nfet_01v8 l=0.15 w=1",
      "XM4 VOUT net2 VDD VDD sky130_fd_pr__pfet_01v8 l=0.15 w=1",
      "XM3 net2 net2 VDD VDD sky130_fd_pr__pfet_01v8 l=0.15 w=1",
      "XM2 VOUT VINN net1 VSS sky130_fd_pr__nfet_01v8 l=0.15 w=1",
      "XM1 net2 VINP net1 VSS sky130_fd_pr__nfet_01v8 l=0.15 w=1",
      ".ends dut",
    ].join("\n");
    expect(pairsOf(dataset, ours)).toEqual({
      MM1: "XM1",
      MM2: "XM2",
      MM3: "XM3",
      MM4: "XM4",
      MM5: "XM5",
    });
  });

  it("still pairs what differs, by kind at last", () => {
    expect(
      pairsOf("R1 a b 1k\nC1 b 0 1p", "R7 x y 1k\nC3 y z 1p\nL1 z 0 1n"),
    ).toEqual({ R1: "R7", C1: "C3" });
  });
});
