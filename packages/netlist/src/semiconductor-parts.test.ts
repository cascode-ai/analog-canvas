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
          // As placed: each parameter's default, then the given ones.
          parameters: {
            ...Object.fromEntries(
              device!.parameters.flatMap((parameter) =>
                parameter.defaultValue
                  ? [[parameter.name, parameter.defaultValue]]
                  : [],
              ),
            ),
            ...parameters,
          },
        },
  });
  const pins = body
    ? body.ports
        .filter((port) => !port.optional)
        .map((port) => [port.name, port.pinName!] as const)
    : device!.pinOrder.map(
        (pin) =>
          [
            `n_${pin === "+" ? "p" : pin === "-" ? "n" : pin.replace(/\W/gu, "")}`,
            pin,
          ] as const,
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
    [
      "phototransistor",
      /^Q1 n_C n_B n_E NPN\b/mu,
      /^Q1 \(n_C n_B n_E\) NPN\b/mu,
    ],
    ["mesfet", /^J1 n_D n_G n_S NJF\b/mu, /^J1 \(n_D n_G n_S\) NJF\b/mu],
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

describe("regulators, references and board parts (#2444)", () => {
  it.each([
    ["fuse", /^RF1 n_1 n_2 10m$/mu, /^F1 \(n_1 n_2\) resistor r=10m$/mu],
    [
      "voltmeter",
      /^RVM1 n_p n_n 10Meg$/mu,
      /^VM1 \(n_p n_n\) resistor r=10M$/mu,
    ],
    ["dc-motor", /^RM1 n_1 n_2 10$/mu, /^M1 \(n_1 n_2\) resistor r=10$/mu],
    ["buzzer", /^CBZ1 n_1 n_2 20n$/mu, /^BZ1 \(n_1 n_2\) capacitor c=20n$/mu],
    [
      "thermocouple",
      /^VTC1 n_p n_n DC 1m$/mu,
      /^TC1 \(n_p n_n\) vsource dc=1m/mu,
    ],
    [
      "noise-voltage-source",
      /^VN1 n_p n_n DC 0 AC 1/mu,
      /^VN1 \(n_p n_n\) vsource dc=0/mu,
    ],
  ])("export a %s as its primitive", (symbolId, spice, spectre) => {
    const [spiceText, spectreText] = exported(partCell(symbolId));
    expect(spiceText).toMatch(spice);
    expect(spectreText).toMatch(spectre);
  });

  it("export a TL431 as a reference, an error amplifier and an NPN", () => {
    const [spice, spectre] = exported(partCell("shunt-regulator"));
    expect(spice).toContain(
      [
        ".subckt tl431 k a ref",
        ".model qn NPN(IS=1e-16 BF=100 VAF=100)",
        ".model dj D(IS=1e-14 N=1)",
        "VREF nr a DC 2.495",
        "EAMP nx a ref nr 1000",
        "RB nx nb 1k",
        "Q1 k nb a qn",
        "DREV a k dj",
        ".ends tl431",
      ].join("\n"),
    );
    expect(spice).toMatch(/^X1 k a ref tl431$/mu);
    expect(spectre).toContain("EAMP (nx a ref nr) vcvs gain=1000");
  });

  it.each([
    ["voltage-regulator", "voltage_regulator", "5"],
    ["voltage-reference", "voltage_reference", "2.5"],
  ])(
    "export a %s as a pass transistor held at vout",
    (symbolId, target, vout) => {
      const [spice, spectre] = exported(partCell(symbolId, { vout: "3.3" }));
      expect(spice).toContain(
        [
          `.subckt ${target} in gnd out params: vout=${vout}`,
          ".model qn NPN(IS=1e-16 BF=100 VAF=100)",
          "VREF nr gnd DC {vout}",
          "EAMP nx gnd nr out 1000",
          "RB nx nb 1k",
          "Q1 in nb out qn",
          `.ends ${target}`,
        ].join("\n"),
      );
      expect(spice).toMatch(
        new RegExp(`^X1 in gnd out ${target} vout=3.3$`, "mu"),
      );
      expect(spectre).toContain("VREF (nr gnd) vsource dc=vout");
    },
  );

  it("export a solar cell as a photocurrent beside a diode", () => {
    const [spice, spectre] = exported(partCell("solar-cell"));
    expect(spice).toContain(
      [
        ".subckt solar_cell p n params: isc=10m",
        ".model dj D(IS=1e-14 N=1)",
        "IPH n p DC {isc}",
        "D1 p n dj",
        ".ends solar_cell",
      ].join("\n"),
    );
    expect(spectre).toContain("IPH (n p) isource dc=isc");
  });

  it("export an antenna as a resistance to ground on its one pin", () => {
    const [spice, spectre] = exported(partCell("antenna"));
    expect(spice).toContain(
      [".subckt antenna p", "R1 p 0 1G", ".ends antenna"].join("\n"),
    );
    expect(spice).toMatch(/^X1 p antenna$/mu);
    expect(spectre).toContain("R1 (p 0) resistor r=1G");
  });

  it("export a controlled current source as gm times V(CTRL)", () => {
    const [spice, spectre] = exported(
      partCell("controlled-current-source", { gm: "2m" }),
    );
    expect(spice).toContain(
      [
        ".subckt controlled_current_source p n ctrl params: gm=1m",
        "GCORE p n ctrl 0 {gm}",
        ".ends controlled_current_source",
      ].join("\n"),
    );
    expect(spice).toMatch(/^X1 p n ctrl controlled_current_source gm=2m$/mu);
    expect(spectre).toContain("GCORE (p n ctrl 0) vccs gm=gm");
  });

  it("export an electromagnetic SPDT relay as its coil and smooth contact model", () => {
    const [spice, spectre] = exported(partCell("relay", { rcoil: "200" }));
    expect(spice).toContain(
      ".subckt spdt_relay COILP COILN COM NO NC params: rcoil=150 von=5 ron=1 roff=1e12",
    );
    expect(spice).toContain("Rcoil COILP COILN {rcoil}");
    expect(spice).toMatch(/^X1 COILP COILN COM NO NC spdt_relay rcoil=200$/mu);
    expect(spectre).toContain("subckt spdt_relay (COILP COILN COM NO NC)");
    expect(spectre).toContain("Rcoil (COILP COILN) resistor r=rcoil");
  });

  it("export a center-tapped transformer as 3 windings by default and 4 when PC is wired", () => {
    const [spice5, spectre5] = exported(
      partCell("center-tap-xfmr", { lp: "1m", ls: "4m", k: "0.99" }),
    );
    expect(spice5).toContain(
      [
        ".subckt center_tap_xfmr PP PN SP SC SN params: lp=1m ls=1m k=0.99",
        "LP PP PN {lp}",
        "LS1 SP SC {ls/4}",
        "LS2 SC SN {ls/4}",
        "KPS1 LP LS1 {k}",
        "KPS2 LP LS2 {k}",
        "KSS LS1 LS2 {abs(k)}",
        ".ends center_tap_xfmr",
      ].join("\n"),
    );
    expect(spice5).toMatch(
      /^X1 PP PN SP SC SN center_tap_xfmr k=0.99 lp=1m ls=4m$/mu,
    );
    expect(spectre5).toContain(
      "KPS1 mutual_inductor coupling=k ind1=LP ind2=LS1",
    );
    expect(spectre5).toContain(
      "KSS mutual_inductor coupling=abs(k) ind1=LS1 ind2=LS2",
    );

    // Wiring optional primary center tap PC selects the dual-tap 4-winding body.
    const dual = partCell("center-tap-xfmr", { lp: "1m", ls: "4m", k: "0.99" });
    const doc = dual.documents[0]!;
    doc.instances.push({ id: "pin-PC", symbolId: "port", placement: null });
    doc.nets.push({
      id: "PC",
      terminals: [
        { instanceId: "pin-PC", pinName: "P" },
        { instanceId: "part", pinName: "PC" },
      ],
    });
    doc.netlist!.terminals.push({
      id: "terminal-PC",
      name: "PC",
      netId: "PC",
      direction: "inout",
      interfaceInstanceIds: ["pin-PC"],
    });
    const [spice6, spectre6] = exported(dual);
    expect(spice6).toContain(
      [
        ".subckt icm_center_tap_xfmr_dual PP PN SP SC SN PC params: lp=1m ls=1m k=0.99",
        "LP1 PP PC {lp/4}",
        "LP2 PC PN {lp/4}",
        "LS1 SP SC {ls/4}",
        "LS2 SC SN {ls/4}",
        "KPP LP1 LP2 {abs(k)}",
        "KSS LS1 LS2 {abs(k)}",
        "KP1S1 LP1 LS1 {k}",
        "KP1S2 LP1 LS2 {k}",
        "KP2S1 LP2 LS1 {k}",
        "KP2S2 LP2 LS2 {k}",
        ".ends icm_center_tap_xfmr_dual",
      ].join("\n"),
    );
    expect(spice6).toMatch(
      /^X1 PP PN SP SC SN PC icm_center_tap_xfmr_dual k=0.99 lp=1m ls=4m$/mu,
    );
    expect(spectre6).toContain(
      "subckt icm_center_tap_xfmr_dual (PP PN SP SC SN PC)",
    );
  });
});
