import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { EditorProjectDock } from "./editor-project-dock";

describe("EditorProjectDock", () => {
  it("keeps the project surface separate without repeating toolbar choices", () => {
    const markup = renderToStaticMarkup(
      <EditorProjectDock onClose={vi.fn()}>
        <p>complete source</p>
      </EditorProjectDock>,
    );
    expect(markup).toContain('aria-label="Project tools"');
    expect(markup).toContain('aria-label="Close project tools"');
    expect(markup).not.toContain('role="tab"');
    expect(markup).not.toContain("Netlist");
    expect(markup).not.toContain("Project Code");
    expect(markup).toContain("complete source");
    expect(markup).not.toContain("Properties");
  });
});
