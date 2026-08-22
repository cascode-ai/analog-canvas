import { describe, expect, it } from "vitest";

import { createEmptyDocument, createEmptyProject } from "@icm/model";

import {
  createExternalSubcircuitInstance,
  createHierarchyInstance,
  planAttachCellPortMarker,
  planCreateCellPort,
  planPlaceCellInstance,
  planReorderCellTerminal,
  planSetMosModelTarget,
} from "./hierarchy-planner.js";
import { executeProjectTransaction } from "./project-transaction.js";

describe("hierarchy domain planners", () => {
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
        mirror: "x",
      }),
    ).toMatchObject({
      id: "X1",
      placement: { rotation: 90, mirror: "x" },
      netlist: {
        reference: "X1",
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
    ).toMatchObject({ id: "X2-copy-1", netlist: { reference: "X2" } });
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
      edits: planCreateCellPort(project, project.topDocumentId, {
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

  it("adds a second marker to an existing terminal instead of a second terminal", () => {
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
      edits: planCreateCellPort(project, project.topDocumentId, {
        instance: port("P1", 40),
        connectionEdits: [
          {
            kind: "connect_endpoints",
            from: { kind: "terminal", instanceId: "P1", pinName: "P" },
            to: { kind: "terminal", instanceId: "P1", pinName: "P" },
            newNetId: "net-in",
            newNetName: "IN",
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

    const second = executeProjectTransaction(first.project, {
      transactionId: "add-second-marker",
      projectId: project.id,
      expectedStructureRevision: first.structureRevision,
      actor: { kind: "human", id: "test" },
      edits: planAttachCellPortMarker(first.project, project.topDocumentId, {
        instance: port("P2", 200),
        connectionEdits: [
          {
            kind: "connect_endpoints",
            from: { kind: "terminal", instanceId: "P2", pinName: "P" },
            to: { kind: "terminal", instanceId: "P2", pinName: "P" },
            newNetId: "net-marker-p2",
          },
        ],
        terminalId: "terminal-in",
        markerNetId: "net-marker-p2",
      }),
    });

    expect(second.ok).toBe(true);
    const document = second.project.documents.find(
      (candidate) => candidate.id === project.topDocumentId,
    )!;
    // One formal terminal, two markers: the interface a parent resolves
    // against stays single-valued.
    expect(document.netlist!.terminals).toHaveLength(1);
    expect(document.netlist!.terminals[0]).toMatchObject({
      id: "terminal-in",
      name: "IN",
      interfaceInstanceIds: ["P1", "P2"],
    });
    // Both markers share the terminal's Net.
    expect(document.nets.filter((net) => net.name === "IN")).toHaveLength(1);
    const net = document.nets.find((candidate) => candidate.id === "net-in")!;
    expect(net.terminals.map((terminal) => terminal.instanceId).sort()).toEqual(
      ["P1", "P2"],
    );
    expect(document.nets.some((n) => n.id === "net-marker-p2")).toBe(false);
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
});

describe("reviewed external MOS model targets", () => {
  function projectWithNmos() {
    const project = createEmptyProject("project", "Project");
    const document = project.documents[0]!;
    document.instances.push({
      id: "M1",
      symbolId: "nmos",
      schematicReference: "M1",
      placement: {
        position: { x: 0, y: 0 },
        rotation: 0,
        mirror: "none",
      },
      netlist: {
        reference: "M1",
        binding: { kind: "model", deviceClass: "mos", name: "generic_nmos" },
        parameters: { w: "2u", l: "150n", m: "2" },
      },
    });
    document.nets.push({
      id: "net-drain",
      scope: "local",
      terminals: [{ instanceId: "M1", pinName: "D" }],
    });
    document.junctions.push({
      id: "junction-drain",
      netId: "net-drain",
      position: { x: 0, y: -40 },
    });
    document.routes.push({
      id: "route-drain",
      netId: "net-drain",
      from: { kind: "terminal", instanceId: "M1", pinName: "D" },
      to: { kind: "junction", junctionId: "junction-drain" },
      waypoints: [],
      segmentModes: ["auto"],
    });
    document.noConnects.push({
      id: "open-bulk",
      endpoint: { kind: "terminal", instanceId: "M1", pinName: "B" },
    });
    return project;
  }

  it("atomically creates a SKY130 interface and changes M to an external X call", () => {
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
    });
    expect(instance).toMatchObject({
      symbolId: "nmos",
      schematicReference: "M1",
      netlist: {
        reference: "X1",
        parameters: { w: "2u", l: "150n", m: "2" },
        binding: { kind: "external-subcircuit" },
      },
    });
    expect(result.project.documents[0]!.nets[0]!.terminals).toEqual([
      { instanceId: "M1", pinName: "D" },
    ]);
    expect(result.project.documents[0]!.routes[0]!.from).toEqual({
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
      schematicReference: "M1",
      netlist: {
        reference: "M1",
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
});
