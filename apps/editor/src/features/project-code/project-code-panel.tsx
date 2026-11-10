import { lazy, Suspense, useMemo, useState } from "react";
import type { CircuitProject } from "@icm/model";

import { useAuthoringDocument } from "../user-components/use-authoring-document";
import type { CodeDraftDocument } from "./held-code-draft";
import { formatProjectCode, planProjectCodeCommit } from "./project-code";
import { projectCodeInstanceRanges } from "./project-code-ranges";
import { createProjectCodeReader } from "./project-code-reader";

const ProjectTextEditor = lazy(() => import("./project-text-editor"));

export interface ProjectCodeApplyOutcome {
  ok: boolean;
  message?: string;
}

/** Complete Project JSON, kept separate from per-object Properties. */
export function ProjectCodePanel({
  project,
  selection,
  serializeProject = formatProjectCode,
  draftDocument,
  onApply,
}: {
  /**
   * Where the unapplied draft lives: the editor's, so closing the panel keeps
   * it (#2201). Left out, the panel keeps one of its own.
   */
  draftDocument?: CodeDraftDocument | undefined;
  project: CircuitProject;
  /** The session's canonical serializer; validation still belongs to the reader. */
  serializeProject?: typeof formatProjectCode;
  /** Parts selected on the canvas, whose whole JSON the code lights. */
  selection?: { documentId: string; instanceIds: readonly string[] };
  onApply(
    source: string,
    baseline: string,
    planners: {
      formatProjectCode: typeof formatProjectCode;
      planProjectCodeCommit: typeof planProjectCodeCommit;
    },
  ): ProjectCodeApplyOutcome;
}) {
  const reader = useMemo(
    () => createProjectCodeReader(project, serializeProject),
    [project, serializeProject],
  );
  const baseline = reader.baseline;
  // Without a draft the code is the live Project.
  const { document: heldDraft, value: held } = useAuthoringDocument(
    () => null,
    draftDocument,
  );
  const draft = held?.text ?? baseline;
  const editBaseline = held?.base ?? baseline;
  const dirty = held !== null;
  const [applyError, setApplyError] = useState<string | null>(null);

  const selectionKey = selection
    ? `${selection.documentId}\u0000${selection.instanceIds.join("\u0000")}`
    : "";
  const highlightedRanges = useMemo(
    () =>
      selection
        ? projectCodeInstanceRanges(
            draft,
            selection.documentId,
            selection.instanceIds,
          )
        : [],
    // The selection is read through its key; a new array of the same ids
    // is the same selection.
    [draft, selectionKey],
  );

  const changedOutsideDraft = dirty && editBaseline !== baseline;
  const parsed = reader.validate(draft);
  const error = applyError ?? (parsed.ok ? null : parsed.message);

  function change(source: string): void {
    heldDraft.set(
      source === baseline ? null : { text: source, base: editBaseline },
    );
    setApplyError(null);
  }

  function apply(): void {
    if (!parsed.ok) return;
    if (changedOutsideDraft) {
      setApplyError(
        "The canvas or Agent changed this Project while you were editing. Reload the live code before applying.",
      );
      return;
    }
    const outcome = onApply(draft, editBaseline, {
      formatProjectCode: serializeProject,
      planProjectCodeCommit,
    });
    if (!outcome.ok) {
      setApplyError(outcome.message ?? "The Project edit was rejected");
      return;
    }
    // The Project holds the draft now; its code replaces the text.
    heldDraft.set(null);
    setApplyError(null);
  }

  function reload(): void {
    heldDraft.set(null);
    setApplyError(null);
  }

  return (
    <section className="project-code-panel" aria-label="Project Code">
      <div className="project-code-actions">
        <button type="button" onClick={reload} disabled={!dirty}>
          Reload
        </button>
        <button
          type="button"
          className="primary"
          onClick={apply}
          disabled={!dirty || !parsed.ok || changedOutsideDraft}
        >
          Apply
        </button>
      </div>
      <Suspense
        fallback={
          <textarea
            aria-label="Loading Project code editor"
            value={draft}
            readOnly
          />
        }
      >
        <ProjectTextEditor
          ariaLabel="Project code"
          language="json"
          value={draft}
          invalid={!!error || changedOutsideDraft}
          onChange={change}
          onModEnter={apply}
          highlightedRanges={highlightedRanges}
          revealHighlight={selectionKey}
        />
      </Suspense>
      {changedOutsideDraft ? (
        <p role="alert">
          The live Project changed. Reload before applying so an Agent or canvas
          edit is not overwritten.
        </p>
      ) : error ? (
        <p role="alert">{error}</p>
      ) : dirty ? (
        <p role="status">Valid Project JSON · Apply or press Ctrl/⌘ + Enter.</p>
      ) : (
        <p role="status">Showing the current complete Project.</p>
      )}
    </section>
  );
}
