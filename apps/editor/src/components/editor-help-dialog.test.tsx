import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { EditorHelpDialog } from "./editor-help-dialog";

describe("EditorHelpDialog", () => {
  it("identifies the editor, package version, and project resources", () => {
    // About was a second entry saying what Help already frames, so its
    // content lives here as a section rather than in its own dialog.
    const markup = renderToStaticMarkup(
      <EditorHelpDialog closeButtonRef={{ current: null }} onClose={vi.fn()} />,
    );

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain("About Analog Canvas");
    expect(markup).toContain("Version <strong>0.1.0</strong>");
    expect(markup).toContain(
      'href="https://github.com/cascode-ai/analog-canvas"',
    );
    expect(markup).toContain(
      'href="https://github.com/cascode-ai/analog-canvas/commits/main"',
    );
    expect(markup).toContain('href="https://www.tokenzhang.com"');
    expect(markup).toContain(">Change Log</a>");
    expect(markup).toContain(">Owner</a>");
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noreferrer"');
  });

  it("presents the focused shortcut set as scannable grouped rows", () => {
    const markup = renderToStaticMarkup(
      <EditorHelpDialog closeButtonRef={{ current: null }} onClose={vi.fn()} />,
    );
    const shortcuts = markup.slice(
      markup.indexOf('id="help-shortcuts"'),
      markup.indexOf('id="help-data"'),
    );

    expect(shortcuts).toContain("Create");
    expect(shortcuts).toContain("Edit");
    expect(shortcuts).toContain("Workspace");
    expect(shortcuts.match(/class="help-shortcut-item"/gu)).toHaveLength(12);
    for (const key of ["I", "P", "W", "T", "Q", "U", "C", "R", "F"]) {
      expect(shortcuts).toContain(`>${key}</kbd>`);
    }
    expect(shortcuts).toContain("Mirror left / right");
    expect(shortcuts).toContain("Mirror top / bottom");
    expect(shortcuts).not.toContain("File and history");
    expect(shortcuts).not.toContain("Select all placed components");
  });

  it("describes explicit Cell authoring without a rectangle conversion", () => {
    const markup = renderToStaticMarkup(
      <EditorHelpDialog closeButtonRef={{ current: null }} onClose={vi.fn()} />,
    );

    expect(markup).toContain("Manage Cells…");
    expect(markup).toContain("Place Cell");
    expect(markup).toContain("Select a hierarchical block");
    expect(markup).not.toContain("Select a rectangle");
    expect(markup).not.toContain("convert it into a hierarchical block");
    expect(markup).toContain("Cell and <strong>Place Cell</strong>");
    expect(markup).toContain("Up</strong> or <kbd>Shift+E</kbd>");
  });

  it("keeps prose separated from inline emphasis and shortcut keys", () => {
    const markup = renderToStaticMarkup(
      <EditorHelpDialog closeButtonRef={{ current: null }} onClose={vi.fn()} />,
    );

    for (const boundary of [
      "inputs. Use <strong>File / Save</strong>",
      "File / Refresh app</strong> when",
      "tool from <strong>Draw</strong>",
      "the left <strong>Library</strong>",
      "Wire (or <kbd>W</kbd>)",
      "Delete</kbd> or <kbd>Backspace</kbd>",
      "places it and <kbd>Esc</kbd>",
      "Cell and <strong>Place Cell</strong>",
      "Up</strong> or <kbd>Shift+E</kbd>",
    ]) {
      expect(markup).toContain(boundary);
    }
  });
});
