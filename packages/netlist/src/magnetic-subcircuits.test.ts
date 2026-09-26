import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { evaluateSimulatability } from "@icm/derived";
import {
  createEmptyProject,
  type CircuitProject,
  type ComponentDefinition,
} from "@icm/model";

import { createDesignNetlistExport } from "./export.js";
import { analyzeDesignNetlist } from "./extract.js";
import { printVacaskWithLocations } from "./vacask-printer.js";

/**
 * One magnetic device inside Cell `dut`, each pin on a Cell Pin named after
 * the node it reaches.
 */
function magneticProject(
  symbolId: "tcoil" | "xfmr",
  pins: readonly (readonly [pin: string, node: string])[],
  parameters: Record<string, string>,
  reference = "X1",
): CircuitProject {
  const project = createEmptyProject("magnetic", "Magnetic", "dut");
  const document = project.documents[0]!;
  document.netlist!.name = "dut";
  document.instances.push({
    id: "device",
    symbolId,
    placement: null,
    reference,
    netlist: { parameters },
  });
  for (const [pin, node] of pins) {
    document.instances.push({ id: node, symbolId: "port", placement: null });
    document.nets.push({
      id: node,
      terminals: [
        { instanceId: "device", pinName: pin },
        { instanceId: node, pinName: "P" },
      ],
    });
    document.netlist!.terminals.push({
      id: `terminal-${node}`,
      name: node,
      netId: node,
      direction: "inout",
      interfaceInstanceIds: [node],
    });
  }
  return project;
}

const tcoil = () =>
  magneticProject(
    "tcoil",
    [
      ["1", "a"],
      ["2", "b"],
      ["3", "tap"],
    ],
    { l1: "1n", l2: "2n", k: "0.5", cb: "10f" },
  );

const transformer = () =>
  magneticProject(
    "xfmr",
    [
      ["P-", "pm"],
      ["P+", "pp"],
      ["S-", "sm"],
      ["S+", "sp"],
    ],
    { lp: "1n", ls: "4n", k: "0.8" },
    "X7",
  );

function exported(project: CircuitProject, format: "spice" | "spectre") {
  const result = createDesignNetlistExport(project, { format });
  expect(
    result.diagnostics.filter((item) => item.severity === "error"),
  ).toEqual([]);
  if (result.status !== "ready") throw new Error("export blocked");
  return result.file.text;
}

