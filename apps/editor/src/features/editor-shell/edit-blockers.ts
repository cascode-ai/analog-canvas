/** The edits in progress that keep the editor on its Project (#1462). */
export interface EditInProgress {
  componentEditor: boolean;
  documentSettingsOpen: boolean;
  projectInfoOpen: boolean;
  projectNameEditing: boolean;
  /** A canvas text edit, and whether its label is on screen to finish. */
  textEditing: boolean;
  textOnScreen: boolean;
  codeDraftDirty: boolean;
}

/** What else holds the Project: a save, or a dialog about it. */
export interface ProjectHeld extends EditInProgress {
  saving: boolean;
  replaceGuard: boolean;
  recoveryDialogOpen: boolean;
  publishGalleryOpen: boolean;
  versionHistoryOpen: boolean;
}

const first = (reasons: readonly (readonly [boolean, string])[]) =>
  reasons.find(([active]) => active)?.[1] ?? null;

/**
 * The edit a save, a close or a Project switch waits for, in words a person
 * and an Agent can act on, or null. A text edit counts only while its label
 * is on screen: one nobody can see could never be finished, and kept every
 * switch refused.
 */
export function editInProgressReason(state: EditInProgress): string | null {
  return first([
    [state.componentEditor, "the component editor is open"],
    [state.documentSettingsOpen, "Document settings are open"],
    [state.projectInfoOpen, "Project Info is open"],
    [state.projectNameEditing, "the Project's name is being edited on its tab"],
    [
      state.textEditing && state.textOnScreen,
      "a label's text is being edited on the canvas",
    ],
    [state.codeDraftDirty, "a code panel holds a draft that is not applied"],
  ]);
}

/** What keeps the editor from leaving its Project now, or null. */
export function projectHoldReason(state: ProjectHeld): string | null {
  return (
    first([
      [state.saving, "a save is still running"],
      [
        state.replaceGuard,
        "a dialog asks whether to save before replacing the Project",
      ],
      [state.recoveryDialogOpen, "the recovery dialog is open"],
      [state.publishGalleryOpen, "the Publish to Gallery dialog is open"],
      [state.versionHistoryOpen, "Version history is open"],
    ]) ?? editInProgressReason(state)
  );
}
