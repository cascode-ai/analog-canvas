import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ReplaceGuardDialog } from "./replace-guard-dialog";

describe("ReplaceGuardDialog", () => {
  it("states the consequence and distinguishes Cloud Save from file export", () => {
    const html = renderToStaticMarkup(
      <ReplaceGuardDialog
        intent="Open OTA.icproj.json"
        saving={false}
        onCancel={vi.fn()}
        onSaveAndContinue={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    expect(html).toContain("Unsaved changes");
    expect(html).toContain("your latest changes will not be saved");
    expect(html).toContain("Cloud Projects (up to 3)");
    expect(html).toContain("Export Project File");
    expect(html).toContain(".icproj.json");
    expect(html).toContain("Save to Cloud and continue");
    expect(html).toContain("Continue without saving");
    expect(html).toContain("Stay");
    expect(html).not.toContain("Browser recovery");
  });

  it("disables every decision while Cloud Save is in progress", () => {
    const html = renderToStaticMarkup(
      <ReplaceGuardDialog
        intent="Create a new Project"
        saving={true}
        onCancel={vi.fn()}
        onSaveAndContinue={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    expect(html).toContain("Saving to Cloud…");
    expect(html).toContain("disabled");
  });
});
