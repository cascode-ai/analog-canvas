import { readDocumentChangeJournal } from "@icm/model";
import * as engine from "@icm/edit-engine";
import { EditorDocumentController } from "../document/document-controller";
import { createDefaultNetlistExportPreferences } from "../features/netlist-export/netlist-export-preferences";
import { placementProcessFill } from "../features/netlist-export/netlist-process";
import { createEmptyProject, createSimulationFolder } from "@icm/model";
import { describe, expect, it, vi } from "vitest";

import type { InteractionMode } from "../interaction/interaction-state";
import {
  createEditorTransactionCommands,
  plainRoutingRefusal,
} from "./editor-transaction-commands";

function dependencies() {
  const project = createEmptyProject("project", "Project");
  return {
    project,
    document: project.documents[0]!,
    dispatchProjectTransaction: vi.fn(),
    transactDocument: vi.fn(),
    getCurrentInteractionKind: vi.fn((): InteractionMode => "idle"),
    cancelAllTransientInteraction: vi.fn(),
    setStatus: vi.fn(),
  };
}

function livePlacement(project = createEmptyProject("mos", "MOS")) {
  const controller = new EditorDocumentController(project);
  const commands = createEditorTransactionCommands({
    ...dependencies(),
    project: controller.project,
    document: controller.document,
    resolver: controller.resolver,
    dispatchProjectTransaction: (request) =>
      controller.dispatchProjectTransaction(request),
    transactDocument: (edits) => controller.transact(edits),
  });
  return {
    controller,
    commands,
    project: controller.project,
    document: controller.document,
  };
}

