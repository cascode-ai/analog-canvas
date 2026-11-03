import profile from "../../../containers/ngspice/sg13g2/profile.json" with { type: "json" };
import { createEmptyProject, createSimulationFolder } from "@icm/model";
import { createExternalSubcircuitInstance } from "../../edit-engine/src/hierarchy-planner.js";

/** Independently wired Canvas devices and a gate; reference.spice is hand-authored. */
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
    {
      ref: "MHN",
      master: "sg13_hv_nmos",
      formals: ["d", "g", "s", "b"],
      pins: { D: "hvout", G: "hvin", S: "VSS", B: "sub" },
      parameters: { w: "2u", l: "1u", ng: "2", m: "3" },
    },
    {
      ref: "MHP",
      master: "sg13_hv_pmos",
      formals: ["d", "g", "s", "b"],
      pins: { D: "hvout", G: "hvin", S: "vh", B: "vh" },
      parameters: { w: "4u", l: "1u", ng: "2", m: "1" },
    },
    {
      ref: "QL",
      master: "npn13G2l",
      formals: ["c", "b", "e", "bn"],
      pins: { C: "cl", B: "base", E: "VSS", S: "sub" },
      parameters: { le: "1u", we: "70n", Nx: "2" },
    },
    {
      ref: "QV",
      master: "npn13G2v",
      formals: ["c", "b", "e", "bn"],
      pins: { C: "cv", B: "base", E: "VSS", S: "sub" },
      parameters: { le: "1u", we: "120n", Nx: "3" },
    },
    {
      ref: "QP",
      master: "pnpMPA",
      formals: ["c", "b", "e"],
      pins: { C: "pc", B: "pb", E: "vdd" },
      parameters: { a: "1.44p", p: "5.4u", m: "2" },
    },
    {
      ref: "CRF",
      master: "cap_rfcmim",
      formals: ["PLUS", "MINUS", "bn"],
      pins: { "1": "hvout", "2": "VSS", B: "sub" },
      parameters: { w: "10u", l: "10u", wfeed: "5u", m: "2" },
    },
    {
      ref: "X1",
      master: "sg13g2_nand2_1",
      formals: ["Y", "A", "B", "VDD", "VSS"],
      pins: { Y: "gateout", A: "in", B: "in", VDD: "vdd", VSS: "VSS" },
      parameters: {},
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
    "hvout",
    "hvin",
    "vh",
    "cl",
    "cv",
    "pc",
    "pb",
    "gateout",
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
    name: "SG13G2",
    profileId: profile.id,
    engine: "ngspice",
    documentId: document.id,
  });
  folder.input.dependencies.push({
    id: profile.models.id,
    sha256: profile.models.contentSha256,
    mountPath: "sg13.lib",
  });
  folder.input.circuitBindings[0]!.emission = "subcircuit";
  const entry = folder.input.files.find(
    (file) => file.path === folder.input.entry,
  )!;
  entry.text = `SG13G2 acceptance
.lib "sg13.lib" mos-fs_hbt-bcs_res-wcs_cap-bcs
.include "circuit.spice"
XDUT vdd 0 out in sub rs rh collector base hvout hvin vh cl cv pc pb gateout DUT
VDD vdd 0 1.2
VIN in 0 dc 0.6 ac 1 pulse(0 1.2 1n 20p 20p 4n 8n)
VSUB sub 0 -0.1
VRS rs 0 0.1
VRH rh 0 0.1
VC collector 0 0.8
VB base 0 0.7
VHV vh 0 3.3
VGH hvin 0 dc 1.65 ac 0.5 pulse(0 3.3 1n 20p 20p 4n 8n)
VCL cl 0 0.8
VCV cv 0 0.8
VPC pc 0 0.3
VPB pb 0 0.5
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
