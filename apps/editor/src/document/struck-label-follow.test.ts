import { describe, expect, it } from "vitest";
import {
  createEmptyDocument,
  createEmptyProject,
  createRoutePath,
  type SchematicDocument,
} from "@icm/model";
import {
  defaultInstanceLabelPlacement,
  diagnoseLabelClearance,
  resolveDocumentStyleProfile,
  resolveEndpointPoint,
} from "@icm/derived";
import { planSetCellSymbolPins } from "@icm/edit-engine";
import {
  builtInSymbols,
  createProjectSymbolResolver,
  hierarchicalSymbolId,
} from "@icm/symbols";

import {
  applyProjectCopyPlacement,
  captureProjectCopy,
  planProjectCopyPlacement,
} from "../features/clipboard/project-copy";
import { defaultInstanceDisplayAnnotations } from "../features/instance-display/default-instance-display";
import {
  EDITOR_PROJECT_TRANSACTION_OPTIONS,
  EditorDocumentController,
} from "./document-controller";

/**
 * A Cell with Pins A (west) and B (east), placed once as X1 showing its Cell
 * name under the block. A's wire leaves for a trunk of its own Net that runs
 * down past the block, as each SRAM cell's blb leaves the shared bit line.
 */
function sramLikeProject() {
  const project = createEmptyProject("project", "Project", "top");
  const child = createEmptyDocument("child", "cell");
  for (const name of ["A", "B"]) {
    child.instances.push({ id: `P${name}`, symbolId: "port", placement: null });
    child.nets.push({
      id: `net-${name}`,
      terminals: [{ instanceId: `P${name}`, pinName: "P" }],
    });
    child.netlist!.terminals.push({
      id: `terminal-${name}`,
      name,
      netId: `net-${name}`,
      direction: "inout",
      interfaceInstanceIds: [`P${name}`],
    });
  }
  child.presentation.cellSymbol = {
    pinPlacements: [
      { terminalId: "terminal-A", side: "west", offset: -20 },
      { terminalId: "terminal-B", side: "east", offset: 0 },
    ],
  };
  project.documents.push(child);
  const top = project.documents[0]!;
  const instance = {
    id: "X1",
    reference: "X1",
    symbolId: hierarchicalSymbolId("cell"),
    placement: {
      position: { x: 0, y: 0 },
      rotation: 0 as const,
      mirror: "none" as const,
    },
    netlist: {
      binding: { kind: "subcircuit" as const, childDocumentId: "child" },
      parameters: {},
    },
  };
  top.instances.push(instance);
  const resolver = createProjectSymbolResolver(project, builtInSymbols);
  top.annotations.push(
    ...defaultInstanceDisplayAnnotations(
      top,
      instance,
      resolver,
      resolveDocumentStyleProfile(top.presentation),
      { masterName: "cell", showDesignator: false },
    ),
  );
  const pin = (pinName: string) =>
    resolveEndpointPoint(top, resolver, {
      kind: "terminal",
      instanceId: "X1",
      pinName,
    })!;
  const a = pin("A");
  const b = pin("B");
  top.nets.push(
    { id: "net-top-A", terminals: [{ instanceId: "X1", pinName: "A" }] },
    { id: "net-top-B", terminals: [{ instanceId: "X1", pinName: "B" }] },
  );
  top.junctions.push(
    { id: "tap", netId: "net-top-A", position: { x: a.x - 50, y: a.y } },
    {
      id: "trunk-end",
      netId: "net-top-A",
      position: { x: a.x - 50, y: a.y + 150 },
    },
    { id: "open-B", netId: "net-top-B", position: { x: b.x + 50, y: b.y } },
  );
  const route = (
    id: string,
    netId: string,
    start: Parameters<typeof createRoutePath>[0]["start"],
    end: Parameters<typeof createRoutePath>[0]["end"],
  ) => createRoutePath({ id, netId, start, end, bends: [], modes: ["manual"] });
  top.routes.push(
    route(
      "wire-A",
      "net-top-A",
      { kind: "terminal", instanceId: "X1", pinName: "A" },
      { kind: "junction", junctionId: "tap" },
    ),
    route(
      "trunk-A",
      "net-top-A",
      { kind: "junction", junctionId: "tap" },
      { kind: "junction", junctionId: "trunk-end" },
    ),
    route(
      "wire-B",
      "net-top-B",
      { kind: "terminal", instanceId: "X1", pinName: "B" },
      { kind: "junction", junctionId: "open-B" },
    ),
  );
  return project;
}

const struckNames = (
  document: SchematicDocument,
  project: ReturnType<typeof sramLikeProject>,
) =>
  diagnoseLabelClearance(
    document,
    createProjectSymbolResolver(project, builtInSymbols),
  ).filter(
    (item) =>
      item.code === "VISUAL_LABEL_CLEARANCE" &&
      item.objectIds.includes("instance-master-X1"),
  );

