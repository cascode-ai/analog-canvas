import { describe, expect, it } from "vitest";
import { createEmptyDocument, createEmptyProject } from "@icm/model";
import { EditorDocumentController } from "./document-controller";

function setup() {
  const project = createEmptyProject("history", "Original");
  project.documents.push(createEmptyDocument("child", "Child"));
  return new EditorDocumentController(project);
}
function rename(controller: EditorDocumentController, name: string) {
  const result = controller.dispatchProjectTransaction({
    transactionId: `rename-${name}`,
    projectId: controller.project.id,
    expectedStructureRevision: controller.project.structureRevision,
    actor: { kind: "human", id: "test" },
    edits: [{ kind: "rename_project", name }],
  });
  expect(result.ok && result.applied).toBe(true);
}
function add(controller: EditorDocumentController, id: string) {
  expect(
    controller.transact([
      {
        kind: "add_instance",
        instance: { id, symbolId: "resistor", placement: null },
      },
    ]).ok,
  ).toBe(true);
}
function history(controller: EditorDocumentController, kind: "undo" | "redo") {
  const result = controller.transact([{ kind }]);
  expect(result.ok && result.applied).toBe(true);
}
function agentHistory(
  controller: EditorDocumentController,
  documentId: string,
  kind: "undo" | "redo",
  dryRun = false,
) {
  return controller.dispatchTransaction({
    transactionId: "agent-history",
    documentId,
    expectedRevision: controller.project.documents.find(
      (item) => item.id === documentId,
    )!.revision,
    expectedStructureRevision: controller.project.structureRevision,
    actor: { kind: "agent", id: "test" },
    edits: [{ kind }],
    dryRun,
  });
}

describe("Project working-copy history", () => {
  it("interleaves structural and document edits without jumping or losing redo (#1233)", () => {
    const controller = setup();
    rename(controller, "First");
    add(controller, "R1");
    rename(controller, "Second");
    history(controller, "undo");
    expect(controller.project.name).toBe("First");
    expect(controller.document.instances).toHaveLength(1);
    history(controller, "undo");
    expect(controller.project.name).toBe("First");
    expect(controller.document.instances).toHaveLength(0);
    history(controller, "undo");
    expect(controller.project.name).toBe("Original");
    history(controller, "redo");
    expect(controller.project.name).toBe("First");
    history(controller, "redo");
    expect(controller.document.instances).toHaveLength(1);
    history(controller, "redo");
    expect(controller.project.name).toBe("Second");
    expect(controller.canRedo).toBe(false);
  });

  it("does not let an Agent skip another Cell's newer entry or steal the foreground", () => {
    const controller = setup();
    add(controller, "Rtop");
    controller.openDocument("child");
    add(controller, "Rchild");
    const top = controller.project.topDocumentId;
    controller.openDocument(top);
    const denied = agentHistory(controller, top, "undo");
    expect(denied).toMatchObject({
      ok: false,
      error: { code: "EDIT_PRECONDITION" },
    });
    const before = controller.project;
    expect(agentHistory(controller, "child", "undo", true)).toMatchObject({
      ok: true,
      applied: false,
    });
    expect(controller.project).toBe(before);
    expect(agentHistory(controller, "child", "undo")).toMatchObject({
      ok: true,
      applied: true,
    });
    expect(controller.activeDocumentId).toBe(top);
    expect(controller.document.instances).toHaveLength(1);
    expect(
      controller.project.documents.find((item) => item.id === "child")!
        .instances,
    ).toHaveLength(0);
  });

  it("keeps redo after no-op, rejection and dry run; a new edit branches history", () => {
    const controller = setup();
    add(controller, "R1");
    history(controller, "undo");
    expect(controller.transact([{ kind: "noop" }])).toMatchObject({
      ok: true,
      applied: false,
    });
    expect(
      controller.transact([{ kind: "remove_instance", instanceId: "missing" }])
        .ok,
    ).toBe(false);
    expect(
      agentHistory(controller, controller.activeDocumentId, "redo", true),
    ).toMatchObject({ ok: true, applied: false });
    expect(controller.canRedo).toBe(true);
    add(controller, "R2");
    expect(controller.canRedo).toBe(false);
    history(controller, "undo");
    expect(controller.canUndo).toBe(false);
  });

  it("preserves high-water revisions when deleted Cells are restored", () => {
    const controller = setup();
    controller.openDocument("child");
    add(controller, "R1");
    const revision = controller.document.revision;
    controller.openDocument(controller.project.topDocumentId);
    const next = structuredClone(controller.project);
    next.documents = next.documents.filter((item) => item.id !== "child");
    next.structureRevision++;
    controller.commitProjectStructure(next);
    history(controller, "undo");
    expect(
      controller.project.documents.find((item) => item.id === "child")!
        .revision,
    ).toBeGreaterThan(revision);
    history(controller, "undo");
    expect(
      controller.project.documents.find((item) => item.id === "child")!
        .instances,
    ).toHaveLength(0);
    history(controller, "redo");
    history(controller, "redo");
    expect(
      controller.project.documents.some((item) => item.id === "child"),
    ).toBe(false);
  });

  it("fences stale structural undo and isolates replacement and separate working copies", () => {
    const controller = setup();
    const other = setup();
    const oldStructure = controller.project.structureRevision;
    rename(controller, "Changed");
    const rejected = controller.dispatchTransaction({
      transactionId: "stale",
      documentId: controller.document.id,
      expectedRevision: controller.document.revision,
      expectedStructureRevision: oldStructure,
      actor: { kind: "agent", id: "test" },
      edits: [{ kind: "undo" }],
    });
    expect(rejected).toMatchObject({
      ok: false,
      error: { code: "STALE_REVISION" },
    });
    expect(other.canUndo).toBe(false);
    controller.replaceProject(other.project);
    expect(controller.canUndo).toBe(false);
    expect(controller.canRedo).toBe(false);
  });
});
