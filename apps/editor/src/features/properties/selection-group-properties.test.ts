import { describe, expect, it } from "vitest";
import { EditorDocumentController } from "../../document/document-controller";
import { createGroupDragPerformanceProject } from "../selection/test-support/group-drag-fixture";
import { createPropertyEditPlanner } from "./property-edit-planner";
import { readSelectionGroupProperties } from "./selection-group-properties";

describe("selection group property read", () => {
  it("reads selected parts without per-part full annotation or terminal searches", () => {
    const controller = new EditorDocumentController(
      createGroupDragPerformanceProject().project,
    );
    const document = controller.document;
    const planner = createPropertyEditPlanner({
      project: controller.project,
      document,
      resolver: controller.resolver,
      routeGeometryRecords: [],
      setStatus() {},
    });
    const selectedIds = document.instances
      .slice(0, 3)
      .map((instance) => instance.id);
    const counts = { annotations: 0, terminals: 0, parameters: 0 };
    const originalFind = Array.prototype.find;
    const originalFilter = Array.prototype.filter;
    Array.prototype.find = function (...args: Parameters<typeof originalFind>) {
      if (this === document.annotations) counts.annotations++;
      if (this === document.netlist?.terminals) counts.terminals++;
      return Reflect.apply(originalFind, this, args);
    };
    Array.prototype.filter = function (
      ...args: Parameters<typeof originalFilter>
    ) {
      if (this === document.annotations) counts.annotations++;
      if (this === document.netlist?.terminals) counts.terminals++;
      return Reflect.apply(originalFilter, this, args);
    };
    let result: ReturnType<typeof readSelectionGroupProperties>;
    try {
      result = readSelectionGroupProperties(
        document,
        selectedIds,
        (instance) => {
          counts.parameters++;
          return planner.propertyParametersForInstance(instance);
        },
        "#000000",
      );
    } finally {
      Array.prototype.find = originalFind;
      Array.prototype.filter = originalFilter;
    }
    expect(
      result.selectedGroupInstances.map((instance) => instance.id),
    ).toEqual(selectedIds);
    expect(result.selectedGroupContext.items).toHaveLength(3);
    expect(counts).toEqual({ annotations: 0, terminals: 0, parameters: 3 });
  });
});
