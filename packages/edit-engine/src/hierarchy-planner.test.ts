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
  planReorderCellTerminal,
  planRenameCellTerminal,
  planSetMosModelTarget,
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
        mirror: "x",
      }),
    ).toMatchObject({
      id: "X1",
      placement: { rotation: 90, mirror: "x" },
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
      reference: "X1",
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
});
