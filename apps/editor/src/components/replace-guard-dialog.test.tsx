import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ReplaceGuardDialog } from "./replace-guard-dialog";

describe("ReplaceGuardDialog", () => {
  it("states the consequence and distinguishes Cloud Save from file export", () => {
    const html = renderToStaticMarkup(
      <ReplaceGuardDialog
        intent="Open OTA.icproj.json"
        cloudProjectLimit={7}
        saving={false}
        onCancel={vi.fn()}
        onSaveAndContinue={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    expect(html).toContain("Unsaved changes");
    expect(html).toContain("will drop your latest");
    // The copy states whatever limit it is handed, never a number of its own.
    expect(html).toContain("Cloud Projects (up to 7).");
    expect(html).toContain("Export Project File");
    expect(html).toContain("downloads <code>.icproj.json</code>");
    expect(html).toContain("Save to Cloud and continue");
    expect(html).toContain("Continue without saving");
    expect(html).toContain("Stay");
    expect(html).not.toContain("Browser recovery");
  });

  it("says in the dialog that a signed-out Save needs an account (#2155)", () => {
    const html = renderToStaticMarkup(
      <ReplaceGuardDialog
        intent="Go to Gallery"
        cloudProjectLimit={7}
        saving={false}
        problem={{ kind: "signed-out" }}
        onCancel={vi.fn()}
        onSaveAndContinue={vi.fn()}
        onDiscard={vi.fn()}
        onSignIn={vi.fn()}
        onExportAndContinue={vi.fn()}
      />,
    );
    expect(html).toContain("Saving to the Cloud needs an account");
    expect(html).toContain(">Sign in<");
    expect(html).toContain("Export and continue");
    expect(html).toContain("Stay");
    expect(html).toContain("Continue without saving");
    // The Save that cannot work is not offered again.
    expect(html).not.toContain("Save to Cloud and continue");
  });

  it("shows another failure's reason beside a Save to retry", () => {
    const html = renderToStaticMarkup(
      <ReplaceGuardDialog
        intent="Go to Gallery"
        cloudProjectLimit={7}
        saving={false}
        problem={{
          kind: "failed",
          message: "Cloud Projects unavailable; work remains local (offline)",
        }}
        onCancel={vi.fn()}
        onSaveAndContinue={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("work remains local (offline)");
    expect(html).toContain("Save to Cloud and continue");
  });

  it("disables every decision while Cloud Save is in progress", () => {
    const html = renderToStaticMarkup(
      <ReplaceGuardDialog
        intent="Create a new Project"
        cloudProjectLimit={7}
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
