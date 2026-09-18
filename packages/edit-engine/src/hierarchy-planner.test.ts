import { createRoutePath } from "@icm/model";
import { describe, expect, it } from "vitest";

import { createEmptyDocument, createEmptyProject } from "@icm/model";

import {
  createExternalSubcircuitInstance,
  createHierarchyInstance,
  planCreateCellPin,
  planDeleteCell,
  planPlaceCellInstance,
  planRemoveCellTerminal,
  planReorderCellPort,
  planReorderCellTerminal,
  planRenameCellTerminal,
  planSetDeviceModelTarget,
  planSetMosModelTarget,
  planSetVddConnectionMode,
  planUpdateCellPortDirection,
} from "./hierarchy-planner.js";
import { executeProjectTransaction } from "./project-transaction.js";

describe("hierarchy domain planners", () => {
  it("rejects deleting a referenced Cell before Project commit", () => {
    const project = createEmptyProject("project", "Project", "top");
    const child = createEmptyDocument("child", "Child");
    project.documents.push(child);
    project.documents[0]!.instances.push(
      createHierarchyInstance("X1", child, {
        position: { x: 0, y: 0 },
        rotation: 0,
        mirror: "none",
      }),
    );

    expect(() => planDeleteCell(project, child.id)).toThrow(
      "Cell child is still referenced by top.X1",
    );
  });

  it("constructs one canonical caller from the child interface", () => {
    const child = createEmptyDocument("child", "Stage");
    child.netlist!.terminals.push({
      id: "terminal-in",
      name: "IN",
      netId: "net-in",
      direction: "input",
      interfaceInstanceIds: ["P1"],
    });

    expect(
      createHierarchyInstance("X1", child, {
        position: { x: 100, y: 80 },
        rotation: 90,
        mirror: "horizontal",
      }),
    ).toMatchObject({
      id: "X1",
      placement: { rotation: 90, mirror: "horizontal" },
      reference: "X1",
      netlist: {
        binding: { childDocumentId: "child" },
      },
    });
  });

  it("places a Cell caller through one parent transaction", () => {
    const project = createEmptyProject("project", "Project");
    const child = createEmptyDocument("child", "Stage");
    project.documents.push(child);
    const instance = createHierarchyInstance("X1", child, {
      position: { x: 0, y: 0 },
      rotation: 0,
      mirror: "none",
    });
    const result = executeProjectTransaction(project, {
      transactionId: "place-cell",
      projectId: project.id,
      expectedStructureRevision: 0,
      actor: { kind: "human", id: "test" },
      edits: planPlaceCellInstance(project, project.topDocumentId, instance),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.project.documents.find(
        (document) => document.id === project.topDocumentId,
      )?.instances,
    ).toEqual([expect.objectContaining({ id: "X1" })]);
  });

  it("permits a hierarchy reference independent from the stable instance id", () => {
    const child = createEmptyDocument("child", "Stage");
    expect(
      createHierarchyInstance(
        "X2-copy-1",
        child,
        { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
        "X2",
      ),
    ).toMatchObject({ id: "X2-copy-1", reference: "X2" });
  });

  it("atomically adds a Port Instance, local Net, and formal terminal", () => {
    const project = createEmptyProject("project", "Project");
    const instance = {
      id: "P1",
      symbolId: "port",
      placement: {
        position: { x: 40, y: 20 },
        rotation: 0 as const,
        mirror: "none" as const,
      },
    };
    const result = executeProjectTransaction(project, {
      transactionId: "add-port",
      projectId: project.id,
      expectedStructureRevision: 0,
      actor: { kind: "human", id: "test" },
      edits: planCreateCellPin(project, project.topDocumentId, {
        instance,
        connectionEdits: [
          {
            kind: "connect_endpoints",
            from: { kind: "terminal", instanceId: "P1", pinName: "P" },
            to: { kind: "terminal", instanceId: "P1", pinName: "P" },
            newNetId: "net-in",
          },
        ],
        terminal: {
          id: "terminal-in",
          name: "IN",
          netId: "net-in",
          direction: "input",
          interfaceInstanceIds: ["P1"],
        },
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      project: {
        documents: [
          {
            instances: [{ id: "P1" }],
            nets: [{ id: "net-in", terminals: [{ instanceId: "P1" }] }],
            netlist: { terminals: [{ id: "terminal-in", name: "IN" }] },
          },
        ],
      },
    });
  });

  it("creates a repeated Cell Pin name as an independent interface", () => {
    const project = createEmptyProject("project", "Project");
    const port = (id: string, x: number) => ({
      id,
      symbolId: "port",
      placement: {
        position: { x, y: 20 },
        rotation: 0 as const,
        mirror: "none" as const,
      },
    });
    const first = executeProjectTransaction(project, {
      transactionId: "add-port",
      projectId: project.id,
      expectedStructureRevision: 0,
      actor: { kind: "human", id: "test" },
      edits: planCreateCellPin(project, project.topDocumentId, {
        instance: port("P1", 40),
        connectionEdits: [
          {
            kind: "connect_endpoints",
            from: { kind: "terminal", instanceId: "P1", pinName: "P" },
            to: { kind: "terminal", instanceId: "P1", pinName: "P" },
            newNetId: "net-in",
          },
        ],
        terminal: {
          id: "terminal-in",
          name: "IN",
          netId: "net-in",
          direction: "input",
          interfaceInstanceIds: ["P1"],
        },
      }),
    });
    expect(first.ok).toBe(true);

    if (!first.ok) throw new Error(first.error.message);
    const second = executeProjectTransaction(first.project, {
      transactionId: "add-independent-port",
      projectId: project.id,
      expectedStructureRevision: first.project.structureRevision,
      actor: { kind: "human", id: "test" },
      edits: planCreateCellPin(first.project, project.topDocumentId, {
        instance: port("P2", 200),
        connectionEdits: [
          {
            kind: "connect_endpoints",
            from: { kind: "terminal", instanceId: "P2", pinName: "P" },
            to: { kind: "terminal", instanceId: "P2", pinName: "P" },
            newNetId: "net-marker-p2",
          },
        ],
        terminal: {
          id: "terminal-in-copy",
          name: "in",
          netId: "net-marker-p2",
          direction: "output",
          interfaceInstanceIds: ["P2"],
        },
      }),
    });
    expect(second).toMatchObject({
      ok: true,
      project: {
        documents: [
          {
            netlist: {
              terminals: [
                {
                  id: "terminal-in",
                  name: "IN",
                  interfaceInstanceIds: ["P1"],
                  netId: "net-in",
                },
                {
                  id: "terminal-in-copy",
                  name: "in",
                  direction: "output",
                  interfaceInstanceIds: ["P2"],
                  netId: "net-marker-p2",
                },
              ],
            },
            nets: [
              {
                id: "net-in",
                terminals: [{ instanceId: "P1", pinName: "P" }],
              },
              {
                id: "net-marker-p2",
                terminals: [{ instanceId: "P2", pinName: "P" }],
              },
            ],
          },
        ],
      },
    });
    if (!second.ok) throw new Error(second.error.message);
    const removedCopy = executeProjectTransaction(second.project, {
      transactionId: "remove-independent-port",
      projectId: project.id,
      expectedStructureRevision: second.project.structureRevision,
      actor: { kind: "human", id: "test" },
      edits: planRemoveCellTerminal(
        second.project,
        project.topDocumentId,
        "terminal-in-copy",
        [
          {
            kind: "disconnect_endpoint",
            endpoint: { kind: "terminal", instanceId: "P2", pinName: "P" },
          },
          { kind: "remove_instance", instanceId: "P2" },
        ],
      ),
    });
    expect(removedCopy).toMatchObject({
      ok: true,
      project: {
        documents: [
          {
            instances: [{ id: "P1" }],
            netlist: {
              terminals: [{ id: "terminal-in", interfaceInstanceIds: ["P1"] }],
            },
            nets: [
              {
                id: "net-in",
                terminals: [{ instanceId: "P1", pinName: "P" }],
              },
            ],
          },
        ],
      },
    });
  });

  it("switches VDD Power between one physical Cell interface and Global ownership", () => {
    const project = createEmptyProject("project", "Project");
    const document = project.documents[0]!;
    document.instances.push(
      { id: "VDD1", symbolId: "vdd-port", placement: null },
      { id: "VDD2", symbolId: "vdd-port", placement: null },
    );
    document.nets.push({
      id: "net-vdd",
      terminals: [
        { instanceId: "VDD1", pinName: "P" },
        { instanceId: "VDD2", pinName: "P" },
      ],
    });
    document.netlist!.terminals.push(
      {
        id: "terminal-vdd1",
        name: "VDD",
        netId: "net-vdd",
        direction: "inout",
        interfaceInstanceIds: ["VDD1"],
      },
      {
        id: "terminal-vdd2",
        name: "VDD",
        netId: "net-vdd",
        direction: "inout",
        interfaceInstanceIds: ["VDD2"],
      },
    );
    document.annotations.push(
      {
        id: "power-label-vdd1",
        kind: "power-label",
        binding: { kind: "cell-terminal-name", terminalId: "terminal-vdd1" },
        netId: "net-vdd",
        anchor: {
          kind: "object",
          objectId: "VDD1",
          localOffset: { x: 0, y: -10 },
          fallbackPosition: { x: 0, y: -10 },
        },
        alignment: "middle",
        rotation: 0,
        locked: false,
      },
      {
        id: "power-label-vdd2",
        kind: "power-label",
        binding: { kind: "cell-terminal-name", terminalId: "terminal-vdd2" },
        netId: "net-vdd",
        anchor: {
          kind: "object",
          objectId: "VDD2",
          localOffset: { x: 0, y: -10 },
          fallbackPosition: { x: 0, y: -10 },
        },
        alignment: "middle",
        rotation: 0,
        locked: false,
      },
    );

    const global = executeProjectTransaction(project, {
      transactionId: "vdd-global",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "human", id: "test" },
      edits: planSetVddConnectionMode(project, document.id, "VDD1", "global"),
    });
    expect(global.ok).toBe(true);
    if (!global.ok) return;
    const globalDocument = global.project.documents[0]!;
    expect(globalDocument.netlist?.terminals).toEqual([]);
    expect(globalDocument.connectivityEvidence).toEqual([
      expect.objectContaining({
        kind: "name-claim",
        name: "VDD",
        scope: "global",
        owner: { kind: "power-marker", objectId: "VDD1" },
      }),
      expect.objectContaining({
        kind: "name-claim",
        name: "VDD",
        scope: "global",
        owner: { kind: "power-marker", objectId: "VDD2" },
      }),
    ]);
    expect(
      globalDocument.annotations.map((annotation) => annotation.binding),
    ).toEqual([
      { kind: "net-name", netId: "net-vdd" },
      { kind: "net-name", netId: "net-vdd" },
    ]);

    const local = executeProjectTransaction(global.project, {
      transactionId: "vdd-local",
      projectId: project.id,
      expectedStructureRevision: global.project.structureRevision,
      actor: { kind: "human", id: "test" },
      edits: planSetVddConnectionMode(
        global.project,
        document.id,
        "VDD1",
        "cell-pin",
      ),
    });
    expect(local.ok).toBe(true);
    if (!local.ok) return;
    const localDocument = local.project.documents[0]!;
    expect(localDocument.connectivityEvidence).toEqual([]);
    expect(localDocument.netlist?.terminals).toEqual([
      expect.objectContaining({
        name: "VDD",
        netId: "net-vdd",
        interfaceInstanceIds: ["VDD1"],
      }),
      expect.objectContaining({
        name: "VDD",
        netId: "net-vdd",
        interfaceInstanceIds: ["VDD2"],
      }),
    ]);
    expect(
      localDocument.annotations.map((annotation) => annotation.binding?.kind),
    ).toEqual(["cell-terminal-name", "cell-terminal-name"]);
  });

  it("returns no reorder transaction at an interface boundary", () => {
    const project = createEmptyProject("project", "Project");
    project.documents[0]!.netlist!.terminals.push({
      id: "terminal-in",
      name: "IN",
      netId: "net-in",
      direction: "input",
      interfaceInstanceIds: ["P1"],
    });
    expect(
      planReorderCellTerminal(
        project,
        project.topDocumentId,
        "terminal-in",
        -1,
      ),
    ).toEqual([]);
  });

  it("updates and reorders a projected Port as one group", () => {
    const project = createEmptyProject("project", "Project");
    const document = project.documents[0]!;
    document.instances.push(
      { id: "P1", symbolId: "port", placement: null },
      { id: "P2", symbolId: "port", placement: null },
      { id: "P3", symbolId: "port", placement: null },
    );
    document.nets.push(
      {
        id: "net-out",
        terminals: [
          { instanceId: "P1", pinName: "P" },
          { instanceId: "P3", pinName: "P" },
        ],
      },
      {
        id: "net-in",
        terminals: [{ instanceId: "P2", pinName: "P" }],
      },
    );
    document.netlist!.terminals.push(
      {
        id: "terminal-out-a",
        name: "OUT",
        netId: "net-out",
        direction: "passive",
        interfaceInstanceIds: ["P1"],
      },
      {
        id: "terminal-in",
        name: "IN",
        netId: "net-in",
        direction: "input",
        interfaceInstanceIds: ["P2"],
      },
      {
        id: "terminal-out-b",
        name: "out",
        netId: "net-out",
        direction: "passive",
        interfaceInstanceIds: ["P3"],
      },
    );

    const directionEdits = planUpdateCellPortDirection(
      project,
      document.id,
      "terminal-out-a",
      "output",
    );
    expect(directionEdits).toEqual([
      expect.objectContaining({
        kind: "transact_document",
        edits: [
          expect.objectContaining({ terminalId: "terminal-out-a" }),
          expect.objectContaining({ terminalId: "terminal-out-b" }),
        ],
      }),
    ]);
    const directionResult = executeProjectTransaction(project, {
      transactionId: "set-port-direction",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "human", id: "test" },
      edits: directionEdits,
    });
    expect(directionResult.ok).toBe(true);
    expect(directionResult.project.documents[0]!.netlist!.terminals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "terminal-out-a", direction: "output" }),
        expect.objectContaining({ id: "terminal-out-b", direction: "output" }),
      ]),
    );

    const reorderEdits = planReorderCellPort(
      project,
      document.id,
      "terminal-in",
      -1,
    );
    expect(reorderEdits).toEqual([
      expect.objectContaining({
        kind: "transact_document",
        edits: [
          {
            kind: "reorder_cell_terminals",
            terminalIds: ["terminal-in", "terminal-out-a", "terminal-out-b"],
          },
        ],
      }),
    ]);
    const reorderResult = executeProjectTransaction(project, {
      transactionId: "reorder-port",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "human", id: "test" },
      edits: reorderEdits,
    });
    expect(reorderResult.ok).toBe(true);
    expect(
      reorderResult.project.documents[0]!.netlist!.terminals.map(
        (terminal) => terminal.id,
      ),
    ).toEqual(["terminal-in", "terminal-out-a", "terminal-out-b"]);
  });

  it("renames a Cell Pin to an existing name without merging identity or Net", () => {
    const project = createEmptyProject("project", "Project");
    const document = project.documents[0]!;
    document.instances.push(
      { id: "P1", symbolId: "port", placement: null },
      { id: "P2", symbolId: "port", placement: null },
    );
    document.nets.push(
      {
        id: "net-in-a",
        terminals: [{ instanceId: "P1", pinName: "P" }],
      },
      {
        id: "net-in-b",
        terminals: [{ instanceId: "P2", pinName: "P" }],
      },
    );
    document.netlist!.terminals.push(
      {
        id: "terminal-in",
        name: "IN",
        netId: "net-in-a",
        direction: "input",
        interfaceInstanceIds: ["P1"],
      },
      {
        id: "terminal-alias",
        name: "ALIAS",
        netId: "net-in-b",
        direction: "input",
        interfaceInstanceIds: ["P2"],
      },
    );

    const result = executeProjectTransaction(project, {
      transactionId: "merge-cell-pins",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "human", id: "test" },
      edits: planRenameCellTerminal(
        project,
        document.id,
        "terminal-alias",
        "in",
      ),
    });

    expect(result).toMatchObject({
      ok: true,
      project: {
        documents: [
          {
            netlist: {
              terminals: [
                {
                  id: "terminal-in",
                  name: "IN",
                  netId: "net-in-a",
                  interfaceInstanceIds: ["P1"],
                },
                {
                  id: "terminal-alias",
                  name: "in",
                  netId: "net-in-b",
                  interfaceInstanceIds: ["P2"],
                },
              ],
            },
            nets: [
              {
                id: "net-in-a",
                terminals: [{ instanceId: "P1", pinName: "P" }],
              },
              {
                id: "net-in-b",
                terminals: [{ instanceId: "P2", pinName: "P" }],
              },
            ],
          },
        ],
      },
    });
  });
});

