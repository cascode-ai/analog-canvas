import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { IDEAL_COMPARATOR_TARGET, subcircuitDescriptor } from "@icm/devices";
import {
  createEmptyDocument,
  createEmptyProject,
  type CircuitProject,
} from "@icm/model";

import { createDesignNetlistExport } from "./export.js";

/**
 * One Cell holding one block with no supply drawn: each signal pin is a Cell
 * port named after the block's port, and VDD/VSS meet nothing.
 */
function unpoweredBlock(symbolId: string): CircuitProject {
  const project = createEmptyProject(`unpowered-${symbolId}`, symbolId, "dut");
  const document = project.documents[0]!;
  document.netlist!.name = "dut";
  const descriptor = subcircuitDescriptor(symbolId)!;
  document.instances.push({
    id: "block",
    symbolId,
    reference: "X1",
    placement: null,
    netlist: {
      binding: { kind: "unresolved-subcircuit", name: descriptor.target },
      parameters: {},
    },
  });
  for (const port of descriptor.ports.filter((item) => !item.supply)) {
    const id = `port-${port.name}`;
    document.instances.push({ id, symbolId: "port", placement: null });
    document.nets.push({
      id: port.name,
      terminals: [
        { instanceId: id, pinName: "P" },
        { instanceId: "block", pinName: port.pinName ?? port.name },
      ],
    });
    document.netlist!.terminals.push({
      id: `terminal-${port.name}`,
      name: port.name,
      netId: port.name,
      direction: "inout",
      interfaceInstanceIds: [id],
    });
  }
  return project;
}

