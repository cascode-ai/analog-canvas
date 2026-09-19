import { createEmptyProject } from "@icm/model";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { HierarchyToolbar } from "./hierarchy-toolbar";

const callbacks = {
  onTop: vi.fn(),
  onSelectDocument: vi.fn(),
  onEnter: vi.fn(),
  onManageCells: vi.fn(),
  onPlaceCell: vi.fn(),
};

describe("HierarchyToolbar", () => {
  it("stays absent for a flat Project without an enter target", () => {
    const project = createEmptyProject("flat-toolbar", "Flat");
    expect(
      renderToStaticMarkup(
        <HierarchyToolbar
          documents={project.documents}
          activeDocumentId={project.topDocumentId}
          topDocumentId={project.topDocumentId}
          navigationDepth={0}
          canEnter={false}
          {...callbacks}
        />,
      ),
    ).toBe("");
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
        navigationDepth={0}
        canEnter
        {...callbacks}
      />,
    );

    expect(markup).toContain('data-testid="cell-navigation"');
    expect(markup).toContain("dut (top)");
    expect(markup).toContain("Child");
    expect(markup).toContain("Enter Cell");
    expect(markup).toContain("Manage Cells…");
    expect(markup).not.toContain(">Up</button>");
  });
});
