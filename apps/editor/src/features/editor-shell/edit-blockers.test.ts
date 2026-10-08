import { describe, expect, it } from "vitest";
import { editInProgressReason, projectHoldReason } from "./edit-blockers";

const idle = {
  componentEditor: false,
  documentSettingsOpen: false,
  projectInfoOpen: false,
  projectNameEditing: false,
  textEditing: false,
  textOnScreen: false,
  codeDraftDirty: false,
  saving: false,
  replaceGuard: false,
  recoveryDialogOpen: false,
  publishGalleryOpen: false,
  versionHistoryOpen: false,
};

describe("edit blockers (#1462)", () => {
  it("names what holds the Project, a save or dialog before an edit", () => {
    expect(projectHoldReason(idle)).toBeNull();
    expect(
      projectHoldReason({ ...idle, saving: true, projectInfoOpen: true }),
    ).toBe("a save is still running");
    expect(projectHoldReason({ ...idle, codeDraftDirty: true })).toBe(
      "a code panel holds a draft that is not applied",
    );
  });

  it("waits for a text edit only while its label is on screen", () => {
    // A text edit whose label is gone could never be finished: nothing
    // waits for it.
    expect(editInProgressReason({ ...idle, textEditing: true })).toBeNull();
    expect(
      editInProgressReason({ ...idle, textEditing: true, textOnScreen: true }),
    ).toBe("a label's text is being edited on the canvas");
  });
});
