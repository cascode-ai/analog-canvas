/** The edits in progress that keep the editor on its Project (#1462). */
export interface EditInProgress {
  componentEditor: boolean;
  /**
   * Document settings hold a draft that is not applied: invalid code, or an
   * edit the Project refused. Settings merely open hold nothing, since every
   * valid edit applies at once (#2180).
   */
  documentSettingsDraft: boolean;
  projectNameEditing: boolean;
  /** A canvas text edit, and whether its label is on screen to finish. */
  textEditing: boolean;
  textOnScreen: boolean;
  /** An open code panel (Testbench, Instances) holds a draft of its own. */
  codeDraftDirty: boolean;
  /**
   * The Netlist or Project Code draft, held by the editor so it outlives its
   * panel (#2193, #2201): it holds the Project even with the panel closed.
   */
  netlistDraft: boolean;
  projectCodeDraft: boolean;
}

/** A draft the tab strip can drop beside a Project switch (#2180). */
export type DiscardableDraft = "document-settings" | "netlist" | "project-code";

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
    [
      state.documentSettingsDraft,
      "Document settings hold a draft that is not applied",
    ],
    [state.projectNameEditing, "the Project's name is being edited on its tab"],
    [
      state.textEditing && state.textOnScreen,
      "a label's text is being edited on the canvas",
    ],
    [state.codeDraftDirty, "a code panel holds a draft that is not applied"],
    [state.netlistDraft, "the Netlist holds a draft that is not applied"],
    [state.projectCodeDraft, "Project Code holds a draft that is not applied"],
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

/**
 * The hold a person can drop where they asked for a Project switch, and the
 * drafts dropping it discards, or null: a Document settings, Netlist or
 * Project Code draft, when nothing else holds the Project (#2180). Other
 * holds finish where they are, or have their own dialog.
 */
export function discardableHold(
  state: ProjectHeld,
): { reason: string; drafts: DiscardableDraft[] } | null {
  const drafts = (
    [
      [state.documentSettingsDraft, "document-settings"],
      [state.netlistDraft, "netlist"],
      [state.projectCodeDraft, "project-code"],
    ] as const
  ).flatMap(([held, draft]) => (held ? [draft] : []));
  if (!drafts.length) return null;
  const reason = projectHoldReason(state);
  const rest = projectHoldReason({
    ...state,
    documentSettingsDraft: false,
    netlistDraft: false,
    projectCodeDraft: false,
  });
  return reason && rest === null ? { reason, drafts } : null;
}
