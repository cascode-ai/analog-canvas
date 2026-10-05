import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { builtInSubcircuitDescriptors } from "@icm/devices";

import {
  IDEAL_LOGIC_TARGETS,
  idealLogicModel,
  spiceIdealLogicSubcircuit,
} from "./ideal-logic-gate-models.js";

describe("ideal logic bodies", () => {
  it("cover every logic gate and flip-flop in the Library", () => {
    // A new gate added to the Library without a body fails here.
    const logic = builtInSubcircuitDescriptors
      .map((descriptor) => descriptor.target)
      .filter((target) =>
        /^(inverter|buffer|[a-z]+_gate(_\d)?|d_flip_flop(_\w+)?)$/u.test(
          target,
        ),
      );
    expect([...new Set(logic)].sort()).toEqual([...IDEAL_LOGIC_TARGETS].sort());
    // Each body's ports are its symbol's, in the symbol's order.
    for (const descriptor of builtInSubcircuitDescriptors.filter((descriptor) =>
      IDEAL_LOGIC_TARGETS.includes(descriptor.target),
    ))
      expect(idealLogicModel(descriptor.target).ports).toEqual(
        descriptor.ports.map((port) => port.name),
      );
  });

  it("writes an inverter as one level, one function and a delayed output", () => {
    expect(spiceIdealLogicSubcircuit("inverter")).toEqual([
      "* Ideal inverter: switches at V(VDD,VSS)/2; vt sets the step width, td the delay",
      ".subckt inverter VDD VSS A Y params: vt=10m td=10p",
      "BhA hA 0 V={0.5*(1+tanh((V(A,VSS)-0.5*V(VDD,VSS))/vt))}",
      "Bf nfn VSS V={V(VDD,VSS)*(1-V(hA))}",
      "Rd nfn ndl 1k",
      "Cd ndl VSS {td/1000}",
      "BY Y VSS V={V(ndl,VSS)}",
      ".ends inverter",
    ]);
  });

  it("chains parity through internal nodes and clears a flip-flop on RST", () => {
    const xor = spiceIdealLogicSubcircuit("xor_gate_4").join("\n");
    expect(xor).toContain("Bp1 np1 0 V={V(hA)+V(hB)-2*V(hA)*V(hB)}");
    expect(xor).toContain("Bp2 np2 0 V={V(np1)+V(hC)-2*V(np1)*V(hC)}");
    expect(xor).toContain(
      "Bf nfn VSS V={V(VDD,VSS)*(V(np2)+V(hD)-2*V(np2)*V(hD))}",
    );
    const flop = spiceIdealLogicSubcircuit("d_flip_flop_reset").join("\n");
    expect(flop).toContain(
      ".subckt d_flip_flop_reset VDD VSS D CK RST Q QBAR params: vt=10m td=10p",
    );
    expect(flop).toContain("-V(nm)*V(hRST)");
    expect(flop).toContain("BQBAR QBAR VSS V={V(VDD,VSS)-V(ndl,VSS)}");
    // No internal node may share a pin's name: SPICE names ignore case,
    // and a node called d would short the D input.
    for (const target of IDEAL_LOGIC_TARGETS) {
      const lines = spiceIdealLogicSubcircuit(target);
      const pins = lines[1]!.split(" ").slice(2, -3);
      const folded = new Set(pins.map((pin) => pin.toLowerCase()));
      for (const node of lines
        .slice(2, -1)
        .flatMap((line) => line.split(" ").slice(1, 3))) {
        if (node === "0" || pins.includes(node)) continue;
        expect(node).toMatch(/^[hn]/u);
        expect(folded.has(node.toLowerCase())).toBe(false);
      }
    }
  });
});

function ngspiceOnPath(): boolean {
  return spawnSync("ngspice", ["--version"], { encoding: "utf8" }).status === 0;
}

