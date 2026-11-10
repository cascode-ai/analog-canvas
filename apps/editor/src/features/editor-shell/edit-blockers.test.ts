import { describe, expect, it } from "vitest";
import {
  discardableHoldReason,
  editInProgressReason,
  projectHoldReason,
} from "./edit-blockers";

const idle = {
  componentEditor: false,
  documentSettingsDraft: false,
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
      projectHoldReason({ ...idle, saving: true, documentSettingsDraft: true }),
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

  it("holds a Project for a Document settings draft, never for the panel alone (#2180)", () => {
    // Opened unedited, or edited validly (applied at once): nothing to keep.
    expect(projectHoldReason(idle)).toBeNull();
    expect(discardableHoldReason(idle)).toBeNull();
    // An invalid or refused edit is not applied: the tab strip offers to
    // drop it beside the action.
    const draft = { ...idle, documentSettingsDraft: true };
    expect(projectHoldReason(draft)).toBe(
      "Document settings hold a draft that is not applied",
    );
    expect(discardableHoldReason(draft)).toBe(
      "Document settings hold a draft that is not applied",
    );
    // Dropping it would not free the Project while something else holds it.
    expect(discardableHoldReason({ ...draft, saving: true })).toBeNull();
    expect(
      discardableHoldReason({ ...draft, codeDraftDirty: true }),
    ).toBeNull();
  });
});
