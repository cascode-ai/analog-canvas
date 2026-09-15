import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { EditorProjectDock } from "./editor-project-dock";

describe("EditorProjectDock", () => {
  it("keeps Netlist and Project Code together above contextual Properties", () => {
    const markup = renderToStaticMarkup(
      <EditorProjectDock
        mode="project-code"
        onSelect={vi.fn()}
        onClose={vi.fn()}
      >
        <p>complete source</p>
      </EditorProjectDock>,
    );
    expect(markup).toContain('aria-label="Project tools"');
    expect(markup).toContain('role="tab" aria-selected="false"');
    expect(markup).toContain('role="tab" aria-selected="true"');
    expect(markup).toContain("Netlist");
    expect(markup).toContain("Project Code");
    expect(markup).not.toContain("Properties");
  });
});
