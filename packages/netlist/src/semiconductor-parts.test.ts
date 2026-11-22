import { describe, expect, it } from "vitest";

import { createEmptyProject, type CircuitProject } from "@icm/model";
import {
  deviceDescriptor,
  matchingGenericModelName,
  subcircuitDescriptor,
} from "@icm/devices";

import { createDesignNetlistExport } from "./export.js";

/** One part X1 in Cell `dut`, each of its pins on a Cell Pin `<port>`. */
function partCell(
  symbolId: string,
  parameters: Record<string, string> = {},
): CircuitProject {
  const project = createEmptyProject(`part-${symbolId}`, symbolId, "dut");
  const document = project.documents[0]!;
  document.netlist!.name = "dut";
  const body = subcircuitDescriptor(symbolId);
  const device = deviceDescriptor(symbolId);
  const generic = {
    diode: "DIODE",
    bjt: "NPN",
    jfet: "NJF",
  }[device?.deviceClass as string];
  document.instances.push({
    id: "part",
    symbolId,
    reference: body ? "X1" : `${device!.referencePrefix}1`,
    placement: null,
    netlist: body
      ? {
          binding: { kind: "unresolved-subcircuit", name: body.target },
          parameters,
        }
      : {
          ...(generic
            ? {
                binding: {
                  kind: "model",
                  deviceClass: device!.deviceClass,
                  name: generic,
                },
              }
            : {}),
          parameters,
        },
  });
  const pins = body
    ? body.ports.map((port) => [port.name, port.pinName!] as const)
    : device!.pinOrder.map(
        (pin) => [`n_${pin.replace(/\W/gu, "")}`, pin] as const,
      );
  for (const [name, pinName] of pins) {
    document.instances.push({
      id: `pin-${name}`,
      symbolId: "port",
      placement: null,
    });
    document.nets.push({
      id: name,
      terminals: [
        { instanceId: `pin-${name}`, pinName: "P" },
        { instanceId: "part", pinName },
      ],
    });
    document.netlist!.terminals.push({
      id: `terminal-${name}`,
      name,
      netId: name,
      direction: "inout",
      interfaceInstanceIds: [`pin-${name}`],
    });
  }
  return project;
}

function exported(project: CircuitProject) {
  return (["spice", "spectre"] as const).map((format) => {
    const result = createDesignNetlistExport(project, { format });
    expect(result.status, JSON.stringify(result.diagnostics)).toBe("ready");
    return result.status === "ready" ? result.file.text : "";
  });
}

describe("optoelectronic and power semiconductors (#2441)", () => {
  it.each([
    ["photodiode", /^D1 n_A n_K DIODE$/mu, /^D1 \(n_A n_K\) DIODE$/mu],
    ["varactor-diode", /^D1 n_A n_K DIODE$/mu, /^D1 \(n_A n_K\) DIODE$/mu],
    ["phototransistor", /^Q1 n_C n_B n_E NPN$/mu, /^Q1 \(n_C n_B n_E\) NPN$/mu],
    ["mesfet", /^J1 n_D n_G n_S NJF$/mu, /^J1 \(n_D n_G n_S\) NJF$/mu],
  ])(
    "export a %s as its primitive on the generic card",
    (symbolId, spice, spectre) => {
      const [spiceText, spectreText] = exported(partCell(symbolId));
      expect(spiceText).toMatch(spice);
      expect(spectreText).toMatch(spectre);
      // The family's stand-in card goes with it.
      expect(spiceText).toMatch(/^\.model (?:DIODE D|NPN NPN|NJF NJF)\(/mu);
    },
  );

  it.each([
    ["photodiode", "DIODE"],
    ["varactor-diode", "DIODE"],
    ["phototransistor", "NPN"],
    ["mesfet", "NJF"],
  ])("knows a %s on %s takes its family's stand-in", (symbolId, name) => {
    expect(
      matchingGenericModelName({
        symbolId,
        netlist: { binding: { kind: "model", name } },
      }),
    ).toBe(name);
  });

  it("export a thyristor as its two-transistor body, resting off", () => {
    const [spice, spectre] = exported(partCell("thyristor"));
    expect(spice).toContain(
      [
        ".subckt scr a g k",
        ".model qn NPN(IS=1e-16 BF=100 VAF=100)",
        ".model qp PNP(IS=1e-16 BF=50 VAF=50)",
        "Q1 g n1 a qp off",
        "Q2 n1 g k qn off",
        "RAG n1 a 10k",
        "CAG n1 a 10p",
        "RGK g k 1k",
        "CGK g k 10p",
        ".ends scr",
      ].join("\n"),
    );
    expect(spice).toMatch(/^X1 a g k scr$/mu);
    expect(spectre).toContain("Q1 (g n1 a) qp region=off");
    expect(spectre).toMatch(/^X1 \(a g k\) scr$/mu);
  });

  it("export an IGBT as an NMOS driving a PNP", () => {
    const [spice, spectre] = exported(partCell("igbt"));
    expect(spice).toContain(
      [
        ".subckt igbt c g e",
        ".model nm nmos level=54 vth0=4",
        ".model qp PNP(IS=1e-16 BF=50 VAF=50)",
        "M1 nb g e e nm w=1m l=1u",
        "Q1 e nb c qp",
        ".ends igbt",
      ].join("\n"),
    );
    expect(spice).toMatch(/^X1 c g e igbt$/mu);
    expect(spectre).toContain("model nm bsim4 type=n vth0=4");
    expect(spectre).toContain("M1 (nb g e e) nm w=1m l=1u");
  });

  it("export a current-regulative diode as a JFET with its gate on its source", () => {
    const [spice, spectre] = exported(
      partCell("current-regulative-diode", { idss: "5.6m" }),
    );
    expect(spice).toContain(
      [
        ".subckt crd a k params: idss=5m",
        ".model cj NJF(VTO=-2 BETA=0.25m LAMBDA=0.002)",
        "J1 a k k cj area={idss/1m}",
        ".ends crd",
      ].join("\n"),
    );
    expect(spice).toMatch(/^X1 a k crd idss=5.6m$/mu);
    expect(spectre).toContain("J1 (a k k) cj area=idss/1m");
  });

  it("export a Schottky-clamped NPN as an NPN with a Schottky diode from base to collector", () => {
    const [spice, spectre] = exported(partCell("schottky-npn"));
    expect(spice).toContain(
      [
        ".subckt schottky_npn c b e",
        ".model qn NPN(IS=1e-16 BF=100 VAF=100)",
        ".model ds D(IS=1e-8 N=1.05 RS=1)",
        "Q1 c b e qn",
        "DS b c ds",
        ".ends schottky_npn",
      ].join("\n"),
    );
    expect(spice).toMatch(/^X1 c b e schottky_npn$/mu);
    expect(spectre).toContain("DS (b c) ds");
  });
});
