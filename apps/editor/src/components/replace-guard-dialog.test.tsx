import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ReplaceGuardDialog } from "./replace-guard-dialog";

describe("ReplaceGuardDialog", () => {
  it("offers save, discard, and cancellation without treating recovery as a save", () => {
    const html = renderToStaticMarkup(
      <ReplaceGuardDialog
        intent="Open OTA.icproj.json"
        saving={false}
        recoveryProtected={true}
        onCancel={vi.fn()}
        onSaveAndContinue={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    expect(html).toContain("Save and continue");
    expect(html).toContain("Discard and continue");
    expect(html).toContain("Discard removes this working copy");
    expect(html).toContain("Cancel (keep editing)");
    expect(html).toContain("Cloud Project is the formal saved copy");
    expect(html).not.toContain("authoritative copy");
    expect(html).not.toContain("Download current Project");
  });

  it("warns when the outgoing recovery copy could not be confirmed", () => {
    const html = renderToStaticMarkup(
      <ReplaceGuardDialog
        intent="Create a new Project"
        saving={true}
        recoveryProtected={false}
        onCancel={vi.fn()}
        onSaveAndContinue={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    expect(html).toContain("could not be confirmed");
    expect(html).toContain("Saving…");
    expect(html).toContain("disabled");
  });
});
