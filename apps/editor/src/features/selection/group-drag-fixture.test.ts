import { expect, it } from "vitest";
import { serializeProject, parseProject } from "@icm/project-protocol";
import {
  createGroupDragPerformanceProject,
  GROUP_DRAG_COUNTS,
} from "./test-support/group-drag-fixture";
import { planSelectionMove } from "./selection-move-plan";
import { EMPTY_VISUAL_SELECTION } from "./visual-selection";

it("provides a reproducible portable large background and 85-instance moving closure", () => {
  const { project, movingIds } = createGroupDragPerformanceProject();
  expect(serializeProject(project)).toBe(
    serializeProject(createGroupDragPerformanceProject().project),
  );
  const document = parseProject(serializeProject(project)).documents[0]!;
  expect(document.instances).toHaveLength(GROUP_DRAG_COUNTS.instances);
  expect(document.routes).toHaveLength(GROUP_DRAG_COUNTS.routes);
  expect(document.junctions).toHaveLength(GROUP_DRAG_COUNTS.junctions);
  expect(document.annotations).toHaveLength(GROUP_DRAG_COUNTS.annotations);
  const move = planSelectionMove(document, {
    ...EMPTY_VISUAL_SELECTION,
    instanceIds: movingIds,
    junctionIds: document.junctions
      .filter((j) => j.id.startsWith("moving-"))
      .map((j) => j.id),
  });
  expect(move.instanceIds).toHaveLength(85);
  expect(move.translatedRouteIds).toHaveLength(238);
});
