import { describe, expect, it } from "vitest";

import { createEmptyProject } from "@icm/model";

import {
  EDITOR_PROJECT_TRANSACTION_OPTIONS,
  EditorDocumentController,
} from "../document/document-controller";
import {
  applyProjectCopyPlacement,
  captureProjectCopy,
  planProjectCopyPlacement,
} from "../features/clipboard/project-copy";
import { copyWorkspaceCell } from "./workspace-copy";

describe("copyWorkspaceCell", () => {
  it("marks the Project an Agent copies into, not the one it copies from", () => {
    const drawn = createEmptyProject("source", "Source");
    drawn.documents[0]!.instances = [
      {
        id: "R1",
        reference: "R1",
        symbolId: "resistor",
        placement: {
          position: { x: 100, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      },
    ];
    const source = new EditorDocumentController(drawn);
    const destination = new EditorDocumentController(
      createEmptyProject("target", "Target"),
    );

    const copied = copyWorkspaceCell(
      {
        action: "copy",
        sourceWorkspaceId: "source-tab",
        sourceDocumentId: source.document.id,
        sourceRevision: source.document.revision,
        sourceStructureRevision: source.project.structureRevision,
        targetWorkspaceId: "target-tab",
        targetDocumentId: destination.document.id,
        expectedStructureRevision: destination.project.structureRevision,
        expectedRevision: destination.document.revision,
        offset: { x: 0, y: 0 },
      },
      source,
      destination,
      {
        captureProjectCopy,
        planProjectCopyPlacement,
        applyProjectCopyPlacement: (plan, actor) =>
          applyProjectCopyPlacement(
            plan,
            actor,
            EDITOR_PROJECT_TRANSACTION_OPTIONS,
          ),
      },
    );

    expect(copied).toHaveProperty("result");
    expect(destination.document.instances).toHaveLength(1);
    expect(destination.agentEdited).toBe(true);
    expect(source.agentEdited).toBe(false);
  });
});
