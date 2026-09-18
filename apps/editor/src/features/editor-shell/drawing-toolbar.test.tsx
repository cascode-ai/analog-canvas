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
        simulation={{ open: true, onToggle: vi.fn() }}
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
    expect(markup).toContain('data-testid="netlist-panel-toggle"');
    expect(markup).toContain('data-testid="project-code-toggle"');
    expect(markup).toContain('data-testid="draw-tool-wire"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).not.toContain('data-testid="draw-tool-insert"');
    expect(markup).not.toContain('data-testid="draw-tool-arrow"');
    expect(markup).not.toContain('data-testid="draw-tool-line"');
    expect(markup).not.toContain('data-testid="draw-tool-rectangle"');
    expect(markup).not.toContain('data-testid="draw-tool-circle"');
    expect(markup).toContain("Document settings");
    expect(markup).toContain('data-testid="digital-simulation-toggle"');
    expect(markup).toContain("Digital Simulation");
    expect(markup).toContain('aria-label="Panels"');
    expect(markup).toContain('aria-label="Annotation tools"');
  });
});
