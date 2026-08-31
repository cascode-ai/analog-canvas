import { createRoutePath } from "@icm/model";
import { describe, expect, it } from "vitest";

import { createEmptyDocument, createEmptyProject } from "@icm/model";
import type { SchematicDocument } from "@icm/model";
import { diagnoseProjectSnapshot } from "@icm/derived";
import { hierarchicalSymbolId } from "@icm/symbols";

import { EditorDocumentController } from "./document-controller";

function instance(id: string) {
  return {
    id,
    symbolId: "resistor",
    placement: null,
  };
}

function hierarchicalProject() {
  const project = createEmptyProject("controller", "Controller");
  const top = project.documents[0]!;
  const child: SchematicDocument = {
    ...structuredClone(top),
    id: "document-child",
    name: "child",
    netlist: { name: "child", terminals: [], formalParameters: [] },
  };
  project.documents.push(child);
  return project;
}

describe("EditorDocumentController", () => {
  it("owns a validated clone rather than mutating the caller's Project", () => {
    const source = hierarchicalProject();
    const controller = new EditorDocumentController(source);

    expect(controller.project).not.toBe(source);
    expect(controller.document.id).toBe(source.topDocumentId);
    expect(controller.activeDocumentId).toBe(source.topDocumentId);
  });

  it("commits through DocumentHistory and replaces exactly the active document", () => {
    const controller = new EditorDocumentController(hierarchicalProject());
    const childBefore = controller.project.documents.find(
      (document) => document.id === "document-child",
    );
    const result = controller.transact([
      { kind: "add_instance", instance: instance("Rtop") },
    ]);

    expect(result.ok && result.applied).toBe(true);
    expect(controller.document.instances).toContainEqual(instance("Rtop"));
    expect(
      controller.project.documents.find(
        (document) => document.id === "document-child",
      ),
    ).toEqual(childBefore);
    expect(controller.transactionsIssued).toBe(1);
    expect(controller.canUndo).toBe(true);
  });

  it("preserves independent undo histories while switching documents", () => {
    const controller = new EditorDocumentController(hierarchicalProject());
    controller.transact([{ kind: "add_instance", instance: instance("Rtop") }]);
    expect(controller.openDocument("document-child")?.name).toBe("child");
    controller.transact([
      { kind: "add_instance", instance: instance("Rchild") },
    ]);

    controller.openDocument(controller.project.topDocumentId);
    expect(controller.canUndo).toBe(true);
    controller.transact([{ kind: "undo" }]);
    expect(controller.document.instances).toEqual([]);

    controller.openDocument("document-child");
    expect(controller.document.instances).toContainEqual(instance("Rchild"));
    expect(controller.canUndo).toBe(true);
  });

  it("re-derives resolved diagnostics across undo and redo revisions", () => {
    const controller = new EditorDocumentController(hierarchicalProject());
    controller.transact([{ kind: "add_instance", instance: instance("R1") }]);
    const codes = () =>
      diagnoseProjectSnapshot(controller.project, controller.resolver)
        .diagnostics.filter(
          (diagnostic) =>
            diagnostic.primary.documentId === controller.document.id,
        )
        .map((diagnostic) => diagnostic.code);

    expect(codes()).toContain("ERC_UNCONNECTED_PIN");

    controller.transact([
      {
        kind: "connect_endpoints",
        from: { kind: "terminal", instanceId: "R1", pinName: "1" },
        to: { kind: "terminal", instanceId: "R1", pinName: "2" },
        newNetId: "net-r1-loop",
      },
    ]);
    expect(codes()).not.toContain("ERC_UNCONNECTED_PIN");

    controller.transact([{ kind: "undo" }]);
    expect(codes()).toContain("ERC_UNCONNECTED_PIN");

    controller.transact([{ kind: "redo" }]);
    expect(codes()).not.toContain("ERC_UNCONNECTED_PIN");
  });

  it("re-derives endpoint readiness when Wire Delete is undone and redone", () => {
    const project = hierarchicalProject();
    const document = project.documents[0]!;
    document.instances.push(
      {
        id: "M1",
        symbolId: "nmos",
        placement: {
          position: { x: 0, y: 0 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        id: "M2",
        symbolId: "nmos",
        placement: {
          position: { x: 100, y: 0 },
          rotation: 0,
          mirror: "none",
        },
      },
    );
    document.nets.push({
      id: "net-ports",
      terminals: ["M1", "M2"].map((instanceId) => ({
        instanceId,
        pinName: "D",
      })),
    });
    document.noConnects.push(
      ...["M1", "M2"].flatMap((instanceId) =>
        ["G", "S", "B"].map((pinName) => ({
          id: `nc-${instanceId.toLowerCase()}-${pinName.toLowerCase()}`,
          endpoint: { kind: "terminal" as const, instanceId, pinName },
        })),
      ),
    );
    document.routes.push(
      createRoutePath({
        id: "wire-ports",
        netId: "net-ports",
        start: { kind: "terminal", instanceId: "M1", pinName: "D" },
        end: { kind: "terminal", instanceId: "M2", pinName: "D" },
        bends: [],
        modes: ["manual"],
      }),
    );
    const controller = new EditorDocumentController(project);
    const unconnectedCount = () =>
      diagnoseProjectSnapshot(
        controller.project,
        controller.resolver,
      ).diagnostics.filter(
        (diagnostic) => diagnostic.code === "ERC_UNCONNECTED_PIN",
      ).length;

    expect(unconnectedCount()).toBe(0);
    const cut = controller.transact([
      { kind: "cut_connection", routeId: "wire-ports" },
    ]);
    if (!cut.ok) throw new Error(JSON.stringify(cut, null, 2));
    expect(unconnectedCount()).toBe(2);

    controller.transact([{ kind: "undo" }]);
    expect(unconnectedCount()).toBe(0);

    controller.transact([{ kind: "redo" }]);
    expect(unconnectedCount()).toBe(2);
  });

  it("rejects missing documents without changing the active history", () => {
    const controller = new EditorDocumentController(hierarchicalProject());
    const activeId = controller.activeDocumentId;

    expect(controller.openDocument("missing")).toBeNull();
    expect(controller.activeDocumentId).toBe(activeId);
  });

  it("resets active document and all histories on Project replacement", () => {
    const controller = new EditorDocumentController(hierarchicalProject());
    const originalSessionId = controller.projectSessionId;
    controller.transact([{ kind: "add_instance", instance: instance("Rold") }]);
    const replacement = createEmptyProject("replacement", "Replacement");
    replacement.topDocumentId = replacement.documents[0]!.id;

    const document = controller.replaceProject(replacement);

    expect(document.id).toBe(replacement.topDocumentId);
    expect(controller.project.id).toBe("replacement");
    expect(controller.projectSessionId).toMatch(/^replacement:\d+$/u);
    expect(controller.projectSessionId).not.toBe(originalSessionId);
    expect(controller.canUndo).toBe(false);
    expect(controller.canRedo).toBe(false);
  });

  it("commits a new child Cell without replacing the Project session", () => {
    const controller = new EditorDocumentController(hierarchicalProject());
    const sessionId = controller.projectSessionId;
    controller.transact([{ kind: "add_instance", instance: instance("Rold") }]);
    const project = structuredClone(controller.project);
    const child = createEmptyDocument("document-cell-1", "Cell1");
    project.documents.push(child);
    project.documents[0]!.instances.push({
      id: "X1",
      symbolId: hierarchicalSymbolId("Cell1"),
      placement: {
        position: { x: 0, y: 0 },
        rotation: 0,
        mirror: "none",
      },
      reference: "X1",
      netlist: {
        parameters: {},
        binding: {
          kind: "subcircuit",
          childDocumentId: child.id,
        },
      },
    });
    project.structureRevision += 1;

    const active = controller.commitProjectStructure(project);

    expect(active.id).toBe(controller.project.topDocumentId);
    expect(controller.projectSessionId).toBe(sessionId);
    expect(
      controller.resolver.resolve(hierarchicalSymbolId("Cell1")),
    ).toBeDefined();
    expect(controller.canUndo).toBe(true);
    expect(controller.openDocument(child.id)?.id).toBe(child.id);
    const undo = controller.transact([{ kind: "undo" }]);
    expect(undo.ok && undo.applied).toBe(true);
    expect(controller.project.documents).toHaveLength(2);
    expect(
      controller.project.documents.some(
        (document) => document.id === "document-cell-1",
      ),
    ).toBe(false);
    expect(controller.document.id).toBe(controller.project.topDocumentId);
    expect(controller.canRedo).toBe(true);

    const redo = controller.transact([{ kind: "redo" }]);
    expect(redo.ok && redo.applied).toBe(true);
    expect(
      controller.project.documents.some(
        (document) => document.id === "document-cell-1",
      ),
    ).toBe(true);
  });

  it("dispatches an Agent transaction as one undo item and refreshes state", () => {
    const controller = new EditorDocumentController(hierarchicalProject());
    const resolverBefore = controller.resolver;
    const revisionBefore = controller.document.revision;

    const result = controller.dispatchTransaction({
      transactionId: "agent-1",
      documentId: controller.activeDocumentId,
      expectedRevision: revisionBefore,
      actor: { kind: "agent", id: "codex" },
      edits: [{ kind: "add_instance", instance: instance("Ragent") }],
    });

    expect(result.ok && result.applied).toBe(true);
    expect(controller.document.instances).toContainEqual(instance("Ragent"));
    expect(controller.document.revision).toBe(revisionBefore + 1);
    expect(controller.canUndo).toBe(true);
    // A commit refreshes the resolver (new reference) like a human commit.
    expect(controller.resolver).not.toBe(resolverBefore);

    // One Agent transaction is one undo item: a single undo restores the
    // pre-Agent state through the shared history.
    controller.transact([{ kind: "undo" }]);
    expect(controller.document.instances).not.toContainEqual(
      instance("Ragent"),
    );
  });

  it("accepts a human transaction via dispatch identical to transact", () => {
    const controller = new EditorDocumentController(hierarchicalProject());

    const result = controller.dispatchTransaction({
      transactionId: "human-1",
      documentId: controller.activeDocumentId,
      expectedRevision: controller.document.revision,
      actor: { kind: "human", id: "human-local" },
      edits: [{ kind: "add_instance", instance: instance("Rh") }],
    });

    expect(result.ok && result.applied).toBe(true);
    expect(controller.document.instances).toContainEqual(instance("Rh"));
  });

  it("leaves history, Project, and resolver unchanged on a dry-run dispatch", () => {
    const controller = new EditorDocumentController(hierarchicalProject());
    const revisionBefore = controller.document.revision;
    const resolverBefore = controller.resolver;

    const result = controller.dispatchTransaction({
      transactionId: "agent-dry",
      documentId: controller.activeDocumentId,
      expectedRevision: revisionBefore,
      actor: { kind: "agent", id: "codex" },
      dryRun: true,
      edits: [{ kind: "add_instance", instance: instance("Rdry") }],
    });

    expect(result.ok).toBe(true);
    expect(result.applied).toBe(false);
    expect(controller.document.revision).toBe(revisionBefore);
    expect(controller.document.instances).not.toContainEqual(instance("Rdry"));
    expect(controller.canUndo).toBe(false);
    expect(controller.resolver).toBe(resolverBefore);
  });

  it("rejects a stale revision and reports the current revision", () => {
    const controller = new EditorDocumentController(hierarchicalProject());
    controller.transact([{ kind: "add_instance", instance: instance("R1") }]);
    const current = controller.document.revision;

    const result = controller.dispatchTransaction({
      transactionId: "agent-stale",
      documentId: controller.activeDocumentId,
      expectedRevision: current - 1,
      actor: { kind: "agent", id: "codex" },
      edits: [{ kind: "add_instance", instance: instance("Rstale") }],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("STALE_REVISION");
      expect(result.revision).toBe(current);
    }
  });

  it("dispatches to a non-active Document without retargeting the active one", () => {
    const controller = new EditorDocumentController(hierarchicalProject());
    const activeId = controller.activeDocumentId;

    const result = controller.dispatchTransaction({
      transactionId: "agent-child",
      documentId: "document-child",
      expectedRevision: controller.project.documents.find(
        (d) => d.id === "document-child",
      )!.revision,
      actor: { kind: "agent", id: "codex" },
      edits: [{ kind: "add_instance", instance: instance("Rchild") }],
    });

    expect(result.ok && result.applied).toBe(true);
    expect(controller.activeDocumentId).toBe(activeId);
    // The active Document is untouched; only the child Document changed.
    expect(controller.document.instances).toEqual([]);
    expect(
      controller.project.documents.find((d) => d.id === "document-child")!
        .instances,
    ).toContainEqual(instance("Rchild"));
  });

  it("returns a typed rejection when the dispatched Document is absent", () => {
    const controller = new EditorDocumentController(hierarchicalProject());
    const revisionBefore = controller.document.revision;

    const result = controller.dispatchTransaction({
      transactionId: "agent-missing",
      documentId: "does-not-exist",
      expectedRevision: revisionBefore,
      actor: { kind: "agent", id: "codex" },
      edits: [{ kind: "add_instance", instance: instance("Rmissing") }],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("OBJECT_NOT_FOUND");
    }
    expect(controller.document.revision).toBe(revisionBefore);
  });
});
