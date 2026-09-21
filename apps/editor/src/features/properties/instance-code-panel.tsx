import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CircuitProject } from "@icm/model";
import type { ProjectStructureEdit } from "@icm/edit-engine";
import { formatInstanceCode, planInstanceCode } from "./instance-code";

export function InstanceCodePanel({
  project,
  onDirtyChange,
  onApply,
}: {
  onDirtyChange?(dirty: boolean): void;
  project: CircuitProject;
  onApply(edits: ProjectStructureEdit[]): boolean;
}) {
  const baseline = useMemo(() => formatInstanceCode(project), [project]);
  const [draft, setDraft] = useState(baseline);
  const [error, setError] = useState<string | null>(null);
  const ownEdit = useRef(false);
  useLayoutEffect(() => {
    onDirtyChange?.(error !== null);
    return () => onDirtyChange?.(false);
  }, [error, onDirtyChange]);
  useLayoutEffect(() => {
    // Preserve pasted subsets, whitespace and caret after our own commit.
    // External edits and project undo/redo replace the displayed baseline.
    if (!ownEdit.current) setDraft(baseline);
    ownEdit.current = false;
    setError(null);
  }, [baseline]);
  function change(text: string) {
    setDraft(text);
    const plan = planInstanceCode(project, text);
    if (!plan.ok) {
      setError(plan.message);
      return;
    }
    if (!plan.edits.length) {
      setError(null);
      return;
    }
    if (!onApply(plan.edits)) {
      setError(
        "Edit rejected. See the status message; no changes were applied.",
      );
      return;
    }
    ownEdit.current = true;
    setError(null);
  }
  return (
    <section className="netlist-profile-code" aria-label="Instance code">
      <h2>Instances</h2>
      <p>
        Edit or paste JSON to update the circuit. Keys are Cell and instance
        IDs; symbol is read-only. Omitted instances stay unchanged. Removing a
        parameter clears it.
      </p>
      <textarea
        aria-label="Instance JSON"
        value={draft}
        onChange={(event) => change(event.currentTarget.value)}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        wrap="off"
        aria-invalid={!!error}
      />
      {error ? (
        <p role="alert">{error} The circuit keeps the last valid edit.</p>
      ) : null}
    </section>
  );
}
