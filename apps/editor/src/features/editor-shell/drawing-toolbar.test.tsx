import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { DrawingToolbar } from "./drawing-toolbar";

describe("DrawingToolbar", () => {
  it("projects active panels and tools without owning editor state", () => {
    const markup = renderToStaticMarkup(
      <DrawingToolbar
        leftPanelMode="examples"
        libraryPanelOpen
        tool="wire"
        documentSettingsOpen
        undo={{ enabled: true, execute: vi.fn() }}
        redo={{ enabled: true, execute: vi.fn() }}
        simulation={{ open: true, onToggle: vi.fn() }}
        onToggleExamples={vi.fn()}
        onToggleLibrary={vi.fn()}
        onInsert={vi.fn()}
        onActivateTool={vi.fn()}
        onAddText={vi.fn()}
        onOpenDocumentSettings={vi.fn()}
      />,
    );

    expect(markup).toContain('data-testid="draw-toolbar"');
    expect(markup).toContain('data-testid="examples-toggle"');
    expect(markup).toContain('data-testid="draw-tool-wire"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain("Insert component (I)");
    expect(markup).toContain("Document settings");
    expect(markup).toContain('data-testid="digital-simulation-toggle"');
    expect(markup).toContain("Digital Simulation");
  });
});