/** Skips cleanly where ngspice is absent; the hosted gate never skips. */
describe.skipIf(!ngspiceOnPath())("ideal logic bodies under ngspice", () => {
  it("switch, latch and divide as the gates they draw", () => {
    const deck = [
      "* ideal logic bodies",
      ...[
        "inverter",
        "nand_gate",
        "nor_gate_3",
        "xor_gate_3",
        "d_flip_flop",
        "d_flip_flop_reset",
      ].flatMap(spiceIdealLogicSubcircuit),
      "VDD vdd 0 1.8",
      "VA a 0 PULSE(0 1.8 1n 50p 50p 4n 10n)",
      "VB b 0 PULSE(0 1.8 3n 50p 50p 4n 10n)",
      "VC c 0 PULSE(0 1.8 6n 50p 50p 4n 10n)",
      "VCK ck 0 PULSE(0 1.8 2n 50p 50p 2n 4n)",
      "VRST rst 0 PWL(0 1.8 5n 1.8 5.05n 0)",
      "VS sbar 0 PULSE(1.8 0 4n 50p 50p 1n 100n)",
      "VR rbar 0 PULSE(1.8 0 12n 50p 50p 1n 100n)",
      "XI vdd 0 a yinv inverter",
      "XN vdd 0 a b ynand nand_gate",
      "XO vdd 0 a b c ynor nor_gate_3",
      "XX vdd 0 a b c yxor xor_gate_3",
      // Divide by two: QBAR back to D.
      "XF vdd 0 qb ck q qb d_flip_flop",
      "XR vdd 0 vdd ck rst qr qrb d_flip_flop_reset",
      // An SR latch of two NANDs, set and then reset by short low pulses.
      "XL1 vdd 0 sbar lqb lq nand_gate",
      "XL2 vdd 0 rbar lq lqb nand_gate",
      ".tran 10p 16n",
      ".control",
      "run",
      ...[
        ["inv_a_high", "yinv", "2n"],
        ["inv_a_low", "yinv", "6n"],
        ["nand_both", "ynand", "4n"],
        ["nand_one", "ynand", "2n"],
        ["nor_one", "ynor", "2n"],
        ["nor_none", "ynor", "10.5n"],
        ["xor_two", "yxor", "6.5n"],
        ["xor_one", "yxor", "7.5n"],
        ["q_edge1", "q", "2.5n"],
        ["q_edge2", "q", "6.5n"],
        ["q_edge3", "q", "10.5n"],
        ["q_edge4", "q", "14.5n"],
        ["qr_reset", "qr", "4.5n"],
        ["qr_after", "qr", "6.5n"],
        ["latch_set", "lq", "8n"],
        ["latch_reset", "lq", "15n"],
      ].map(([name, node, at]) => `meas tran ${name} FIND v(${node}) AT=${at}`),
      ".endc",
      ".end",
    ].join("\n");
    const directory = mkdtempSync(join(tmpdir(), "icm-logic-"));
    try {
      writeFileSync(join(directory, "deck.cir"), deck, "utf8");
      const output = execFileSync("ngspice", ["-b", "deck.cir"], {
        cwd: directory,
        encoding: "utf8",
      });
      const measured = Object.fromEntries(
        [...output.matchAll(/^(\w+)\s+=\s+(\S+)/gmu)].map((match) => [
          match[1],
          Number(match[2]),
        ]),
      );
      const high = (name: string) => expect(measured[name]).toBeCloseTo(1.8, 2);
      const low = (name: string) => expect(measured[name]).toBeCloseTo(0, 2);
      low("inv_a_high");
      high("inv_a_low");
      low("nand_both");
      high("nand_one");
      low("nor_one");
      high("nor_none");
      low("xor_two");
      high("xor_one");
      // Q takes QBAR on each rising edge: 2, 6, 10, 14 ns.
      high("q_edge1");
      low("q_edge2");
      high("q_edge3");
      low("q_edge4");
      low("qr_reset");
      high("qr_after");
      high("latch_set");
      low("latch_reset");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