describe("editor transaction commands", () => {
  it("places M1 in one undoable commit without Project trials when another Cell already owns a bound M1", () => {
    const input = createEmptyProject("mos", "MOS");
    const child = {
      ...structuredClone(input.documents[0]!),
      id: "child",
      name: "child",
      netlist: { name: "child", terminals: [], formalParameters: [] },
      instances: [
        {
          id: "M1",
          reference: "M1",
          symbolId: "nmos",
          placement: null,
          netlist: {
            binding: {
              kind: "model" as const,
              deviceClass: "mos" as const,
              name: "sky130_fd_pr__nfet_01v8",
            },
            parameters: { w: "11u" },
          },
        },
      ],
    };
    input.documents.push(child);
    const { controller, commands, project, document } = livePlacement(input);
    const execute = vi.spyOn(engine, "executeProjectTransaction");
    try {
      expect(
        commands.commitComponentPlacement(
          [
            {
              kind: "add_instance",
              instance: {
                id: "M1",
                reference: "M1",
                symbolId: "nmos",
                placement: {
                  position: { x: 0, y: 0 },
                  rotation: 0,
                  mirror: "none",
                },
                netlist: { parameters: { w: "7u" } },
              },
            },
          ],
          undefined,
          (edits, placed) =>
            placementProcessFill(
              project,
              createDefaultNetlistExportPreferences(),
              document.id,
              edits,
              placed,
            ),
        ),
      ).toBe(true);
      expect(
        execute.mock.calls.map(
          ([, request]) => (request as engine.ProjectTransaction).transactionId,
        ),
      ).toEqual(["place-component"]);
      expect(
        controller.project.externalSubcircuitDefinitions.map((d) => d.name),
      ).toEqual(["sky130_fd_pr__nfet_01v8"]);
      expect(controller.document.instances[0]?.netlist).toMatchObject({
        binding: {
          kind: "external-subcircuit",
          definitionId: controller.project.externalSubcircuitDefinitions[0]!.id,
        },
        parameters: { w: "7u" },
      });
      const compound = execute.mock.results[0]!
        .value as engine.ProjectTransactionResult;
      expect(
        compound.ok &&
          compound.documentResults.map((result) =>
            engine.readTransactionDraftWork(result.document),
          ),
      ).toEqual([{ mode: "local", rowsCopied: 0 }]);
      const receipt = readDocumentChangeJournal(controller.document)!;
      expect(receipt.before).toBe(document);
      expect(receipt.rows).toContainEqual({
        collection: "instances",
        id: "M1",
        change: "added",
      });
      expect(
        readDocumentChangeJournal(
          controller.project.documents.find((item) => item.id === child.id)!,
        ),
      ).toBeUndefined();
      expect(
        controller.project.documents.find((item) => item.id === child.id)
          ?.instances,
      ).toEqual(child.instances);
      const placed = controller.document.instances;
      expect(controller.transact([{ kind: "undo" }]).ok).toBe(true);
      expect(controller.document.instances).toEqual([]);
      expect(controller.project.externalSubcircuitDefinitions).toEqual([]);
      expect(controller.canUndo).toBe(false);
      expect(controller.transact([{ kind: "redo" }]).ok).toBe(true);
      expect(controller.document.instances).toEqual(placed);
    } finally {
      execute.mockRestore();
    }
  });
  it.each([
    ["a refused optional fill", false, true],
    ["a stale placement", true, false],
  ] as const)(
    "keeps placement and history atomic after %s",
    (_, stale, accepted) => {
      const { controller, commands, project, document } = livePlacement();
      if (stale) {
        expect(
          controller.dispatchProjectTransaction({
            transactionId: "rename",
            projectId: project.id,
            expectedStructureRevision: project.structureRevision,
            actor: { kind: "human", id: "test" },
            edits: [{ kind: "rename_project", name: "New name" }],
          }).ok,
        ).toBe(true);
      }
      const committed = commands.commitComponentPlacement(
        [
          {
            kind: "add_instance",
            instance: {
              id: "M1",
              reference: "M1",
              symbolId: "nmos",
              placement: null,
            },
          },
        ],
        undefined,
        (edits, evaluated) =>
          evaluated
            ? [
                {
                  kind: "transact_document",
                  documentId: document.id,
                  expectedRevision: document.revision,
                  // A fill targeting a missing Instance must be rejected atomically.
                  edits: [
                    ...edits,
                    {
                      kind: "set_instance_netlist",
                      instanceId: "missing",
                      netlist: { parameters: {} },
                    },
                  ],
                },
              ]
            : undefined,
      );
      expect(committed).toBe(accepted);
      expect(
        controller.document.instances.map((instance) => instance.id),
      ).toEqual(accepted ? ["M1"] : []);
      expect(controller.project.externalSubcircuitDefinitions).toEqual([]);
      expect(controller.transact([{ kind: "undo" }]).ok).toBe(true);
      expect(controller.document.instances).toEqual([]);
      expect(controller.canUndo).toBe(false);
    },
  );
  it("builds one revision-checked structural envelope and surfaces diagnostics", () => {
    const input = dependencies();
    input.dispatchProjectTransaction.mockReturnValue({
      ok: false,
      applied: false,
      structureRevision: 0,
      project: input.project,
      error: { code: "EDIT_PRECONDITION", message: "generic failure" },
      diagnostics: [
        {
          code: "EDIT_PRECONDITION",
          severity: "error",
          message: "specific structural failure",
        },
      ],
    });
    const commands = createEditorTransactionCommands(input);

    expect(
      commands.commitStructure("rename-project", [
        { kind: "rename_project", name: "Next" },
      ]),
    ).toBe(false);
    expect(input.dispatchProjectTransaction).toHaveBeenCalledWith(
      {
        transactionId: "rename-project",
        projectId: "project",
        expectedStructureRevision: 0,
        actor: { kind: "human", id: "human-local" },
        edits: [{ kind: "rename_project", name: "Next" }],
      },
      input.document.id,
      "detached",
    );
    expect(input.setStatus).toHaveBeenCalledWith(
      "Could not update Cell structure: specific structural failure",
    );
  });

  it("preserves a legal structural no-op for callers that distinguish unchanged", () => {
    const input = dependencies();
    const unchanged = {
      ok: true as const,
      applied: false,
      structureRevision: 0,
      proposedStructureRevision: 0,
      project: input.project,
      proposedProject: input.project,
      changedDocumentIds: [],
      documentResults: [],
      diagnostics: [],
    };
    input.dispatchProjectTransaction.mockReturnValue(unchanged);
    const commands = createEditorTransactionCommands(input);

    expect(
      commands.transactStructure("upsert-simulation-folder", [
        {
          kind: "upsert_simulation_folder",
          folder: createSimulationFolder({
            id: "folder-1",
            name: "OP",
            documentId: input.document.id,
            profileId: "profile",
          }),
        },
      ]),
    ).toBe(unchanged);
    expect(input.setStatus).not.toHaveBeenCalled();
  });

  it.each([
    ["copy-placement", "active tool cancelled"],
    // Any commit while a Wire is being drawn, an Undo say, drops the Wire
    // and says so.
    ["wire", "Wire cancelled"],
  ] as const)(
    "cancels an unrelated %s after a successful commit",
    (kind, said) => {
      const input = dependencies();
      input.getCurrentInteractionKind.mockReturnValue(kind);
      input.transactDocument.mockReturnValue({
        ok: true,
        applied: true,
        revision: 1,
        proposedRevision: 1,
        document: { ...input.document, revision: 1 },
        diff: {
          documentId: input.document.id,
          fromRevision: 0,
          toRevision: 1,
          editKinds: ["set_presentation_style"],
          changedObjectIds: [],
        },
        diagnostics: [],
      });
      const commands = createEditorTransactionCommands(input);

      commands.transact([
        {
          kind: "set_presentation_style",
          styleProfileId: "razavi-textbook-v1",
        },
      ]);

      expect(input.cancelAllTransientInteraction).toHaveBeenCalledOnce();
      expect(input.setStatus).toHaveBeenLastCalledWith(
        `Committed revision 1; ${said} because the circuit changed`,
      );
    },
  );

  it("converts wrapper exceptions into a typed rejection and clears interaction", () => {
    const input = dependencies();
    input.transactDocument.mockImplementation(() => {
      throw new Error("wrapper failed");
    });
    const commands = createEditorTransactionCommands(input);

    const result = commands.transact([
      {
        kind: "set_presentation_style",
        styleProfileId: "razavi-textbook-v1",
      },
    ]);

    expect(result).toMatchObject({
      ok: false,
      applied: false,
      error: { code: "INTERNAL_ERROR", message: "wrapper failed" },
    });
    expect(input.cancelAllTransientInteraction).toHaveBeenCalledOnce();
    expect(input.setStatus).toHaveBeenCalledWith(
      "INTERNAL_ERROR: wrapper failed — operation cancelled; circuit unchanged",
    );
  });
});

describe("routing refusals shown to a person", () => {
  it("restates electrical invariants as what the drawing refused to do", () => {
    const preserve = plainRoutingRefusal(
      "Routing operation changed endpoint Net membership outside a preserve effect",
    );
    // The invariant's own vocabulary never survives to the status bar.
    expect(preserve).not.toContain("preserve effect");
    expect(preserve).not.toContain("endpoint Net membership");
    expect(preserve).toContain("Nets");
    expect(
      plainRoutingRefusal("Routing merge did not join endpoint group a, b"),
    ).not.toContain("endpoint group");
    expect(
      plainRoutingRefusal("Routing partition retained a Route declared as cut"),
    ).not.toContain("partition");
  });

  it("passes an unrecognized refusal through unchanged", () => {
    // An honest technical sentence beats a vague friendly one.
    expect(plainRoutingRefusal("Route route-1 contains a locked segment")).toBe(
      "Route route-1 contains a locked segment",
    );
  });
});
