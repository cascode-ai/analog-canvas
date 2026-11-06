import { expect, it } from "vitest";
import { createEmptyProject } from "@icm/model";
import { EditorDocumentController } from "../../document/document-controller";
import {
  addChildPortNames,
  createChildCellDraft,
  inferPinDirection,
  planChildCellPlacement,
} from "./new-cell";
import { createHierarchyInstance } from "@icm/edit-engine";

it("guesses a new Pin's direction from its name as the importer does", () => {
  for (const name of ["in", "inp", "VIN", "clk", "vref", "ibias", "en"])
    expect(inferPinDirection(name), name).toBe("input");
  for (const name of ["out", "OUTP", "vout", "vo", "q", "QB", "y"])
    expect(inferPinDirection(name), name).toBe("output");
  for (const name of ["vdd", "AVDD", "vcc", "vss", "gnd", "VEE", "0"])
    expect(inferPinDirection(name), name).toBe("passive");
});

it("adds typed or pasted Pin names once each, in order", () => {
  const first = addChildPortNames([], "in1, in2;out  vdd");
  expect(first.ports).toEqual([
    { name: "in1", direction: "input" },
    { name: "in2", direction: "input" },
    { name: "out", direction: "output" },
    { name: "vdd", direction: "passive" },
  ]);
  expect(first.skipped).toEqual([]);
  const second = addChildPortNames(first.ports, "OUT vss");
  expect(second.ports.map((port) => port.name)).toEqual([
    "in1",
    "in2",
    "out",
    "vdd",
    "vss",
  ]);
  expect(second.skipped).toEqual(["OUT"]);
});

it("keeps a draft out of the Project and creates its interface and caller in one undo step", () => {
  const controller = new EditorDocumentController(
    createEmptyProject("p", "Project"),
  );
  const before = controller.project;
  const child = createChildCellDraft(
    before,
    controller.document.id,
    "child",
    "Amplifier",
    [
      { name: "IN", direction: "input" },
      { name: "OUT", direction: "output" },
    ],
  );
  expect(controller.project).toBe(before);
  expect(controller.canUndo).toBe(false);
  const instance = createHierarchyInstance("X1", child, {
    position: { x: 0, y: 0 },
    rotation: 0,
    mirror: "none",
  });
  const result = controller.dispatchProjectTransaction({
    projectId: before.id,
    expectedStructureRevision: before.structureRevision,
    transactionId: "create-child",
    actor: { kind: "human", id: "test" },
    edits: planChildCellPlacement(
      before,
      controller.document.id,
      child,
      instance,
    ),
  });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  expect(
    controller.project.documents
      .find((cell) => cell.id === "child")
      ?.netlist?.terminals.map((port) => port.name),
  ).toEqual(["IN", "OUT"]);
  expect(controller.document.instances[0]?.netlist?.binding).toEqual({
    kind: "subcircuit",
    childDocumentId: "child",
  });
  controller.openDocument("child");
  const subsequentEdit = controller.transact([
    {
      kind: "add_instance",
      instance: {
        id: "R1",
        reference: "R1",
        symbolId: "resistor",
        placement: null,
        netlist: { parameters: { value: "1k" } },
      },
    },
  ]);
  expect(subsequentEdit.ok, JSON.stringify(subsequentEdit)).toBe(true);
  expect(controller.transact([{ kind: "undo" }]).ok).toBe(true);
  expect(controller.project.documents).toHaveLength(2);
  expect(controller.document.instances.some((item) => item.id === "R1")).toBe(
    false,
  );
  expect(controller.transact([{ kind: "undo" }]).ok).toBe(true);
  expect(controller.project.documents).toHaveLength(1);
  expect(controller.document.instances).toHaveLength(0);
  expect(controller.transact([{ kind: "redo" }]).ok).toBe(true);
  expect(controller.project.documents).toHaveLength(2);
  expect(controller.document.instances).toHaveLength(1);
});
