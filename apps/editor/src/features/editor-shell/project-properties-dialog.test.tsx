import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ProjectPropertiesDialog } from "./project-properties-dialog";

describe("ProjectPropertiesDialog", () => {
  it("edits the name and shows the Cell and Gallery details", () => {
    const markup = renderToStaticMarkup(
      <ProjectPropertiesDialog
        name="Bandgap Reference"
        documentName="dut"
        publication={{ author: "Token Zhang", description: "  Low-noise  " }}
        onRename={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain(">Project Properties</h2>");
    expect(markup).toContain('aria-label="Project name"');
    expect(markup).toContain('autoComplete="off"');
    expect(markup).toContain('value="Bandgap Reference"');
    expect(markup).toContain("<dt>Current Cell</dt><dd>dut</dd>");
    expect(markup).toContain("<dt>Contributor</dt><dd>Token Zhang</dd>");
    expect(markup).toContain("<dt>Notes</dt><dd>Low-noise</dd>");
    expect(markup).toContain(">Cancel</button>");
    expect(markup).toContain('type="submit"');
  });

  it("names no contributor for a drawing that is not in the Gallery", () => {
    const markup = renderToStaticMarkup(
      <ProjectPropertiesDialog
        name="New Circuit"
        documentName="dut"
        publication={null}
        onRename={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(markup).not.toContain("Contributor");
    expect(markup).not.toContain("Notes");
  });
});
