import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { EditorHelpDialog } from "./editor-help-dialog";

describe("EditorHelpDialog", () => {
  it("identifies the editor, package version, and repository", () => {
    // About was a second entry saying what Help already frames, so its
    // content lives here as a section rather than in its own dialog.
    const markup = renderToStaticMarkup(
      <EditorHelpDialog closeButtonRef={{ current: null }} onClose={vi.fn()} />,
    );

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain("About Analog Canvas");
    expect(markup).toContain("Version <strong>0.1.0</strong>");
    expect(markup).toContain(
      'href="https://github.com/chenzc24/Analog-Canvas"',
    );
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noreferrer"');
  });
});
