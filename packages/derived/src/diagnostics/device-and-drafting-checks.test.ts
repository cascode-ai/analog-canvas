import {
  createEmptyProject,
  createSimulationFolder,
  type CircuitProject,
} from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { buildCommittedProjectConnectivityIndex } from "../connectivity-index.js";
import { resolveEndpointPoint } from "../endpoint.js";
import { runErcChecks } from "./erc.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function runErc(project: CircuitProject) {
  return runErcChecks(
    project,
    buildCommittedProjectConnectivityIndex(project, resolver),
    resolver,
  );
}

describe("device integrity ERC checks (#2612)", () => {
  it("flags MOSFET G == D == S short while keeping MOSCAPs, MOS varactors, gated diodes, dummy switches, and 4-pin dummies quiet", () => {
    const project = createEmptyProject("mos-short", "MOS Short");
    const doc = project.documents[0]!;
    doc.instances.push(
      {
        id: "M1",
        symbolId: "nmos",
        reference: "M1",
        placement: {
          position: { x: 100, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        id: "MCAP",
        symbolId: "nmos",
        reference: "M2",
        placement: {
          position: { x: 240, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        id: "MDUM",
        symbolId: "nmos",
        reference: "M3",
        placement: {
          position: { x: 380, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        id: "MVAR",
        symbolId: "nmos",
        reference: "M4",
        placement: {
          position: { x: 520, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        id: "MDIODE",
        symbolId: "pmos",
        reference: "MD0",
        placement: {
          position: { x: 660, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      },
    );
    doc.nets.push(
      {
        id: "net-sig",
        terminals: [
          { instanceId: "M1", pinName: "G" },
          { instanceId: "M1", pinName: "D" },
          { instanceId: "M1", pinName: "S" },
          { instanceId: "MVAR", pinName: "D" },
          { instanceId: "MVAR", pinName: "S" },
          { instanceId: "MDIODE", pinName: "D" },
          { instanceId: "MDIODE", pinName: "S" },
        ],
      },
      {
        id: "net-gate",
        terminals: [
          { instanceId: "MCAP", pinName: "G" },
          { instanceId: "MVAR", pinName: "G" },
        ],
      },
      {
        id: "net-vdd",
        terminals: [
          { instanceId: "MDIODE", pinName: "G" },
          { instanceId: "MDIODE", pinName: "B" },
        ],
      },
      {
        id: "net-vss",
        terminals: [
          { instanceId: "M1", pinName: "B" },
          { instanceId: "MVAR", pinName: "B" },
          { instanceId: "MCAP", pinName: "D" },
          { instanceId: "MCAP", pinName: "S" },
          { instanceId: "MCAP", pinName: "B" },
          { instanceId: "MDUM", pinName: "G" },
          { instanceId: "MDUM", pinName: "D" },
          { instanceId: "MDUM", pinName: "S" },
          { instanceId: "MDUM", pinName: "B" },
        ],
      },
    );

    const hits = runErc(project).filter(
      (item) => item.code === "ERC_SHORTED_TRANSISTOR",
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      code: "ERC_SHORTED_TRANSISTOR",
      severity: "warning",
      gateEligible: false,
      primary: { kind: "instance", objectId: "M1" },
    });
    expect(hits[0]!.message).toContain("on one Net");
    expect(hits[0]!.message).not.toContain("on Net while");
  });

  it("flags BJT collector-emitter short but stays quiet for a diode-connected BJT (B == C)", () => {
    const project = createEmptyProject("bjt-short", "BJT Short");
    const doc = project.documents[0]!;
    doc.instances.push(
      {
        id: "Q1",
        symbolId: "npn",
        reference: "Q1",
        placement: {
          position: { x: 100, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        id: "Q2",
        symbolId: "npn",
        reference: "Q2",
        placement: {
          position: { x: 240, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      },
    );
    doc.nets.push(
      {
        id: "net-ce",
        terminals: [
          { instanceId: "Q1", pinName: "C" },
          { instanceId: "Q1", pinName: "E" },
        ],
      },
      {
        id: "net-b1",
        terminals: [{ instanceId: "Q1", pinName: "B" }],
      },
      {
        id: "net-bc",
        terminals: [
          { instanceId: "Q2", pinName: "B" },
          { instanceId: "Q2", pinName: "C" },
        ],
      },
      {
        id: "net-e2",
        terminals: [{ instanceId: "Q2", pinName: "E" }],
      },
    );

    const hits = runErc(project).filter(
      (item) => item.code === "ERC_SHORTED_TRANSISTOR",
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]!.primary.objectId).toBe("Q1");
  });

  it("flags two instances stacked at identical coordinates with overlapping pins", () => {
    const project = createEmptyProject("stacked", "Stacked");
    const doc = project.documents[0]!;
    doc.instances.push(
      {
        id: "M1",
        symbolId: "nmos",
        reference: "M1",
        placement: {
          position: { x: 200, y: 200 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        id: "M8",
        symbolId: "nmos",
        reference: "M8",
        placement: {
          position: { x: 200, y: 200 },
          rotation: 0,
          mirror: "none",
        },
      },
    );

    const hits = runErc(project).filter(
      (item) => item.code === "ERC_STACKED_INSTANCE",
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      code: "ERC_STACKED_INSTANCE",
      severity: "warning",
      gateEligible: false,
      parameters: { instanceId: "M1", otherInstanceId: "M8", x: 200, y: 200 },
    });
  });

  it("flags unresolved {PARAM} references and clears them when declared as formal parameter or .param", () => {
    const project = createEmptyProject("params", "Params");
    const doc = project.documents[0]!;
    doc.instances.push(
      {
        id: "R1",
        symbolId: "resistor",
        reference: "R1",
        placement: {
          position: { x: 100, y: 100 },
          rotation: 0,
          mirror: "none",
        },
        netlist: { parameters: { value: "{TEACH_ROUT}" } },
      },
      {
        id: "C1",
        symbolId: "capacitor",
        reference: "C1",
        placement: {
          position: { x: 240, y: 100 },
          rotation: 0,
          mirror: "none",
        },
        netlist: { parameters: { value: "{Cc * 2 + pi}" } },
      },
      {
        id: "R2",
        symbolId: "resistor",
        reference: "R2",
        placement: {
          position: { x: 380, y: 100 },
          rotation: 0,
          mirror: "none",
        },
        netlist: { parameters: { value: "{RFB}" } },
      },
    );
    doc.netlist = {
      name: "top",
      terminals: [],
      formalParameters: [{ name: "RFB", defaultValue: "10k" }],
    };
    const folder = createSimulationFolder({
      id: "tb",
      name: "TB",
      profileId: "hosted-sky130-ngspice-v1",
      documentId: doc.id,
    });
    folder.input.files.find((f) => f.path === folder.input.entry)!.text +=
      "\n.param Cc=1p\n";
    project.simulationFolders = [folder];

    const hits = runErc(project).filter(
      (item) => item.code === "ERC_UNRESOLVED_PARAMETER",
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      code: "ERC_UNRESOLVED_PARAMETER",
      severity: "warning",
      gateEligible: false,
      primary: { kind: "instance", objectId: "R1" },
      parameters: {
        instanceId: "R1",
        parameter: "value",
        unresolved: "TEACH_ROUT",
      },
    });
  });
});

describe("drafting imitation and custom supply ERC checks (#2613)", () => {
  it("flags a drafting line bridging distinct electrical pins and free signal text near an unnamed pin", () => {
    const project = createEmptyProject("drafting-erc", "Drafting ERC");
    const doc = project.documents[0]!;
    doc.instances.push(
      {
        id: "R1",
        symbolId: "resistor",
        reference: "R1",
        placement: {
          position: { x: 100, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        id: "R2",
        symbolId: "resistor",
        reference: "R2",
        placement: {
          position: { x: 260, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      },
    );
    const r1Pin2 = resolveEndpointPoint(doc, resolver, {
      kind: "terminal",
      instanceId: "R1",
      pinName: "2",
    })!;
    const r2Pin1 = resolveEndpointPoint(doc, resolver, {
      kind: "terminal",
      instanceId: "R2",
      pinName: "1",
    })!;
    const r2Pin2 = resolveEndpointPoint(doc, resolver, {
      kind: "terminal",
      instanceId: "R2",
      pinName: "2",
    })!;
    doc.drafting = {
      objects: [
        {
          id: "fake-wire",
          kind: "construction-line",
          zIndex: 0,
          anchor: { kind: "free", position: r1Pin2 },
          points: [r1Pin2, r2Pin1],
          lineStyle: "solid",
          locked: false,
        },
        {
          id: "fake-port-text",
          kind: "text",
          zIndex: 1,
          anchor: {
            kind: "free",
            position: { x: r2Pin2.x + 8, y: r2Pin2.y },
          },
          content: { runs: [{ kind: "text", value: "Vout+" }] },
          alignment: "start",
          rotation: 0,
          locked: false,
        },
        {
          id: "harmless-note",
          kind: "text",
          zIndex: 2,
          anchor: {
            kind: "free",
            position: { x: r2Pin2.x + 8, y: r2Pin2.y + 40 },
          },
          content: { runs: [{ kind: "text", value: "Stage 1" }] },
          alignment: "start",
          rotation: 0,
          locked: false,
        },
      ],
    };

    const diagnostics = runErc(project);
    expect(
      diagnostics
        .filter((item) => item.code === "ERC_DRAFTING_WIRE_IMITATION")
        .map((item) => item.parameters.draftingObjectId),
    ).toEqual(["fake-wire"]);
    expect(
      diagnostics
        .filter((item) => item.code === "ERC_DRAFTING_PORT_LABEL")
        .map((item) => item.parameters.draftingObjectId),
    ).toEqual(["fake-port-text"]);
  });

  it("flags floating custom supply rails (PVDD/SAP) feeding multiple MOS sources/bulks, but stays quiet once a formal Port or source drives them", () => {
    const project = createEmptyProject("custom-supply", "Custom Supply");
    const doc = project.documents[0]!;
    doc.instances.push(
      {
        id: "M1",
        symbolId: "pmos",
        reference: "M1",
        placement: {
          position: { x: 100, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        id: "M2",
        symbolId: "pmos",
        reference: "M2",
        placement: {
          position: { x: 240, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      },
    );
    doc.nets.push({
      id: "net-pvdd",
      terminals: [
        { instanceId: "M1", pinName: "S" },
        { instanceId: "M1", pinName: "B" },
        { instanceId: "M2", pinName: "S" },
        { instanceId: "M2", pinName: "B" },
      ],
    });
    doc.connectivityEvidence.push({
      id: "claim-pvdd",
      kind: "name-claim",
      netId: "net-pvdd",
      name: "PVDD",
      scope: "local",
      owner: { kind: "net-label", annotationId: "label-pvdd" },
    });

    const floatingHits = runErc(project).filter(
      (item) => item.code === "ERC_FLOATING_CUSTOM_SUPPLY",
    );
    expect(floatingHits).toHaveLength(1);
    expect(floatingHits[0]).toMatchObject({
      code: "ERC_FLOATING_CUSTOM_SUPPLY",
      severity: "warning",
      gateEligible: false,
      parameters: { netName: "PVDD", mosSourceOrBulkCount: 4 },
    });

    // Adding a formal Cell terminal for PVDD clears the warning.
    doc.netlist = {
      name: "top",
      terminals: [
        {
          id: "term-pvdd",
          name: "PVDD",
          netId: "net-pvdd",
          direction: "inout",
          interfaceInstanceIds: ["P_PVDD"],
        },
      ],
      formalParameters: [],
    };
    expect(
      runErc(project).filter(
        (item) => item.code === "ERC_FLOATING_CUSTOM_SUPPLY",
      ),
    ).toEqual([]);
  });

  it("flags output, input, and clock Net Labels without a formal Port (#2557) and clears them once a Port is declared", () => {
    const project = createEmptyProject("io-no-port", "IO Without Port");
    const doc = project.documents[0]!;
    doc.instances.push(
      {
        id: "M1",
        symbolId: "pmos",
        reference: "M1",
        placement: {
          position: { x: 100, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        id: "M2",
        symbolId: "nmos",
        reference: "M2",
        placement: {
          position: { x: 100, y: 240 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        id: "R1",
        symbolId: "resistor",
        reference: "R1",
        placement: {
          position: { x: 260, y: 170 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        id: "S1",
        symbolId: "switch-ctrl",
        reference: "S1",
        placement: {
          position: { x: 400, y: 170 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        id: "S2",
        symbolId: "switch-ctrl",
        reference: "S2",
        placement: {
          position: { x: 520, y: 170 },
          rotation: 0,
          mirror: "none",
        },
      },
    );
    doc.nets.push(
      {
        id: "net-vin",
        terminals: [
          { instanceId: "M1", pinName: "G" },
          { instanceId: "M2", pinName: "G" },
          { instanceId: "R1", pinName: "1" },
        ],
      },
      {
        id: "net-vout",
        terminals: [
          { instanceId: "M1", pinName: "D" },
          { instanceId: "M2", pinName: "D" },
        ],
      },
      {
        id: "net-phi",
        terminals: [
          { instanceId: "S1", pinName: "CTRL" },
          { instanceId: "S2", pinName: "CTRL" },
        ],
      },
      {
        id: "net-mid",
        terminals: [
          { instanceId: "R1", pinName: "2" },
          { instanceId: "S1", pinName: "1" },
        ],
      },
    );
    doc.connectivityEvidence.push(
      {
        id: "claim-vin",
        kind: "name-claim",
        netId: "net-vin",
        name: "Vin",
        scope: "local",
        owner: { kind: "net-label", annotationId: "label-vin" },
      },
      {
        id: "claim-vout",
        kind: "name-claim",
        netId: "net-vout",
        name: "Vout+",
        scope: "local",
        owner: { kind: "net-label", annotationId: "label-vout" },
      },
      {
        id: "claim-phi",
        kind: "name-claim",
        netId: "net-phi",
        name: "Φ1",
        scope: "local",
        owner: { kind: "net-label", annotationId: "label-phi" },
      },
      {
        id: "claim-mid",
        kind: "name-claim",
        netId: "net-mid",
        name: "mid",
        scope: "local",
        owner: { kind: "net-label", annotationId: "label-mid" },
      },
    );

    const hits = runErc(project).filter(
      (item) => item.code === "ERC_IO_LABEL_WITHOUT_PORT",
    );
    expect(hits.map((item) => item.parameters.netName).sort()).toEqual([
      "Vin",
      "Vout+",
      "Φ1",
    ]);
    expect(hits.every((item) => item.severity === "warning")).toBe(true);
    expect(hits.every((item) => item.gateEligible === false)).toBe(true);

    // Declaring formal Cell terminals clears the warnings.
    doc.netlist = {
      name: "top",
      terminals: [
        {
          id: "term-vin",
          name: "Vin",
          netId: "net-vin",
          direction: "input",
          interfaceInstanceIds: ["P_VIN"],
        },
        {
          id: "term-vout",
          name: "Vout+",
          netId: "net-vout",
          direction: "output",
          interfaceInstanceIds: ["P_VOUT"],
        },
        {
          id: "term-phi",
          name: "Φ1",
          netId: "net-phi",
          direction: "input",
          interfaceInstanceIds: ["P_PHI"],
        },
      ],
      formalParameters: [],
    };
    expect(
      runErc(project).filter(
        (item) => item.code === "ERC_IO_LABEL_WITHOUT_PORT",
      ),
    ).toEqual([]);
  });

  it("stays quiet on portless testbenches with an independent voltage source (#2557)", () => {
    const project = createEmptyProject("tb-rc", "RC Testbench");
    const doc = project.documents[0]!;
    doc.instances.push(
      {
        id: "V1",
        symbolId: "voltage-source",
        reference: "V1",
        placement: {
          position: { x: 100, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        id: "R1",
        symbolId: "resistor",
        reference: "R1",
        placement: {
          position: { x: 220, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        id: "C1",
        symbolId: "capacitor",
        reference: "C1",
        placement: {
          position: { x: 340, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      },
    );
    doc.nets.push(
      {
        id: "net-in",
        terminals: [
          { instanceId: "V1", pinName: "pos" },
          { instanceId: "R1", pinName: "1" },
        ],
      },
      {
        id: "net-out",
        terminals: [
          { instanceId: "R1", pinName: "2" },
          { instanceId: "C1", pinName: "1" },
        ],
      },
      {
        id: "net-gnd",
        terminals: [
          { instanceId: "V1", pinName: "neg" },
          { instanceId: "C1", pinName: "2" },
        ],
      },
    );
    doc.connectivityEvidence.push(
      {
        id: "claim-in",
        kind: "name-claim",
        netId: "net-in",
        name: "Vin",
        scope: "local",
        owner: { kind: "net-label", annotationId: "label-in" },
      },
      {
        id: "claim-out",
        kind: "name-claim",
        netId: "net-out",
        name: "Vout",
        scope: "local",
        owner: { kind: "net-label", annotationId: "label-out" },
      },
    );

    expect(
      runErc(project).filter(
        (item) => item.code === "ERC_IO_LABEL_WITHOUT_PORT",
      ),
    ).toEqual([]);
  });
});
