import { createEmptyProject } from "@icm/model";
import { expect, it } from "vitest";

import { createDesignNetlistExport } from "./export.js";

/**
 * One part bound to a reviewed SKY130 device, every pin left open, exported
 * as SPICE: its status, its X line and its REVIEWED_SIZE_OUT_OF_RANGE findings.
 */
function exportPart(
  master: string,
  parameters: Record<string, string>,
  symbolId = "nmos",
  terminals: readonly string[] = ["D", "G", "S", "B"],
) {
  const project = createEmptyProject("project", "Sizes", "dut");
  const document = project.documents[0]!;
  project.externalSubcircuitDefinitions.push({
    id: "definition",
    name: master,
    interfaceStatus: "declared",
    terminals: terminals.map((name) => ({
      id: `definition-${name}`,
      name,
      direction: "passive" as const,
    })),
    formalParameters: [],
  });
  document.instances.push({
    id: "XM1",
    reference: "XM1",
    symbolId,
    placement: null,
    netlist: {
      binding: { kind: "external-subcircuit", definitionId: "definition" },
      parameters,
    },
  });
  const pins = symbolId === "resistor" ? ["1", "2"] : terminals;
  document.noConnects.push(
    ...pins.map((pinName) => ({
      id: `XM1-${pinName}`,
      endpoint: { kind: "terminal" as const, instanceId: "XM1", pinName },
    })),
  );
  const exported = createDesignNetlistExport(project, { format: "spice" });
  return {
    status: exported.status,
    line:
      exported.status === "ready"
        ? exported.file.text.split("\n").find((text) => text.startsWith("XM1 "))
        : undefined,
    findings: exported.diagnostics
      .filter((item) => item.code === "REVIEWED_SIZE_OUT_OF_RANGE")
      .map(({ severity, objectIds, parameter, message }) => ({
        severity,
        objectIds,
        parameter,
        message,
      })),
  };
}

const NFET = "sky130_fd_pr__nfet_01v8";

it("warns of a SKY130 MOSFET shorter than its PDK makes it (#1474)", () => {
  // The Gallery's op amps drew L 0.08 µm on the 1.8 V pair, whose shortest is
  // 0.15 µm; the part still exports as drawn.
  const short = exportPart(NFET, { w: "1u", l: "80n", nf: "1", m: "1" });
  expect(short.status).toBe("ready");
  expect(short.line).toMatch(/ sky130_fd_pr__nfet_01v8 l=0\.08 w=1 nf=1 m=1$/u);
  expect(short.findings).toEqual([
    {
      severity: "warning",
      objectIds: ["XM1"],
      parameter: "l",
      message: expect.stringMatching(
        /^XM1 has L 0\.08 µm, below the 0\.15 µm minimum length of sky130_fd_pr__nfet_01v8\. /u,
      ),
    },
  ]);
  expect(exportPart(NFET, { w: "1u", l: "150n" }).findings).toEqual([]);
  expect(exportPart(NFET, { w: "1u", l: "0.15u" }).findings).toEqual([]);
  // Each device has its own: the 1.8 V PMOS LVT starts at 0.35 µm, the 10.5 V
  // pair at 0.5 µm.
  for (const [master, symbolId, length, limit] of [
    ["sky130_fd_pr__pfet_01v8_lvt", "pmos", "150n", "0.35"],
    ["sky130_fd_pr__nfet_g5v0d10v5", "nmos", "300n", "0.5"],
    ["sky130_fd_pr__pfet_g5v0d10v5", "pmos", "0.45u", "0.5"],
  ] as const) {
    const { findings } = exportPart(master, { l: length }, symbolId);
    expect(findings, master).toEqual([
      expect.objectContaining({
        parameter: "l",
        message: expect.stringContaining(
          `below the ${limit} µm minimum length of ${master}`,
        ),
      }),
    ]);
  }
  expect(
    exportPart("sky130_fd_pr__pfet_01v8_lvt", { l: "350n" }, "pmos").findings,
  ).toEqual([]);
});

it("warns of a SKY130 MOSFET finger narrower than its PDK makes one (#1474)", () => {
  const narrow = exportPart(NFET, { w: "300n", l: "150n", nf: "1" });
  expect(narrow.findings).toEqual([
    {
      severity: "warning",
      objectIds: ["XM1"],
      parameter: "w",
      message: expect.stringMatching(
        /^XM1 has W 0\.3 µm, below the 0\.36 µm minimum width per finger of sky130_fd_pr__nfet_01v8\. /u,
      ),
    },
  ]);
  // The finding names the parameter as the part spells it.
  expect(exportPart(NFET, { W: "300n" }).findings).toEqual([
    expect.objectContaining({ parameter: "W" }),
  ]);
  // W is the total over the fingers: 0.84 µm on two is 0.42 µm each, above
  // the 1.8 V NFET's 0.36 µm and exactly the 1.8 V PMOS's narrowest.
  expect(exportPart(NFET, { w: "840n", l: "150n", nf: "2" }).findings).toEqual(
    [],
  );
  expect(
    exportPart("sky130_fd_pr__pfet_01v8", { w: "0.84u", nf: "2" }, "pmos")
      .findings,
  ).toEqual([]);
  expect(exportPart(NFET, { w: "600n", l: "150n", nf: "2" }).findings).toEqual([
    expect.objectContaining({
      parameter: "w",
      message: expect.stringMatching(
        /^XM1 has W 0\.6 µm over 2 fingers, 0\.3 µm each, below the 0\.36 µm minimum width per finger/u,
      ),
    }),
  ]);
});

it("warns of a size over 1 mm, which is almost always a missing unit (#1474)", () => {
  // An import kept SKY130's micrometre numbers without a unit, so the editor
  // reads them as metres and the X line says 150000 µm.
  const slipped = exportPart(NFET, { w: "1", l: "0.15" });
  expect(slipped.status).toBe("ready");
  expect(slipped.line).toMatch(/ l=150000 w=1000000$/u);
  expect(slipped.findings).toEqual([
    expect.objectContaining({
      severity: "warning",
      parameter: "w",
      message: expect.stringMatching(
        /^XM1 has W 1, which is 1000000 µm: over 1 mm.*write 1u if you mean 1 µm/u,
      ),
    }),
    expect.objectContaining({
      severity: "warning",
      parameter: "l",
      message: expect.stringMatching(
        /^XM1 has L 0\.15, which is 150000 µm: over 1 mm.*write 0\.15u if you mean 0\.15 µm/u,
      ),
    }),
  ]);
  // Every reviewed device with micrometre geometry, not only the MOSFETs.
  expect(
    exportPart("sky130_fd_pr__res_high_po", { w: "1u", l: "5.5" }, "resistor", [
      "R0",
      "R1",
      "B",
    ]).findings,
  ).toEqual([
    expect.objectContaining({
      parameter: "l",
      message: expect.stringContaining("XM1 has L 5.5, which is 5500000 µm"),
    }),
  ]);
});

it("leaves sizes an expression gives unchecked (#1474)", () => {
  expect(exportPart(NFET, { w: "{wn}", l: "{ln}" }).findings).toEqual([]);
  expect(exportPart(NFET, { w: "300n", nf: "{fingers}" }).findings).toEqual([]);
});

it("leaves a device modelled only at a few sizes to REVIEWED_SIZE_UNMODELLED (#1474)", () => {
  // L 0.7 without a unit is 0.7 m: one finding, naming the 16 V bins, not two.
  expect(
    exportPart("sky130_fd_pr__nfet_g5v0d16v0", { l: "0.7" }, "ndmos").findings,
  ).toEqual([]);
});
