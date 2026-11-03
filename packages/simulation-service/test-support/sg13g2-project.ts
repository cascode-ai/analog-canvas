import { createEmptyProject, createSimulationFolder } from "@icm/model";
import { createExternalSubcircuitInstance } from "../../edit-engine/src/hierarchy-planner.js";
import profile from "../../../containers/ngspice/sg13g2/profile.json" with { type: "json" };

/** Seven independently wired Canvas devices; reference.spice is hand-authored. */
export function sg13g2Project() {
  const project = createEmptyProject(
    "sg13-acceptance",
    "SG13G2 acceptance",
    "dut",
  );
  const document = project.documents[0]!;
  document.netlist!.name = "DUT";
  const nets = new Map<string, { instanceId: string; pinName: string }[]>();
  const devices = [
    {
      ref: "MN",
      master: "sg13_lv_nmos",
      formals: ["d", "g", "s", "b"],
      pins: { D: "out", G: "in", S: "VSS", B: "sub" },
      parameters: { w: "2u", l: "500n", ng: "2", m: "3" },
    },
    {
      ref: "MP",
      master: "sg13_lv_pmos",
      formals: ["d", "g", "s", "b"],
      pins: { D: "out", G: "in", S: "vdd", B: "vdd" },
      parameters: { w: "4u", l: "500n", ng: "2", m: "1" },
    },
    {
      ref: "R1",
      master: "rsil",
      formals: ["1", "2", "bn"],
      pins: { "1": "rs", "2": "VSS", B: "sub" },
      parameters: { w: "1u", l: "10u", m: "2" },
    },
    {
      ref: "R2",
      master: "rppd",
      formals: ["1", "2", "bn"],
      pins: { "1": "out", "2": "VSS", B: "sub" },
      parameters: { w: "1u", l: "10u", b: "1", m: "1" },
    },
    {
      ref: "R3",
      master: "rhigh",
      formals: ["1", "2", "bn"],
      pins: { "1": "rh", "2": "VSS", B: "sub" },
      parameters: { w: "1u", l: "10u", b: "0", m: "2" },
    },
    {
      ref: "C1",
      master: "cap_cmim",
      formals: ["PLUS", "MINUS"],
      pins: { "1": "out", "2": "VSS" },
      parameters: { w: "7u", l: "7u", m: "2" },
    },
    {
      ref: "Q1",
      master: "npn13G2",
      formals: ["c", "b", "e", "bn"],
      pins: { C: "collector", B: "base", E: "VSS", S: "sub" },
      parameters: { le: "900n", we: "70n", Nx: "2" },
    },
  ];
  for (const [index, device] of devices.entries()) {
    const definition = {
      id: device.master,
      name: device.master,
      interfaceStatus: "declared" as const,
      terminals: device.formals.map((name) => ({
        id: `${device.master}-${name}`,
        name,
        direction: "passive" as const,
      })),
      formalParameters: [],
    };
    project.externalSubcircuitDefinitions.push(definition);
    const instance = createExternalSubcircuitInstance(
      device.ref,
      definition,
      {
        position: { x: 200 + index * 140, y: 200 },
        rotation: 0,
        mirror: "none",
      },
      device.ref,
    );
    instance.netlist!.parameters = Object.fromEntries(
      Object.entries(device.parameters).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
    document.instances.push(instance);
    for (const [pinName, net] of Object.entries(device.pins)) {
      if (!net) continue;
      nets.set(net, [
        ...(nets.get(net) ?? []),
        { instanceId: device.ref, pinName },
      ]);
    }
  }
  for (const name of [
    "out",
    "in",
    "vdd",
    "sub",
    "rs",
    "rh",
    "collector",
    "base",
    "VSS",
  ]) {
    document.instances.push({
      id: `port-${name}`,
      symbolId: "port",
      placement: null,
    });
    document.nets.push({
      id: name,
      terminals: [
        ...nets.get(name)!,
        { instanceId: `port-${name}`, pinName: "P" },
      ],
    });
    document.netlist!.terminals.push({
      id: name,
      name,
      netId: name,
      direction: "passive",
      interfaceInstanceIds: [`port-${name}`],
    });
  }
  const folder = createSimulationFolder({
    id: "bias",
    name: "SG13 nominal",
    profileId: profile.id,
    engine: "ngspice",
    documentId: document.id,
  });
  folder.input.circuitBindings[0]!.emission = "subcircuit";
  const entry = folder.input.files.find(
    (file) => file.path === folder.input.entry,
  )!;
  entry.text = `SG13G2 seven-device acceptance
.include "circuit.spice"
XDUT vdd 0 out in sub rs rh collector base DUT
VDD vdd 0 1.2
VIN in 0 dc 0.6 ac 1 pulse(0 1.2 1n 20p 20p 4n 8n)
VSUB sub 0 -0.1
VRS rs 0 0.1
VRH rh 0 0.1
VC collector 0 0.8
VB base 0 0.7
.control
op
write result.raw all
quit
.endc
.end
`;
  project.simulationFolders = [folder];
  return { project, folder, entry };
}
