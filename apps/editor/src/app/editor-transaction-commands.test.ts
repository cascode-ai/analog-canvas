import { createEmptyProject } from "@icm/model";
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

describe("editor transaction commands", () => {
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
    );
    expect(input.setStatus).toHaveBeenCalledWith(
      "Could not update Cell structure: specific structural failure",
    );
  });

  it("cancels an unrelated transient tool after a successful commit", () => {
    const input = dependencies();
    input.getCurrentInteractionKind.mockReturnValue("copy-placement");
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
      "Committed revision 1; active tool cancelled because the circuit changed",
    );
  });

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
