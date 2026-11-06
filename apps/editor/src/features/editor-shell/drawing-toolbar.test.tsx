import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { DrawingToolbar } from "./drawing-toolbar";

describe("DrawingToolbar", () => {
  it("projects active panels and tools without owning editor state", () => {
    const markup = renderToStaticMarkup(
      <DrawingToolbar
        leftPanelMode="examples"
        libraryPanelOpen
        projectPanel="project-code"
        tool="wire"
        styleProfileId="razavi-textbook"
        onStartInsert={vi.fn()}
        documentSettingsOpen
        undo={{ enabled: true, execute: vi.fn() }}
        redo={{ enabled: true, execute: vi.fn() }}
        onToggleExamples={vi.fn()}
        onToggleLibrary={vi.fn()}
        onToggleNetlist={vi.fn()}
        onToggleProjectCode={vi.fn()}
        onActivateTool={vi.fn()}
        onAddText={vi.fn()}
        onOpenDocumentSettings={vi.fn()}
      />,
    );

    expect(markup).toContain('data-testid="draw-toolbar"');
    expect(markup).toContain('data-testid="examples-toggle"');
    expect(markup).toContain('aria-keyshortcuts="G"');
    expect(markup).toContain('aria-keyshortcuts="B"');
    expect(markup).toContain('aria-keyshortcuts="N"');
    expect(markup).toContain('data-testid="netlist-panel-toggle"');
    expect(markup).toContain('data-testid="project-code-toggle"');
    expect(markup).toContain('data-testid="draw-tool-wire"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).not.toContain('data-testid="draw-tool-insert"');
    expect(markup).not.toContain('data-testid="draw-tool-arrow"');
    expect(markup).not.toContain('data-testid="draw-tool-line"');
    expect(markup).not.toContain('data-testid="draw-tool-rectangle"');
    expect(markup).not.toContain('data-testid="draw-tool-circle"');
    // Properties keeps its name, also for a window too narrow to show it, and
    // needs no hover text; familiar tools are named icons, and only Wire and
    // No Connect explain themselves on hover.
    expect(markup).toContain('aria-label="Properties"');
    expect(markup).not.toContain("Properties: Ports, canvas");
    // Only the annotation palette's symbol icons carry a title.
    for (const [element] of markup.matchAll(
      /<[a-z]+ [^>]*title="[^"]*"[^>]*>/gu,
    ))
      expect(element).toMatch(/aria-label="Place /u);
    expect(markup).toContain("Properties</span>");
    expect(markup).toContain('aria-label="Undo"');
    expect(markup).toContain('aria-keyshortcuts="W"');
    expect(markup).not.toContain("Undo</span>");
    expect(markup).not.toContain("Wire</span>");
    expect(markup).not.toContain('data-testid="digital-simulation-toggle"');
    expect(markup).not.toContain("Digital Simulation");
    expect(markup).toContain('aria-label="Panels"');
    expect(markup).toContain('aria-label="Annotation tools"');
  });
});
