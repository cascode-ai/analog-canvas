import { describe, expect, it, vi } from "vitest";
import {
  createEmptyProject,
  createSimulationFolder,
  CircuitProjectSchema,
} from "../packages/model/src/index.js";
import { SimulationService } from "../packages/simulation-service/src/service.js";
import { SimulationFiles } from "../packages/simulation-service/src/files.js";
import { CapabilitiesSchema } from "../packages/simulation-service/src/contract.js";

const caps = CapabilitiesSchema.parse({
  configured: true,
  rawfileCollection: "native-multi-ascii",
  maxInputFiles: 24,
  inputs: ["source"],
  analyses: ["op", "dc", "ac", "tran", "noise"],
  parsedAnalyses: ["op", "dc", "ac", "tran", "noise"],
  profiles: [{ id: "local-proof", corners: [] }],
  maxTimeoutMs: 15_000,
  maxInputBytes: 1_048_576,
  maxOutputBytes: 1_048_576,
  cancel: false,
});
function fixture() {
  const project = createEmptyProject(
    "native-project",
    "Public native proof",
    "dut",
  );
  const document = project.documents[0];
  document.netlist.name = "DUT";
  document.instances.push(
    { id: "P", symbolId: "port", placement: null },
    { id: "N", symbolId: "port", placement: null },
    {
      id: "R",
      symbolId: "resistor",
      reference: "R1",
      placement: null,
      netlist: {
        binding: { kind: "primitive", deviceClass: "resistor" },
        parameters: { value: "1k" },
      },
    },
  );
  for (const [name, pin] of [
    ["P", "1"],
    ["N", "2"],
  ]) {
    document.nets.push({
      id: `net-${name}`,
      terminals: [
        { instanceId: name, pinName: "P" },
        { instanceId: "R", pinName: pin },
      ],
    });
    document.netlist.terminals.push({
      id: name,
      name,
      netId: `net-${name}`,
      direction: "passive",
      interfaceInstanceIds: [name],
    });
  }
  const folder = createSimulationFolder({
    id: "experiment",
    name: "Native",
    profileId: "local-proof",
  });
  folder.input.entry = "run.sim";
  folder.input.circuitBindings = [
    {
      id: "binding",
      documentId: "dut",
      emission: "subcircuit",
      path: "DUT.inc",
    },
  ];
  folder.input.files = [
    {
      path: "experiment.json",
      text: JSON.stringify({
        version: 2,
        environment: { profileId: "local-proof" },
      }),
    },
    {
      path: "run.sim",
      text: `Public native service proof
include "DUT.inc"
load "capacitor.osdi"
model voltage vsource
model load resistor
model cap capacitor
V1 (Input 0) voltage dc=1 mag=1
XD (Input Out) DUT
RL (Out 0) load r=1k
C (Out 0) cap c=1u
control
abort always
options rawfile="ascii" strictsave=2
save default
analysis bias op
sweep supply instance="V1" parameter="dc" from=0 to=2 step=1
analysis sweep op
analysis frequency ac from=10 to=1k mode="dec" points=2 writeop=1
analysis time tran stop=1m step=0.1m
analysis noise noise out="Out" in="V1" from=10 to=1k mode="dec" points=2
endc
`,
    },
  ];
  project.simulationFolders.push(folder);
  return CircuitProjectSchema.parse(project);
}
function requireReply(reply, key) {
  if (!reply.ok || !(key in reply)) throw Error(JSON.stringify(reply));
  return reply[key];
}

describe("native public compilation", () => {
  it("prepares native source and Canvas signal addresses without executing or changing the Project", async () => {
    const project = fixture();
    const before = structuredClone(project);
    const execute = vi.fn();
    const service = new SimulationService(
      new SimulationFiles(),
      { capabilities: async () => caps, execute, cancel: vi.fn() },
      () => project,
    );
    const prepared = requireReply(
      await service.handle(
        {
          operation: "prepare",
          source: {
            kind: "project-folder",
            folderId: "experiment",
            expectedStructureRevision: project.structureRevision,
          },
        },
        "prepare",
      ),
      "prepared",
    );
    expect(prepared.signalNames).toEqual({ Input: "XD/P", Out: "XD/N" });
    expect(prepared.signalTargets.Out).toEqual([
      {
        rootDocumentId: "dut",
        documentId: "dut",
        netId: "net-N",
        occurrence: [],
      },
    ]);
    expect(execute).not.toHaveBeenCalled();
    expect(project).toEqual(before);
  });
});