describe("blocks whose body never reads its supplies", () => {
  it.each([
    ["opamp", "X1 0 0 VIP VIN VOUT opamp", "X1 (0 0 VIP VIN VOUT) opamp"],
    [
      "opamp-differential",
      "X1 0 0 VIP VIN VOP VON opamp_differential",
      "X1 (0 0 VIP VIN VOP VON) opamp_differential",
    ],
    ["adder", "X1 0 0 A B Y adder", "X1 (0 0 A B Y) adder"],
  ] as const)(
    "export a %s with no supply drawn, its unused supplies on ground",
    (symbolId, spiceCard, spectreCard) => {
      // A textbook switched-capacitor integrator draws an op-amp and no
      // supply, and its ideal body never reads one (#1253).
      for (const [format, card] of [
        ["spice", spiceCard],
        ["spectre", spectreCard],
      ] as const) {
        const result = createDesignNetlistExport(unpoweredBlock(symbolId), {
          format,
        });
        expect(result.status, format).toBe("ready");
        if (result.status !== "ready") continue;
        expect(result.file.text).toContain(card);
        expect(result.file.text).not.toMatch(/\.global|^global/mu);
        expect(
          result.diagnostics.filter(
            (item) => item.code === "MISSING_BLOCK_SUPPLY",
          ),
        ).toEqual([]);
      }
    },
  );

  it("export a multiplier unpowered in SPICE, where its body is built in", () => {
    const spice = createDesignNetlistExport(unpoweredBlock("multiplier"));
    expect(spice.status).toBe("ready");
    if (spice.status === "ready")
      expect(spice.file.text).toContain("X1 0 0 A B Y multiplier");
    // In Spectre the reader's own multiplier is called, which may use its
    // supplies, so it gets the Cell's default ones, as a MOS body does.
    const spectre = createDesignNetlistExport(unpoweredBlock("multiplier"), {
      format: "spectre",
    });
    expect(spectre.status).toBe("ready");
    if (spectre.status === "ready") {
      expect(spectre.file.text).toContain("subckt dut (VDD VSS A B Y)");
      expect(spectre.file.text).toContain("X1 (VDD VSS A B Y) multiplier");
    }
  });

  it("power a Project's own op-amp from the Cell's default supplies", () => {
    // A transistor-level `opamp` Cell or external model may use VDD/VSS.
    const project = unpoweredBlock("opamp");
    project.externalSubcircuitDefinitions = [
      {
        id: "own-opamp",
        name: "opamp",
        terminals: ["VDD", "VSS", "VIP", "VIN", "VOUT"].map((name) => ({
          id: `own-${name}`,
          name,
          direction: "inout" as const,
        })),
        formalParameters: [],
        source: { kind: "declaration-only" },
      },
    ] as unknown as CircuitProject["externalSubcircuitDefinitions"];
    const result = createDesignNetlistExport(project);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.file.text).toContain(".subckt dut VDD VSS VIP VIN VOUT");
    expect(result.file.text).toContain("X1 VDD VSS VIP VIN VOUT opamp");
  });

  it("export an ideal comparator with a numeric high level and no VDD pin", () => {
    // A flash ADC drawn with ground and no VDD gained a VDD Cell Pin that
    // nothing inside used: the numeric comparator's call has no supply
    // nodes. Every comparator placed before VDD was the default stores 1,
    // and exports byte for byte as it did.
    const project = unpoweredBlock("comparator");
    project.documents[0]!.instances[0]!.netlist = {
      binding: { kind: "unresolved-subcircuit", name: IDEAL_COMPARATOR_TARGET },
      parameters: { vhigh: "1", vlow: "0", vtransition: "1m" },
    };
    const result = createDesignNetlistExport(project);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.file.text).toBe(
      [
        "",
        ".subckt icm_ideal_comparator VIP VIN VOUT params: vhigh=1 vlow=0 vtransition=1m",
        "Bcmp VOUT 0 V={vlow+(vhigh-vlow)*0.5*(1+tanh((V(VIP)-V(VIN))/vtransition))}",
        ".ends icm_ideal_comparator",
        "",
        ".subckt dut VIP VIN VOUT",
        "X1 VIP VIN VOUT icm_ideal_comparator vhigh=1 vlow=0 vtransition=1m",
        ".ends dut",
        "",
      ].join("\n"),
    );
  });

  it("give a comparator whose high level is VDD the default VDD alone", () => {
    // Its body reads VDD, not VSS: no ground pin either.
    const project = unpoweredBlock("comparator");
    project.documents[0]!.instances[0]!.netlist = {
      binding: { kind: "unresolved-subcircuit", name: IDEAL_COMPARATOR_TARGET },
      parameters: { vhigh: "VDD" },
    };
    for (const [format, header, card] of [
      [
        "spice",
        ".subckt dut VDD VIP VIN VOUT",
        "X1 VDD VIP VIN VOUT icm_ideal_comparator_vdd",
      ],
      [
        "spectre",
        "subckt dut (VDD VIP VIN VOUT)",
        "X1 (VDD VIP VIN VOUT) icm_ideal_comparator_vdd",
      ],
    ] as const) {
      const result = createDesignNetlistExport(project, { format });
      expect(result.status, format).toBe("ready");
      if (result.status !== "ready") continue;
      expect(result.file.text.split("\n")).toEqual(
        expect.arrayContaining([header, card]),
      );
      expect(result.file.text).not.toMatch(/VSS|global/u);
    }
    // A Cell that calls it, drawing no supply either, passes that VDD on
    // and gains no ground pin that nothing would use.
    const parent = createEmptyDocument("top", "top");
    parent.netlist!.name = "top";
    parent.instances.push({
      id: "XD",
      symbolId: "dut-symbol",
      reference: "XD",
      placement: null,
      netlist: {
        binding: { kind: "subcircuit", childDocumentId: "dut" },
        parameters: {},
      },
    });
    for (const name of ["VIP", "VIN", "VOUT"]) {
      parent.nets.push({
        id: `top-${name}`,
        terminals: [{ instanceId: "XD", pinName: name }],
      });
      parent.connectivityEvidence.push({
        id: `top-${name}-name`,
        kind: "net-name-hint",
        netId: `top-${name}`,
        sourceName: name.toLowerCase(),
        origin: "spice-import",
      });
    }
    project.documents.push(parent);
    project.topDocumentId = parent.id;
    const called = createDesignNetlistExport(project);
    expect(called.status).toBe("ready");
    if (called.status !== "ready") return;
    expect(called.file.text.split("\n")).toEqual(
      expect.arrayContaining([".subckt top VDD", "XD VDD vip vin vout dut"]),
    );
    expect(called.file.text).not.toMatch(/VSS|global/u);
  });

  it("resolve that comparator's VDD as a logic block's: chosen between two supplies", () => {
    const project = unpoweredBlock("comparator");
    const document = project.documents[0]!;
    document.instances[0]!.netlist = {
      binding: { kind: "unresolved-subcircuit", name: IDEAL_COMPARATOR_TARGET },
      parameters: { vhigh: "VDD" },
    };
    for (const name of ["VDDA", "VDDB"]) {
      document.instances.push({
        id: name,
        symbolId: "vdd-port",
        placement: null,
      });
      document.nets.push({
        id: `net-${name}`,
        terminals: [{ instanceId: name, pinName: "P" }],
      });
      document.connectivityEvidence.push({
        id: `${name}-claim`,
        kind: "name-claim",
        netId: `net-${name}`,
        name,
        scope: "global",
        powerDomain: "vdd",
        owner: { kind: "power-marker", objectId: name },
      });
    }
    const ambiguous = createDesignNetlistExport(project);
    expect(ambiguous.status).toBe("blocked");
    expect(
      ambiguous.diagnostics.filter(
        (item) => item.code === "MISSING_BLOCK_SUPPLY",
      ),
    ).toHaveLength(1);
    // The Net chosen in Properties, as set-block-supply binds it.
    document.nets
      .find((net) => net.id === "net-VDDB")!
      .terminals.push({ instanceId: "block", pinName: "VDD" });
    const chosen = createDesignNetlistExport(project);
    expect(chosen.status).toBe("ready");
    if (chosen.status !== "ready") return;
    expect(chosen.file.text).toMatch(
      /^X1 VDDB VIP VIN VOUT icm_ideal_comparator_vdd$/mu,
    );
  });

  it("give a block whose body uses its supplies the Cell's default ones", () => {
    // As an unconnected MOS body does: a new VDD pin and ground, no global.
    for (const [symbolId, card] of [
      ["inverter", "X1 VDD VSS A Y inverter"],
      ["adc", "X1 VDD VSS VIN VOUT adc"],
    ] as const) {
      const result = createDesignNetlistExport(unpoweredBlock(symbolId));
      expect(result.status, symbolId).toBe("ready");
      if (result.status !== "ready") continue;
      expect(result.file.text).toContain(card);
      expect(result.file.text).toMatch(/^\.subckt dut VDD VSS /mu);
      expect(result.file.text).not.toMatch(/\.global/u);
    }
  });
});