describe("a Cell's Pin change moves the caller labels its redrawn wires strike (#1366)", () => {
  it("lifts the placed Cell's name clear of a wire redrawn under its block", () => {
    const controller = new EditorDocumentController(sramLikeProject());
    const before = controller.project.documents.find(
      (item) => item.id === "top",
    )!;
    const name = before.annotations.find(
      (item) => item.id === "instance-master-X1",
    )!;
    const project = controller.project;
    const result = controller.dispatchProjectTransaction({
      transactionId: "a-east",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "agent", id: "test" },
      edits: planSetCellSymbolPins(project, "child", [
        { name: "A", side: "east", offset: 20 },
      ]),
    });
    if (!result.ok) throw new Error(result.error.message);
    const after = controller.project.documents.find(
      (item) => item.id === "top",
    )!;
    // A's wire now comes back under the block, where the name stood.
    expect(after.routes.find((route) => route.id === "wire-A")).toBeDefined();
    const moved = after.annotations.find(
      (item) => item.id === "instance-master-X1",
    )!;
    expect(moved.anchor).not.toEqual(name.anchor);
    expect(moved.content).toEqual(name.content);
    expect(struckNames(after, controller.project)).toEqual([]);
    // One undo takes back the Pin, the wiring and the name together.
    controller.transact([{ kind: "undo" }]);
    expect(
      controller.project.documents
        .find((item) => item.id === "top")!
        .annotations.find((item) => item.id === "instance-master-X1")!.anchor,
    ).toEqual(name.anchor);
  });

  it("lifts it too when Pins pasted into the Cell grow its block over it", () => {
    // A paste that adds Pins restates the Cell's block layout, and its
    // callers follow as they do a Pin change. Three input Pins pasted in
    // made the block taller, down over the name under it.
    const project = sramLikeProject();
    const scratch = createEmptyDocument("scratch", "scratch");
    for (const [index, name] of ["EN", "CLK", "RST"].entries()) {
      scratch.instances.push({
        id: `P${name}`,
        symbolId: "port",
        placement: {
          position: { x: 0, y: index * 40 },
          rotation: 0,
          mirror: "none",
        },
      });
      scratch.nets.push({
        id: `net-${name}`,
        terminals: [{ instanceId: `P${name}`, pinName: "P" }],
      });
      scratch.netlist!.terminals.push({
        id: `terminal-${name}`,
        name,
        netId: `net-${name}`,
        direction: "input",
        interfaceInstanceIds: [`P${name}`],
      });
    }
    project.documents.push(scratch);
    const child = project.documents.find((item) => item.id === "child")!;
    const clipboard = captureProjectCopy(project, scratch, {
      instanceIds: ["PEN", "PCLK", "PRST"],
      routeIds: [],
      junctionIds: [],
      annotationIds: [],
      draftingIds: [],
    })!;
    const plan = planProjectCopyPlacement(
      project,
      child,
      clipboard,
      { x: 400, y: 0 },
      1,
    );
    const name = (next: typeof project) =>
      next.documents
        .find((item) => item.id === "top")!
        .annotations.find((item) => item.id === "instance-master-X1")!;
    const pasted = applyProjectCopyPlacement(
      plan,
      undefined,
      EDITOR_PROJECT_TRANSACTION_OPTIONS,
    );
    expect(name(pasted).anchor).not.toEqual(name(project).anchor);
    expect(
      struckNames(
        pasted.documents.find((item) => item.id === "top")!,
        pasted,
      ),
    ).toEqual([]);
  });

  it("keeps the name beside the block through further Pin changes", () => {
    // The first move puts B on the west side, and its redrawn wire runs
    // through the name, which moves clear. The second moves A east: the
    // block widens over where the name went, and the name keeps its place
    // beside the new block instead of being left under it.
    const controller = new EditorDocumentController(sramLikeProject());
    const move = (
      name: string,
      side: "east" | "west" | "north",
      offset: number,
    ) => {
      const project = controller.project;
      const result = controller.dispatchProjectTransaction({
        transactionId: `move-${name}-${side}`,
        projectId: project.id,
        expectedStructureRevision: project.structureRevision,
        actor: { kind: "agent", id: "test" },
        edits: planSetCellSymbolPins(project, "child", [
          { name, side, offset },
        ]),
      });
      if (!result.ok) throw new Error(result.error.message);
      return controller.project.documents.find((item) => item.id === "top")!;
    };
    expect(struckNames(move("B", "west", 20), controller.project)).toEqual([]);
    expect(struckNames(move("A", "east", 20), controller.project)).toEqual([]);
  });

  it("moves a name no wire touches to its slot on a taller block", () => {
    // A on the north side made the block taller; its name, untouched by any
    // wire, stood where the old block's bottom had been.
    const controller = new EditorDocumentController(sramLikeProject());
    const project = controller.project;
    const result = controller.dispatchProjectTransaction({
      transactionId: "a-north",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "agent", id: "test" },
      edits: planSetCellSymbolPins(project, "child", [
        { name: "A", side: "north", offset: 0 },
      ]),
    });
    if (!result.ok) throw new Error(result.error.message);
    const top = controller.project.documents.find((item) => item.id === "top")!;
    const instance = top.instances.find((item) => item.id === "X1")!;
    const resolver = createProjectSymbolResolver(
      controller.project,
      builtInSymbols,
    );
    const slot = defaultInstanceLabelPlacement(
      instance,
      resolver.resolve(instance.symbolId, instance.symbolVariantId)!,
      resolveDocumentStyleProfile(top.presentation),
      top.presentation.grid,
      "reference",
    )!;
    const name = top.annotations.find(
      (item) => item.id === "instance-master-X1",
    )!;
    expect(
      name.anchor.kind === "object" && name.anchor.fallbackPosition,
    ).toEqual(slot.position);
    expect(struckNames(top, controller.project)).toEqual([]);
  });
});