describe("reviewed external MOS model targets", () => {
  function projectWithNmos() {
    const project = createEmptyProject("project", "Project");
    const document = project.documents[0]!;
    document.instances.push({
      id: "M1",
      symbolId: "nmos",
      placement: {
        position: { x: 0, y: 0 },
        rotation: 0,
        mirror: "none",
      },
      reference: "M1",
      netlist: {
        binding: { kind: "model", deviceClass: "mos", name: "generic_nmos" },
        parameters: { w: "2u", l: "150n", m: "2" },
      },
    });
    document.nets.push({
      id: "net-drain",

      terminals: [{ instanceId: "M1", pinName: "D" }],
    });
    document.junctions.push({
      id: "junction-drain",
      netId: "net-drain",
      position: { x: 0, y: -40 },
    });
    document.routes.push(
      createRoutePath({
        id: "route-drain",
        netId: "net-drain",
        start: { kind: "terminal", instanceId: "M1", pinName: "D" },
        end: { kind: "junction", junctionId: "junction-drain" },
        bends: [],
        modes: ["auto"],
      }),
    );
    document.noConnects.push({
      id: "open-bulk",
      endpoint: { kind: "terminal", instanceId: "M1", pinName: "B" },
    });
    return project;
  }

  it("creates a SKY130 interface and atomically adopts its ngspice X reference", () => {
    const project = projectWithNmos();
    const edits = planSetMosModelTarget(
      project,
      project.topDocumentId,
      "M1",
      "sky130_fd_pr__nfet_01v8",
    );
    const result = executeProjectTransaction(project, {
      transactionId: "set-sky130-model",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "human", id: "test" },
      edits,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const instance = result.project.documents[0]!.instances[0]!;
    expect(result.project.externalSubcircuitDefinitions[0]).toMatchObject({
      name: "sky130_fd_pr__nfet_01v8",
      terminals: [{ name: "D" }, { name: "G" }, { name: "S" }, { name: "B" }],
      formalParameters: [
        { name: "w", defaultValue: "1" },
        { name: "l", defaultValue: "0.15" },
        { name: "nf", defaultValue: "1" },
        { name: "m", defaultValue: "1" },
      ],
    });
    expect(instance).toMatchObject({
      symbolId: "nmos",
      reference: "M1",
      netlist: {
        parameters: { w: "2u", l: "150n", m: "2" },
        binding: { kind: "external-subcircuit" },
      },
    });
    expect(result.project.documents[0]!.nets[0]!.terminals).toEqual([
      { instanceId: "M1", pinName: "D" },
    ]);
    expect(result.project.documents[0]!.routes[0]!.start).toEqual({
      kind: "terminal",
      instanceId: "M1",
      pinName: "D",
    });
    expect(result.project.documents[0]!.noConnects[0]!.endpoint).toEqual({
      kind: "terminal",
      instanceId: "M1",
      pinName: "B",
    });
  });

  it("places a reviewed external master with canonical MOS artwork", () => {
    const project = projectWithNmos();
    const result = executeProjectTransaction(project, {
      transactionId: "create-sky130-definition",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "human", id: "test" },
      edits: planSetMosModelTarget(
        project,
        project.topDocumentId,
        "M1",
        "sky130_fd_pr__nfet_01v8",
      ),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(
      createExternalSubcircuitInstance(
        "X2",
        result.project.externalSubcircuitDefinitions[0]!,
        {
          position: { x: 100, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      ),
    ).toMatchObject({
      symbolId: "nmos",
      netlist: {
        binding: { kind: "external-subcircuit" },
      },
    });
  });

  it("returns a reviewed SKY130 X call to an ordinary MOS model without deleting its interface", () => {
    const source = projectWithNmos();
    const externalResult = executeProjectTransaction(source, {
      transactionId: "set-sky130-model",
      projectId: source.id,
      expectedStructureRevision: source.structureRevision,
      actor: { kind: "human", id: "test" },
      edits: planSetMosModelTarget(
        source,
        source.topDocumentId,
        "M1",
        "sky130_fd_pr__nfet_01v8",
      ),
    });
    expect(externalResult.ok).toBe(true);
    if (!externalResult.ok) return;
    const project = externalResult.project;
    const result = executeProjectTransaction(project, {
      transactionId: "set-generic-model",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "human", id: "test" },
      edits: planSetMosModelTarget(
        project,
        project.topDocumentId,
        "M1",
        "generic_nmos",
      ),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.documents[0]!.instances[0]).toMatchObject({
      symbolId: "nmos",
      reference: "M1",
      netlist: {
        binding: { kind: "model", deviceClass: "mos", name: "generic_nmos" },
      },
    });
    expect(result.project.externalSubcircuitDefinitions).toHaveLength(1);
  });

  it("rejects a PFET master on an NMOS symbol", () => {
    const project = projectWithNmos();
    expect(() =>
      planSetMosModelTarget(
        project,
        project.topDocumentId,
        "M1",
        "sky130_fd_pr__pfet_01v8",
      ),
    ).toThrow(/not compatible/u);
  });

  it("reuses frozen passive symbols and replaces scalar values with reviewed geometry", () => {
    for (const fixture of [
      {
        symbolId: "resistor",
        reference: "R1",
        target: "sky130_fd_pr__res_high_po",
        terminalNames: ["R0", "R1", "B"],
        parameters: { w: "1u", l: "5.5u", mult: "1" },
      },
      {
        symbolId: "capacitor",
        reference: "C1",
        target: "sky130_fd_pr__cap_mim_m3_1",
        terminalNames: ["C0", "C1"],
        parameters: { w: "5u", l: "5u", mf: "1" },
      },
    ] as const) {
      const project = createEmptyProject("project", "Project");
      project.documents[0]!.instances.push({
        id: fixture.reference,
        symbolId: fixture.symbolId,
        placement: null,
        reference: fixture.reference,
        netlist: {
          binding: {
            kind: "primitive",
            deviceClass: fixture.symbolId,
          },
          parameters: { value: "10k" },
        },
      });
      const result = executeProjectTransaction(project, {
        transactionId: `set-${fixture.symbolId}-target`,
        projectId: project.id,
        expectedStructureRevision: project.structureRevision,
        actor: { kind: "human", id: "test" },
        edits: planSetDeviceModelTarget(
          project,
          project.topDocumentId,
          fixture.reference,
          fixture.target,
        ),
      });
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.project.documents[0]!.instances[0]).toMatchObject({
        symbolId: fixture.symbolId,
        reference: fixture.reference,
        netlist: {
          binding: { kind: "external-subcircuit" },
          parameters: fixture.parameters,
        },
      });
      expect(
        result.project.externalSubcircuitDefinitions[0]!.terminals.map(
          (terminal) => terminal.name,
        ),
      ).toEqual(fixture.terminalNames);

      const cleared = executeProjectTransaction(result.project, {
        transactionId: `clear-${fixture.symbolId}-target`,
        projectId: result.project.id,
        expectedStructureRevision: result.project.structureRevision,
        actor: { kind: "human", id: "test" },
        edits: planSetDeviceModelTarget(
          result.project,
          result.project.topDocumentId,
          fixture.reference,
          "",
        ),
      });
      expect(cleared.ok).toBe(true);
      if (!cleared.ok) continue;
      expect(cleared.project.documents[0]!.instances[0]).toMatchObject({
        symbolId: fixture.symbolId,
        reference: fixture.reference,
        netlist: {
          binding: { kind: "primitive", deviceClass: fixture.symbolId },
          parameters: {},
        },
      });
    }
  });

  it("switches the ordinary PNP between a primitive model and its exact SKY130 wrapper", () => {
    const project = createEmptyProject("project", "Project");
    project.documents[0]!.instances.push({
      id: "Q1",
      symbolId: "pnp",
      placement: null,
      reference: "Q1",
      netlist: {
        binding: { kind: "model", deviceClass: "bjt", name: "generic_pnp" },
        parameters: {},
      },
    });
    const external = executeProjectTransaction(project, {
      transactionId: "set-sky130-pnp",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "human", id: "test" },
      edits: planSetDeviceModelTarget(
        project,
        project.topDocumentId,
        "Q1",
        "sky130_fd_pr__pnp_05v5_W0p68L0p68",
      ),
    });
    expect(external.ok).toBe(true);
    if (!external.ok) return;
    expect(external.project.documents[0]!.instances[0]).toMatchObject({
      symbolId: "pnp",
      reference: "Q1",
      netlist: {
        binding: { kind: "external-subcircuit" },
        parameters: {},
      },
    });
    expect(external.project.externalSubcircuitDefinitions[0]).toMatchObject({
      name: "sky130_fd_pr__pnp_05v5_W0p68L0p68",
      terminals: [{ name: "C" }, { name: "B" }, { name: "E" }],
    });

    const ordinary = executeProjectTransaction(external.project, {
      transactionId: "set-generic-pnp",
      projectId: external.project.id,
      expectedStructureRevision: external.project.structureRevision,
      actor: { kind: "human", id: "test" },
      edits: planSetDeviceModelTarget(
        external.project,
        external.project.topDocumentId,
        "Q1",
        "generic_pnp",
      ),
    });
    expect(ordinary.ok).toBe(true);
    if (!ordinary.ok) return;
    expect(ordinary.project.documents[0]!.instances[0]).toMatchObject({
      symbolId: "pnp",
      reference: "Q1",
      netlist: {
        binding: { kind: "model", deviceClass: "bjt", name: "generic_pnp" },
        parameters: {},
      },
    });
  });

  it("does not rename devices when an exported X reference would be occupied", () => {
    const project = projectWithNmos();
    project.documents[0]!.instances.push({
      id: "existing-external",
      symbolId: "external-symbol",
      placement: null,
      reference: "XM1",
      netlist: { parameters: {} },
    });
    const edits = planSetMosModelTarget(
      project,
      project.topDocumentId,
      "M1",
      "sky130_fd_pr__nfet_01v8",
    );
    const result = executeProjectTransaction(project, {
      transactionId: "preserve-names",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "human", id: "test" },
      edits,
    });
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(
        result.project.documents[0]!.instances.map((i) => i.reference),
      ).toEqual(["M1", "XM1"]);
  });
});
