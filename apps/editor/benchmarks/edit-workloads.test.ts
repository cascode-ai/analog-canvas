import { expect, it } from "vitest";
import {
  createEditPerformanceProject,
  createEditWorkload,
} from "./edit-workloads";

it("rotates a device in a 500-instance Project through an undoable editor command", () => {
  const workload = createEditWorkload(createEditPerformanceProject(), "rotate");
  workload.run();
  expect(workload.controller.document.instances).toHaveLength(500);
  expect(workload.controller.document.instances[0]!.placement?.rotation).toBe(
    90,
  );
  expect(workload.controller.canUndo).toBe(true);
});

it("measures Undo after a real edit and restores the starting placement", () => {
  const workload = createEditWorkload(createEditPerformanceProject(), "undo");
  expect(workload.controller.canUndo).toBe(true);
  workload.run();
  expect(workload.controller.document.instances[0]!.placement?.rotation).toBe(
    0,
  );
  expect(workload.controller.canUndo).toBe(false);
  expect(workload.controller.canRedo).toBe(true);
});

it("pastes twelve fresh instances as one reversible edit on the large Project", () => {
  const workload = createEditWorkload(createEditPerformanceProject(), "paste");
  workload.run();
  const document = workload.controller.document;
  expect(document.instances).toHaveLength(512);
  expect(new Set(document.instances.map((item) => item.id)).size).toBe(512);
  expect(document.instances.slice(500).map((item) => item.reference)).toEqual([
    "R501",
    "R502",
    "R503",
    "R504",
    "R505",
    "R506",
    "R507",
    "R508",
    "R509",
    "R510",
    "R511",
    "R512",
  ]);
  expect(workload.controller.transact([{ kind: "undo" }]).ok).toBe(true);
  expect(workload.controller.document.instances).toHaveLength(500);
  expect(workload.controller.canUndo).toBe(false);
});

it("commits a visible wire joining two pins and removes it with one Undo", () => {
  const workload = createEditWorkload(
    createEditPerformanceProject(),
    "wireCommit",
  );
  workload.run();
  expect(workload.controller.document.routes.length).toBeGreaterThan(0);
  expect(
    workload.controller.document.nets.some(
      (net) =>
        net.terminals.some(
          (pin) => pin.instanceId === "R1" && pin.pinName === "1",
        ) &&
        net.terminals.some(
          (pin) => pin.instanceId === "R2" && pin.pinName === "1",
        ),
    ),
  ).toBe(true);
  expect(workload.controller.transact([{ kind: "undo" }]).ok).toBe(true);
  expect(workload.controller.document.routes).toHaveLength(0);
});
