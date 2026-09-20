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
    expect(markup).toContain("Version <strong>0.9.2</strong>");
    expect(markup).toContain(
      'href="https://github.com/cascode-ai/analog-canvas"',
    );
    expect(markup).toContain(
      'href="https://github.com/cascode-ai/analog-canvas/commits/main"',
    );
    expect(markup).toContain('href="https://www.tokenzhang.com"');
    expect(markup).toContain(
      'href="https://github.com/cascode-ai/analog-canvas/blob/main/docs/user/getting-started.md"',
    );
    expect(markup).toContain(
      'href="https://github.com/cascode-ai/analog-canvas/blob/main/docs/user/troubleshooting.md"',
    );
    expect(markup).toContain(">Change Log</a>");
    expect(markup).toContain(">Owner</a>");
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noreferrer"');
  });

  it("stays concise and leaves shortcut details to the on-canvas Hints control", () => {
    const markup = renderToStaticMarkup(
      <EditorHelpDialog closeButtonRef={{ current: null }} onClose={vi.fn()} />,
    );

    expect(markup).toContain("Hints");
    expect(markup).toContain("Projects and recovery");
    expect(markup).not.toContain("Handbook");
    expect(markup).not.toContain("Keyboard shortcuts</h3>");
    expect(markup).not.toContain("<kbd>");
    expect(markup).not.toContain("help-shortcut");
  });
});
