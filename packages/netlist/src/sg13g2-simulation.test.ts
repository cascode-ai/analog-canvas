import { createEmptyProject, createSimulationFolder } from "@icm/model";
import { expect, it } from "vitest";
import {
  ngspiceSimulationDevices,
  nativeDeviceOpVectors,
  nativeTerminalCurrent,
} from "./simulation-ngspice-devices.js";
import { compileNgspiceSourceSimulation } from "./simulation-source-ngspice.js";
import { createDesignNetlistExport } from "./export.js";

it("reports unsupported SG13 dimensions and HBT counts through export without rewriting authored values", () => {
  const project = createEmptyProject("sizes", "Sizes");
  const document = project.documents[0]!;
  for (const [id, symbol, master, pins, parameters] of [
    [
      "M1",
      "nmos",
      "sg13_hv_nmos",
      ["D", "G", "S", "B"],
      { w: "1u", l: "150n", ng: "1", m: "1" },
    ],
    [
      "Q1",
      "npn",
      "npn13G2v",
      ["C", "B", "E", "S"],
      { le: "1u", we: "70n", Nx: "11" },
    ],
  ] as const) {
    project.externalSubcircuitDefinitions.push({
      id,
      name: master,
      interfaceStatus: "declared",
      formalParameters: [],
      terminals: (symbol === "nmos"
        ? ["d", "g", "s", "b"]
        : ["c", "b", "e", "bn"]
      ).map((name) => ({ id: name, name, direction: "passive" })),
    });
    document.instances.push({
      id,
      reference: id,
      symbolId: symbol,
      placement: null,
      netlist: {
        binding: { kind: "external-subcircuit", definitionId: id },
        parameters: { ...parameters },
      },
    });
    for (const pin of pins)
      document.nets.push({
        id: id + pin,
        terminals: [{ instanceId: id, pinName: pin }],
      });
  }
  const before = structuredClone(project);
  const exported = createDesignNetlistExport(project, { format: "spice" });
  expect(exported.diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: "REVIEWED_SIZE_OUT_OF_RANGE",
        objectIds: ["M1"],
      }),
      expect.objectContaining({
        code: "REVIEWED_PARAMETER_OUT_OF_RANGE",
        objectIds: ["Q1"],
      }),
    ]),
  );
  expect(
    exported.diagnostics
      .filter((d) => d.code === "REVIEWED_PARAMETER_OUT_OF_RANGE")
      .map((d) => d.parameter),
  ).toEqual(expect.arrayContaining(["we", "Nx"]));
  expect(project).toEqual(before);
});

it.each(["nmos", "pmos"] as const)(
  "offers only measured PSP operating-point fields on the actual %s OSDI instance",
  (polarity) => {
    const project = createEmptyProject("sg13", "SG13", "dut");
    const document = project.documents[0]!;
    project.externalSubcircuitDefinitions.push({
      id: "nmos",
      name: `sg13_lv_${polarity}`,
      interfaceStatus: "declared",
      terminals: ["d", "g", "s", "b"].map((name) => ({
        id: name,
        name,
        direction: "passive",
      })),
      formalParameters: [],
    });
    document.instances.push({
      id: "m",
      reference: "M1",
      symbolId: polarity,
      placement: null,
      netlist: {
        binding: { kind: "external-subcircuit", definitionId: "nmos" },
        parameters: { w: "1u", l: "0.5u", ng: "2", m: "3" },
      },
    });
    document.noConnects.push(
      ...["D", "G", "S", "B"].map((pinName) => ({
        id: pinName,
        endpoint: { kind: "terminal" as const, instanceId: "m", pinName },
      })),
    );
    const folder = createSimulationFolder({
      id: "f",
      name: "Bias",
      profileId: "sg13",
      engine: "ngspice",
      documentId: document.id,
    });
    const [device] = ngspiceSimulationDevices(project, folder.input);
    expect(device!.nativeDevice).toBe(`n.xm1.nsg13_lv_${polarity}`);
    expect(nativeDeviceOpVectors(device!)).toEqual([
      `@n.xm1.nsg13_lv_${polarity}[ide]`,
      `@n.xm1.nsg13_lv_${polarity}[vgs]`,
      `@n.xm1.nsg13_lv_${polarity}[vds]`,
    ]);
    if (polarity === "pmos")
      expect(
        nativeTerminalCurrent({ ...device!, reference: "xdut.xm1" }, "D").ok,
      ).toBe(false);
    const compiled = compileNgspiceSourceSimulation(project, folder);
    expect(compiled.ok, JSON.stringify(compiled)).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.generated[0]!.text).toContain(
      `sg13_lv_${polarity} w=1u l=0.5u ng=2 m=3`,
    );
    expect(
      compiled.deviceOperatingPoints[0]!.values.map((v) => v.parameter),
    ).toEqual(["id", "vgs", "vds"]);
  },
);
