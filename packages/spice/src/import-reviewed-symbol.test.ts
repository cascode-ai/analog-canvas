import { expect, it } from "vitest";

import { importSpiceSources } from "./importer.js";

const input = (path: string, text: string) => ({
  path,
  bytes: new TextEncoder().encode(text),
});

it.each([
  ["PNP", "pnp", "Q1 c b e device"],
  ["NPN", "npn", "Q1 c b e device"],
  ["D", "diode", "D1 a k device"],
])(
  "imports %s model cards with attached or separated parentheses",
  async (type, symbol, card) => {
    for (const tail of [
      `${type}(IS=1e-16)`,
      `${type} (IS=1e-16)`,
      `${type} IS=1e-16`,
      type,
    ]) {
      const text = `* device\n.model device ${tail}\n${card}\n.end\n`;
      const result = await importSpiceSources(
        [input("device.sp", text)],
        "device.sp",
      );
      expect(
        result.diagnostics.filter((d) => d.severity === "error"),
        tail,
      ).toEqual([]);
      expect(
        result
          .project!.documents.flatMap((d) => d.instances)
          .some((i) => i.symbolId === symbol),
        tail,
      ).toBe(true);
    }
  },
);

it("imports SKY130's drain-extended devices as the Extended Devices DMOS", async () => {
  const text = [
    "* high-voltage devices",
    ".subckt top d g s b d2 g2 s2 b2",
    "XM1 d g s b sky130_fd_pr__nfet_g5v0d16v0 w=5 l=0.7 nf=1 m=1",
    // As export writes a 20 V device: its own channel, then the count (#1486).
    "XM2 d2 g2 s2 b2 sky130_fd_pr__pfet_20v0 l=0.5 w=30 m=2",
    ".ends top",
    ".end",
    "",
  ].join("\n");
  const result = await importSpiceSources([input("hv.spi", text)], "hv.spi");
  expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  const project = result.project!;
  const top = project.documents.find((document) => document.name === "top")!;
  const nmos = top.instances.find((instance) => instance.id === "XM1")!;
  const pmos = top.instances.find((instance) => instance.id === "XM2")!;
  expect(nmos.symbolId).toBe("ndmos");
  expect(pmos.symbolId).toBe("pdmos");
  // Reviewed geometry arrives in canonical metres; 20 V takes only its count,
  // its channel being the device's own.
  expect(nmos.netlist?.parameters).toEqual({
    w: "5u",
    l: "700n",
    nf: "1",
    m: "1",
  });
  expect(pmos.netlist?.parameters).toEqual({ m: "2" });
  // The drawn D G S B pins carry the source's nets, in the wrapper's order.
  const netOf = (instanceId: string, pinName: string) =>
    top.nets.find((net) =>
      net.terminals.some(
        (terminal) =>
          terminal.instanceId === instanceId && terminal.pinName === pinName,
      ),
    );
  for (const pinName of ["D", "G", "S", "B"])
    expect(netOf("XM1", pinName), pinName).toBeDefined();
  const definition = project.externalSubcircuitDefinitions.find(
    (item) => item.name === "sky130_fd_pr__nfet_g5v0d16v0",
  )!;
  expect(definition.interfaceStatus).toBe("declared");
  expect(definition.terminals.map((terminal) => terminal.name)).toEqual([
    "D",
    "G",
    "S",
    "B",
  ]);
});

it("imports a SKY130 MOS written as a plain M card, which has no .model card, as the X call it is (#1249)", async () => {
  // This product's own export of a MOS bound to the model by name.
  const text = [
    "* plain M cards",
    ".subckt top d g s b vdd",
    "M1 d g s b sky130_fd_pr__nfet_01v8 l=150n m=1 nf=1 w=1u",
    "M2 d g vdd vdd sky130_fd_pr__pfet_01v8 l=150n m=1 nf=1 w=2u",
    ".ends top",
    ".end",
    "",
  ].join("\n");
  const result = await importSpiceSources([input("m.spi", text)], "m.spi");
  // Before: "the approved Razavi catalog has no symbol" for both.
  expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  const top = result.project!.documents.find((d) => d.name === "top")!;
  expect(
    top.instances
      .filter((instance) => instance.reference?.startsWith("M"))
      .map((instance) => [
        instance.reference,
        instance.symbolId,
        instance.netlist?.binding,
      ]),
  ).toEqual([
    ["M1", "nmos", expect.objectContaining({ kind: "external-subcircuit" })],
    ["M2", "pmos", expect.objectContaining({ kind: "external-subcircuit" })],
  ]);
  // The SKY130 library defines these as subcircuits, so a model card of
  // that name is one its simulation profile cannot run: they bind the
  // reviewed devices, in the terminal order those declare.
  const definitions = result.project!.externalSubcircuitDefinitions;
  for (const [reference, master] of [
    ["M1", "sky130_fd_pr__nfet_01v8"],
    ["M2", "sky130_fd_pr__pfet_01v8"],
  ] as const) {
    const instance = top.instances.find(
      (item) => item.reference === reference,
    )!;
    const binding = instance.netlist!.binding!;
    const definition = definitions.find(
      (item) =>
        binding.kind === "external-subcircuit" &&
        item.id === binding.definitionId,
    )!;
    expect(definition).toMatchObject({
      name: master,
      interfaceStatus: "declared",
    });
    expect(definition.terminals.map((terminal) => terminal.name)).toEqual([
      "D",
      "G",
      "S",
      "B",
    ]);
    expect(instance.importProvenance?.status).toBe("resolved");
  }
  // W and L of an M card are already in metres, as the devices store them.
  expect(
    top.instances.find((item) => item.reference === "M2")!.netlist!.parameters,
  ).toMatchObject({ w: "2u", l: "150n", m: "1", nf: "1" });
});

