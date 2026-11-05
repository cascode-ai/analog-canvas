import { createEmptyProject } from "@icm/model";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { HierarchyToolbar } from "./hierarchy-toolbar";

const callbacks = {
  onTop: vi.fn(),
  onOpenOccurrence: vi.fn(),
  onUp: vi.fn(),
  onShowHierarchy: vi.fn(),
  onNewChild: vi.fn(),
  onEnter: vi.fn(),
  onManageCells: vi.fn(),
  onPlaceCell: vi.fn(),
};

describe("HierarchyToolbar", () => {
  it("offers hierarchy and new child creation even in a flat Project", () => {
    const project = createEmptyProject("flat-toolbar", "Flat");
    expect(
      renderToStaticMarkup(
        <HierarchyToolbar
          documents={project.documents}
          activeDocumentId={project.topDocumentId}
          topDocumentId={project.topDocumentId}
          path={[]}
          canEnter={false}
          {...callbacks}
        />,
      ),
    ).toContain("New child");
  });

  it("projects Cell navigation without owning hierarchy state", () => {
    const project = createEmptyProject("hierarchy-toolbar", "Hierarchy");
    project.documents.push({
      ...project.documents[0]!,
      id: "document-child",
      name: "Child",
    });
    const markup = renderToStaticMarkup(
      <HierarchyToolbar
        documents={project.documents}
        activeDocumentId={project.topDocumentId}
        topDocumentId={project.topDocumentId}
        path={[]}
        canEnter
        {...callbacks}
      />,
    );

    expect(markup).toContain('data-testid="cell-navigation"');
    expect(markup).toContain("Top");
    expect(markup).toContain("Hierarchy");
    expect(markup).toContain("Enter Cell");
    expect(markup).toContain("Cell properties");
    expect(markup).toContain(">Up</button>");
    expect(markup).not.toContain("<select");
  });
});
