import { buildProjectHierarchy } from "@icm/derived";
import type { ProjectStructureEdit } from "@icm/edit-engine";
import { describe, expect, it } from "vitest";

import { hierarchyNavigationFixture } from "../../../../../netlists/hierarchy-navigation/fixture";
import { EditorDocumentController } from "../../document/document-controller";
import { cellUses, planReplaceCell } from "./hierarchy-refactor";
import { stableRootOrder } from "./project-hierarchy";

describe("stableRootOrder", () => {
  it("keeps the listed roots in place across a Top switch and appends new roots", () => {
    const controller = new EditorDocumentController(
      hierarchyNavigationFixture(),
    );
    const commit = (edits: ProjectStructureEdit[]) =>
      expect(
        controller.dispatchProjectTransaction({
          projectId: controller.project.id,
          expectedStructureRevision: controller.project.structureRevision,
          transactionId: `order-${controller.project.structureRevision}`,
          actor: { kind: "human", id: "test" },
          edits,
        }).ok,
      ).toBe(true);
    const roots = () => buildProjectHierarchy(controller.project).roots;
    let order = stableRootOrder([], roots());
    expect(order).toEqual(["top", "unused"]);

    // The hierarchy lists the new Top first; the tree keeps its rows.
    commit([{ kind: "set_top_document", documentId: "unused" }]);
    expect(roots()).toEqual(["unused", "top"]);
    order = stableRootOrder(order, roots());
    expect(order).toEqual(["top", "unused"]);

    // Channel, left unused by a refactor, joins at the end.
    commit(
      planReplaceCell(
        controller.project,
        cellUses(controller.project, "channel"),
        "amplifier",
      ),
    );
    order = stableRootOrder(order, roots());
    expect(order).toEqual(["top", "unused", "channel"]);
  });
});
