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