it("keeps an M card a model card when the deck declares that .model", async () => {
  const text = [
    ".model sky130_fd_pr__nfet_01v8 nmos level=1",
    ".subckt top d g s b",
    "M1 d g s b sky130_fd_pr__nfet_01v8 l=150n w=1u",
    ".ends top",
    ".end",
    "",
  ].join("\n");
  const result = await importSpiceSources([input("m.spi", text)], "m.spi");
  const top = result.project!.documents.find((d) => d.name === "top")!;
  expect(
    top.instances.find((item) => item.reference === "M1")!.netlist!.binding,
  ).toMatchObject({ kind: "model", name: "sky130_fd_pr__nfet_01v8" });
});

it("says which .model card a device of unknown type needs", async () => {
  const text = [
    ".subckt top d g s b",
    "M1 d g s b mystery w=1u l=1u",
    ".ends top",
    ".end",
    "",
  ].join("\n");
  const result = await importSpiceSources([input("m.spi", text)], "m.spi");
  expect(
    result.diagnostics.find((d) => d.code === "SPICE_IMPORT_UNSUPPORTED_SYMBOL")
      ?.message,
  ).toBe(
    'M1 uses model mystery, which no .model card declares, so its device type is unknown. Add ".model mystery nmos" or ".model mystery pmos".',
  );
});

it("takes an undeclared model's device type from another reading of the files, and a declared card over it", async () => {
  const text = [
    ".model declared pmos level=1",
    ".subckt top d g s b",
    "M1 d g s b mystery w=1u l=1u",
    "M2 d g s b declared w=1u l=1u",
    ".ends top",
    ".end",
    "",
  ].join("\n");
  const result = await importSpiceSources(
    [input("m.spi", text)],
    "m.spi",
    {},
    {
      modelTypes: new Map([
        ["MYSTERY", "nmos"],
        ["declared", "nmos"],
      ]),
    },
  );
  expect(result.successful).toBe(true);
  const top = result.project!.documents.find((d) => d.name === "top")!;
  const part = (reference: string) =>
    top.instances.find((item) => item.reference === reference)!;
  expect(part("M1").symbolId).toBe("nmos");
  expect(part("M1").netlist!.binding).toMatchObject({
    kind: "model",
    name: "mystery",
  });
  expect(part("M2").symbolId).toBe("pmos");
});

it("suggests native Spectre model statements for an undeclared model in SCS", async () => {
  const result = await importSpiceSources(
    [input("bipolar.scs", "* converted SCS\nQ1 c b e mystery\n.end\n")],
    "bipolar.scs",
  );
  expect(
    result.diagnostics.find((d) => d.code === "SPICE_IMPORT_UNSUPPORTED_SYMBOL")
      ?.message,
  ).toBe(
    'Q1 uses model mystery, which no model statement declares, so its device type is unknown. Add "model mystery bjt type=npn" or "model mystery bjt type=pnp".',
  );
});

it("imports a standard-cell call as the external block it declares, not a Library gate (#1450)", async () => {
  // A cell is reviewed only behind a gate someone bound it to: its four rails
  // have no place on the gate's symbol.
  const text = [
    "* standard cell",
    ".subckt top a b y vdd vss",
    "X1 a b vss vss vdd vdd y sky130_fd_sc_hd__nand2_1",
    ".ends top",
    ".end",
    "",
  ].join("\n");
  const result = await importSpiceSources(
    [input("cell.spi", text)],
    "cell.spi",
  );
  expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  const top = result.project!.documents.find((d) => d.name === "top")!;
  const cell = top.instances.find((instance) => instance.reference === "X1")!;
  expect(cell.symbolId).not.toBe("nand-gate");
  expect(cell.netlist?.binding?.kind).toBe("external-subcircuit");
  const pins = top.nets.flatMap((net) =>
    net.terminals
      .filter((terminal) => terminal.instanceId === cell.id)
      .map((terminal) => terminal.pinName),
  );
  // Seven pins of its own, each on its node: the rails stay apart.
  expect(new Set(pins).size).toBe(7);
});