function ngspiceOnPath(): boolean {
  return spawnSync("ngspice", ["--version"], { encoding: "utf8" }).status === 0;
}

/** Every `v(vout) = …` an ngspice batch run of this deck prints, in order. */
function printedVout(deck: string): number[] {
  const directory = mkdtempSync(join(tmpdir(), "icm-unpowered-"));
  try {
    writeFileSync(join(directory, "deck.cir"), deck, "utf8");
    const output = execFileSync("ngspice", ["-b", "deck.cir"], {
      cwd: directory,
      encoding: "utf8",
    });
    return Array.from(output.matchAll(/v\(vout\)\s*=\s*(\S+)/gu), (match) =>
      Number(match[1]),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** Skips cleanly where ngspice is absent; the hosted gate never skips. */
describe.skipIf(!ngspiceOnPath())(
  "an unpowered ideal op-amp under ngspice",
  () => {
    it("amplifies with its supplies on ground", () => {
      const result = createDesignNetlistExport(unpoweredBlock("opamp"));
      if (result.status !== "ready") throw new Error("opamp blocked");
      const deck = [
        "* unpowered ideal op-amp",
        result.file.text.replace(/^\.end\s*$/mu, ""),
        "VP vip 0 1u",
        "VN vin 0 0",
        "XD vip vin vout dut",
        ".op",
        ".control",
        "run",
        "print v(vout)",
        ".endc",
        ".end",
      ].join("\n");
      // Open-loop gain 1e6 times 1 µV.
      expect(printedVout(deck)[0]).toBeCloseTo(1, 6);
    });
  },
);

describe.skipIf(!ngspiceOnPath())(
  "an ideal comparator whose high level is VDD under ngspice",
  () => {
    it("swings from vlow up to the VDD its Cell is given (#1306)", () => {
      // A 5 V supply, which a fixed 1 V high level never switched logic at.
      const project = unpoweredBlock("comparator");
      project.documents[0]!.instances[0]!.netlist = {
        binding: {
          kind: "unresolved-subcircuit",
          name: IDEAL_COMPARATOR_TARGET,
        },
        parameters: { vhigh: "VDD", vlow: "0", vtransition: "1m" },
      };
      const result = createDesignNetlistExport(project);
      if (result.status !== "ready") throw new Error("comparator blocked");
      const deck = [
        "* ideal comparator to its own VDD",
        result.file.text,
        "VS vdd 0 5",
        "VP vip 0 1",
        "VN vin 0 0.9",
        "XD vdd vip vin vout dut",
        ".control",
        "op",
        "print v(vout)",
        "alter VP dc=0.8",
        "op",
        "print v(vout)",
        ".endc",
        ".end",
      ].join("\n");
      const [high, low] = printedVout(deck);
      expect(high).toBeCloseTo(5, 6);
      expect(low).toBeCloseTo(0, 6);
    });
  },
);
