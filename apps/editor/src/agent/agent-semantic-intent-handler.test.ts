import { describe, expect, it, vi } from "vitest";

import { buildProjectConnectivityIndex } from "@icm/derived";
import { createEmptyDocument, createEmptyProject } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";

import { createAgentSemanticIntentHandler } from "./agent-semantic-intent-handler";

function setup(
  project = createEmptyProject("semantic-project", "Semantic Project"),
) {
  const document = project.documents[0]!;
  document.instances.push({
    id: "R1",
    symbolId: "resistor",
    placement: null,
  });
  const navigateToLocator = vi.fn();
  const fitDocument = vi.fn();
  const clearFocus = vi.fn();
  const highlightNet = vi.fn();
  const resolver = new InMemorySymbolResolver(builtInSymbols);
  const handle = createAgentSemanticIntentHandler({
    project,
    resolver,
    connectivityIndex: buildProjectConnectivityIndex(project, resolver),
    navigateToLocator,
    fitDocument,
    clearFocus,
    highlightNet,
  });
  return {
    project,
    document,
    handle,
    navigateToLocator,
    fitDocument,
    clearFocus,
  };
}

describe("Agent semantic intent handler", () => {
  it("delegates document activation, fit, and clear focus without editing", () => {
    const { document, handle, navigateToLocator, fitDocument, clearFocus } =
      setup();

    expect(
      handle({
        documentId: document.id,
        intent: { kind: "activate-document" },
      }),
    ).toMatchObject({ ok: true, kind: "activate-document" });
    expect(navigateToLocator).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: document.id,
        kind: "document",
      }),
      `Agent activated Cell ${document.name}`,
    );

    expect(
      handle({
        documentId: document.id,
        intent: { kind: "fit-document" },
      }),
    ).toMatchObject({ ok: true, kind: "fit-document" });
    expect(fitDocument).toHaveBeenCalledWith(
      document.id,
      `Agent fit Cell ${document.name}`,
    );

    expect(
      handle({
        documentId: document.id,
        intent: { kind: "clear-focus" },
      }),
    ).toMatchObject({ ok: true, kind: "clear-focus" });
    expect(clearFocus).toHaveBeenCalledOnce();
  });

  it("validates locator reachability and object existence before navigation", () => {
    const { document, handle, navigateToLocator } = setup();
    const locator = {
      documentId: document.id,
      hierarchyPath: [],
      kind: "instance" as const,
      objectId: "R1",
    };

    expect(
      handle({
        documentId: document.id,
        intent: { kind: "select", locator },
      }),
    ).toMatchObject({
      ok: true,
      kind: "select",
      objectIds: ["R1"],
    });
    expect(navigateToLocator).toHaveBeenCalledWith(
      locator,
      "Agent selected instance R1",
    );

    expect(
      handle({
        documentId: document.id,
        intent: {
          kind: "select",
          locator: { ...locator, objectId: "R404" },
        },
      }),
    ).toMatchObject({ ok: false, code: "OBJECT_NOT_FOUND" });
  });

  it("rejects requests for a Document outside the active Project", () => {
    const { handle } = setup();
    expect(
      handle({
        documentId: "missing-document",
        intent: { kind: "fit-document" },
      }),
    ).toMatchObject({ ok: false, code: "DOCUMENT_NOT_FOUND" });
  });

  it("locates the requested occurrence when two calls share one Cell", () => {
    const project = createEmptyProject("review-project", "Review");
    const parent = project.documents[0]!;
    const child = createEmptyDocument("review-child", "Child");
    child.instances.push({
      id: "child-R1",
      symbolId: "resistor",
      placement: null,
    });
    project.documents.push(child);
    for (const id of ["X1", "X2"]) {
      parent.instances.push({
        id,
        symbolId: "resistor",
        placement: null,
        netlist: {
          parameters: {},
          binding: { kind: "subcircuit", childDocumentId: child.id },
        },
      });
    }
    const { handle, navigateToLocator } = setup(project);
    const locator = {
      documentId: child.id,
      hierarchyPath: [
        {
          parentDocumentId: parent.id,
          instanceId: "X2",
          childDocumentId: child.id,
        },
      ],
      kind: "instance" as const,
      objectId: "child-R1",
    };
    expect(
      handle({ documentId: child.id, intent: { kind: "select", locator } }),
    ).toMatchObject({ ok: true });
    expect(navigateToLocator).toHaveBeenCalledWith(locator, expect.any(String));
    const stale = {
      ...locator,
      hierarchyPath: [
        { ...locator.hierarchyPath[0]!, instanceId: "deleted-X2" },
      ],
    };
    expect(
      handle({
        documentId: child.id,
        intent: { kind: "select", locator: stale },
      }),
    ).toMatchObject({ ok: false, code: "LOCATOR_MISMATCH" });
    expect(navigateToLocator).toHaveBeenCalledOnce();
  });
});
