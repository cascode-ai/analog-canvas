import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CircuitProject } from "@icm/model";

import { formatProjectCode, validateProjectCode } from "./project-code";

export interface ProjectCodeApplyOutcome {
  ok: boolean;
  message?: string;
}

/** Complete Project JSON, kept separate from per-object Properties. */
export function ProjectCodePanel({
  project,
  onApply,
}: {
  project: CircuitProject;
  onApply(source: string, baseline: string): ProjectCodeApplyOutcome;
}) {
  const baseline = useMemo(() => formatProjectCode(project), [project]);
  const [draft, setDraft] = useState(baseline);
  const [editBaseline, setEditBaseline] = useState(baseline);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ownApply = useRef(false);

  useLayoutEffect(() => {
    if (!dirty || ownApply.current) {
      ownApply.current = false;
      setDraft(baseline);
      setEditBaseline(baseline);
      setDirty(false);
      setError(null);
    }
  }, [baseline, dirty]);

  const changedOutsideDraft = dirty && editBaseline !== baseline;
  const parsed = validateProjectCode(draft, project.id);

  function change(source: string): void {
    if (!dirty) setEditBaseline(baseline);
    setDraft(source);
    setDirty(source !== baseline);
    const next = validateProjectCode(source, project.id);
    setError(next.ok ? null : next.message);
  }

  function apply(): void {
    const current = validateProjectCode(draft, project.id);
    if (!current.ok) {
      setError(current.message);
      return;
    }
    if (changedOutsideDraft) {
      setError(
        "The canvas or Agent changed this Project while you were editing. Reload the live code before applying.",
      );
      return;
    }
    const outcome = onApply(draft, editBaseline);
    if (!outcome.ok) {
      setError(outcome.message ?? "The Project edit was rejected");
      return;
    }
    ownApply.current = true;
    setDraft(baseline);
    setEditBaseline(baseline);
    setDirty(false);
    setError(null);
  }

  function reload(): void {
    setDraft(baseline);
    setEditBaseline(baseline);
    setDirty(false);
    setError(null);
  }

  return (
    <section className="project-code-panel" aria-label="Project Code">
      <div className="project-code-heading">
        <div>
          <h2>Project Code</h2>
          <p>
            Complete <code>.icproj.json</code>. Canvas and Agent edits appear
            here automatically.
          </p>
        </div>
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
      </div>
      <textarea
        aria-label="Project code"
        value={draft}
        onChange={(event) => change(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            apply();
          }
        }}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        wrap="off"
        aria-invalid={!!error || changedOutsideDraft}
      />
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