describe("drawn magnetic devices", () => {
  it("writes a T-coil as a call on its coupled-winding subcircuit", () => {
    const text = exported(tcoil(), "spice");
    expect(text).toContain("X1 a b tap tcoil l1=1n l2=2n k=0.5 cb=10f");
    // L1 runs from its dot at pin 1 to the tap, L2 from its dot at the tap
    // to pin 2, so the two windings aid end to end; CB bridges the ends.
    expect(text).toContain(
      [
        ".subckt tcoil n1 n2 n3 params: l1=1n l2=1n k=1 cb=1p",
        "L1 n1 n3 {l1}",
        "L2 n3 n2 {l2}",
        "K12 L1 L2 {k}",
        "CB n1 n2 {cb}",
        ".ends tcoil",
      ].join("\n"),
    );
    // Defined once, ahead of the Cell that calls it.
    expect(text.indexOf(".subckt tcoil")).toBeLessThan(
      text.indexOf(".subckt dut"),
    );
    expect(text.split(".subckt tcoil").length).toBe(2);
  });

  it("writes a transformer from the dotted + pins, in SPICE and Spectre", () => {
    const spice = exported(transformer(), "spice");
    expect(spice).toContain("X7 pm pp sm sp xfmr lp=1n ls=4n k=0.8");
    expect(spice).toContain(
      [
        ".subckt xfmr p_minus p_plus s_minus s_plus params: lp=1n ls=1n k=1",
        "LP p_plus p_minus {lp}",
        "LS s_plus s_minus {ls}",
        "K1 LP LS {k}",
        ".ends xfmr",
      ].join("\n"),
    );
    const spectre = exported(transformer(), "spectre");
    expect(spectre).toContain("X7 (pm pp sm sp) xfmr lp=1n ls=4n k=0.8");
    expect(spectre).toContain(
      [
        "subckt xfmr (p_minus p_plus s_minus s_plus)",
        "parameters lp=1n ls=1n k=1",
        "LP (p_plus p_minus) inductor l=lp",
        "LS (s_plus s_minus) inductor l=ls",
        "K1 mutual_inductor coupling=k ind1=LP ind2=LS",
        "ends xfmr",
      ].join("\n"),
    );
  });

  it("lowers the copy of the definition a saved Project carries", () => {
    // A saved file carries the definitions of the parts it uses; the copy
    // comes back with its keys in another order but means the same device.
    const source = JSON.parse(
      readFileSync(
        resolve(process.cwd(), "packages/components/definitions/tcoil.json"),
        "utf8",
      ),
    ) as ComponentDefinition;
    const reordered = Object.fromEntries(
      Object.entries(source.electrical!).reverse(),
    ) as ComponentDefinition["electrical"];
    const project = tcoil();
    project.componentDefinitions = [
      { symbol: source.symbol, electrical: reordered },
    ];
    expect(exported(project, "spice")).toContain(
      "X1 a b tap tcoil l1=1n l2=2n k=0.5 cb=10f",
    );
  });

  it("offers the call's values for editing, not the subcircuit it names", () => {
    const result = createDesignNetlistExport(tcoil(), {
      includeLocations: true,
    });
    if (result.status !== "ready") throw new Error("export blocked");
    const fields = result.locations.fields.filter(
      (field) => field.instanceId === "device",
    );
    expect(fields.map((field) => [field.kind, field.rawValue])).toEqual([
      ["reference", "X1"],
      ["parameter", "1n"],
      ["parameter", "2n"],
      ["parameter", "0.5"],
      ["parameter", "10f"],
    ]);
  });

  it("writes one subcircuit however many devices call it", () => {
    const project = tcoil();
    const document = project.documents[0]!;
    document.instances.push({
      id: "second",
      symbolId: "tcoil",
      placement: null,
      reference: "X2",
      netlist: { parameters: { l1: "3n", l2: "3n", k: "0.3", cb: "5f" } },
    });
    for (const net of document.nets)
      net.terminals.push({
        instanceId: "second",
        pinName: net.id === "a" ? "1" : net.id === "b" ? "2" : "3",
      });
    const text = exported(project, "spice");
    expect(text).toContain("X2 a b tap tcoil l1=3n l2=3n k=0.3 cb=5f");
    expect(text.split(".subckt tcoil").length).toBe(2);
  });

  it("refuses values the subcircuit cannot take", () => {
    const outOfRange = tcoil();
    outOfRange.documents[0]!.instances[0]!.netlist!.parameters = {
      l1: "1n",
      l2: "1n",
      k: "1.2",
      cb: "1p",
      m: "2",
    };
    const blocked = createDesignNetlistExport(outOfRange);
    expect(blocked.status).toBe("blocked");
    expect(
      blocked.diagnostics
        .filter((item) => item.severity === "error")
        .map((item) => [item.code, item.parameter]),
    ).toEqual([
      ["MAGNETIC_COUPLING_OUT_OF_RANGE", "k"],
      ["MAGNETIC_PARAMETER_NOT_ACCEPTED", "m"],
    ]);

    const missing = transformer();
    missing.documents[0]!.instances[0]!.netlist!.parameters = {
      lp: "1n",
      k: "0.9",
    };
    expect(
      createDesignNetlistExport(missing)
        .diagnostics.filter((item) => item.severity === "error")
        .map((item) => [item.code, item.parameter]),
    ).toEqual([["MISSING_REQUIRED_PARAMETER", "ls"]]);
  });

  it("refuses a Cell that already exports under the subcircuit's name", () => {
    const project = tcoil();
    project.documents[0]!.netlist!.name = "tcoil";
    const result = createDesignNetlistExport(project);
    expect(result.status).toBe("blocked");
    expect(result.diagnostics.map((item) => item.code)).toContain(
      "MAGNETIC_SUBCIRCUIT_NAME_COLLISION",
    );
  });

  it("counts as simulatable, but not on native VACASK", () => {
    expect(evaluateSimulatability(tcoil()).blockers).toEqual([]);
    expect(evaluateSimulatability(transformer()).blockers).toEqual([]);
    const analysis = analyzeDesignNetlist(transformer());
    const printed = printVacaskWithLocations(analysis.ir!);
    expect(printed.ok).toBe(false);
    if (printed.ok) return;
    expect(printed.diagnostics.map((item) => item.code)).toEqual([
      "VACASK_UNSUPPORTED_DEVICE",
    ]);
  });
});
