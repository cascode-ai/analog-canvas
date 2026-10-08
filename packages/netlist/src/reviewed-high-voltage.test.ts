import { createEmptyProject, createSimulationFolder } from "@icm/model";
import { expect, it } from "vitest";

import { createDesignNetlistExport } from "./export.js";
import { ngspiceSimulationDevices } from "./simulation-ngspice-devices.js";

/** Two DMOS devices bound to SKY130's 16 V and 20 V wrappers. */
function highVoltageProject() {
  const project = createEmptyProject("project", "High voltage", "dut");
  const document = project.documents[0]!;
  const devices = [
    {
      id: "XM1",
      symbolId: "ndmos",
      master: "sky130_fd_pr__nfet_g5v0d16v0",
      parameters: { w: "5u", l: "700n", nf: "1", m: "1" },
    },
    {
      id: "XM2",
      symbolId: "pdmos",
      master: "sky130_fd_pr__pfet_20v0",
      parameters: { m: "2" },
    },
  ] as const;
  for (const device of devices) {
    const definitionId = `definition-${device.id}`;
    project.externalSubcircuitDefinitions.push({
      id: definitionId,
      name: device.master,
      interfaceStatus: "declared",
      terminals: ["D", "G", "S", "B"].map((name) => ({
        id: `${definitionId}-${name}`,
        name,
        direction: "passive" as const,
      })),
      formalParameters: [],
    });
    document.instances.push({
      id: device.id,
      reference: device.id,
      symbolId: device.symbolId,
      placement: null,
      netlist: {
        binding: { kind: "external-subcircuit", definitionId },
        parameters: { ...device.parameters },
      },
    });
    document.noConnects.push(
      ...["D", "G", "S", "B"].map((pinName) => ({
        id: `${device.id}-${pinName}`,
        endpoint: {
          kind: "terminal" as const,
          instanceId: device.id,
          pinName,
        },
      })),
    );
  }
  const folder = createSimulationFolder({
    id: "simulation",
    name: "Simulation",
    profileId: "sky130-test",
    engine: "ngspice",
    documentId: document.id,
  });
  return { project, folder };
}

it("warns that a 16 V device at a size SKY130 does not model cannot run (#1483)", () => {
  // XM1 (ndmos) or XM2 (pdmos) on a 16 V device with these parameters.
  const sized = (
    device: 0 | 1,
    master: string,
    parameters: Record<string, string>,
  ) => {
    const { project } = highVoltageProject();
    project.externalSubcircuitDefinitions[device]!.name = master;
    project.documents[0]!.instances[device]!.netlist!.parameters = parameters;
    const exported = createDesignNetlistExport(project, { format: "spice" });
    return {
      status: exported.status,
      findings: exported.diagnostics.filter(
        (diagnostic) => diagnostic.code === "REVIEWED_SIZE_UNMODELLED",
      ),
    };
  };
  const nfet = "sky130_fd_pr__nfet_g5v0d16v0";
  const pfet = "sky130_fd_pr__pfet_g5v0d16v0";
  // W 5 µm and W 55 µm at L 0.7 µm are among the N models.
  expect(sized(0, nfet, { w: "5u", l: "700n" }).findings).toEqual([]);
  expect(sized(0, nfet, { w: "55u", l: "700n" }).findings).toEqual([]);
  // These are not, and ngspice stops there; a missing W is the wrapper's 5 µm.
  for (const [device, master, parameters, reference, size, sizes] of [
    [0, nfet, { w: "1u", l: "150n" }, "XM1", "W 1 µm, L 0.15 µm", "N"],
    [0, nfet, { w: "5u", l: "1u" }, "XM1", "W 5 µm, L 1 µm", "N"],
    [0, nfet, { l: "150n" }, "XM1", "W 5 µm, L 0.15 µm", "N"],
    [1, pfet, { w: "60u", l: "660n" }, "XM2", "W 60 µm, L 0.66 µm", "P"],
  ] as const) {
    const { status, findings } = sized(device, master, parameters);
    expect(status).toBe("ready");
    expect(findings).toEqual([
      expect.objectContaining({
        severity: "warning",
        objectIds: [reference],
        message: expect.stringContaining(`${reference} is ${size}`),
      }),
    ]);
    expect(findings[0]!.message).toContain(
      sizes === "N"
        ? "W 5, 20 or 50–60 µm at L 0.7 µm, or W 5 or 20 µm at L 2.2 µm"
        : "W 5–50 µm at L 0.66 or 2.16 µm",
    );
  }
});

it("prints SKY130's high-voltage wrappers and probes the MOSFET each one holds", () => {
  const { project, folder } = highVoltageProject();
  const exported = createDesignNetlistExport(project, { format: "spice" });
  expect(exported.status, JSON.stringify(exported.diagnostics)).toBe("ready");
  if (exported.status !== "ready") return;
  // 16 V takes binned plain-micrometre geometry; 20 V fixes its channel
  // inside the wrapper and takes only the parallel count.
  expect(exported.file.text).toMatch(
    /^XM1 \S+ \S+ \S+ \S+ sky130_fd_pr__nfet_g5v0d16v0 l=0\.7 w=5 nf=1 m=1$/mu,
  );
  expect(exported.file.text).toMatch(
    /^XM2 \S+ \S+ \S+ \S+ sky130_fd_pr__pfet_20v0 m=2$/mu,
  );
  // Operating points read the MOSFET inside: nested one level down at 16 V,
  // named m1 at 20 V (both checked against the SKY130 wrappers in ngspice 46).
  const devices = ngspiceSimulationDevices(project, folder.input);
  expect(
    devices.find((device) => device.instanceId === "XM1")?.nativeDevice,
  ).toBe("m.xm1.xmain1.msky130_fd_pr__nfet_g5v0d16v0__base");
  expect(
    devices.find((device) => device.instanceId === "XM2")?.nativeDevice,
  ).toBe("m.xm2.m1");
});
