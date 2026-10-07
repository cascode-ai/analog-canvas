import { useEffect, useRef, useState } from "react";

export interface ProjectInfoDialogProps {
  name: string;
  /** The Cell on screen. */
  documentName: string;
  /** Who published this drawing to the Gallery, when it has an entry. */
  publication: { author: string; description: string } | null;
  /**
   * Saves the circuit's and the Cell's names as one undoable edit; false
   * keeps the dialog open.
   */
  onSave(names: { name: string; cellName: string }): boolean;
  onClose(): void;
}

/**
 * The circuit's name and the Cell on screen, edited here as in the project
 * tabs. A Gallery contributor and notes belong to the Gallery entry and are
 * only shown.
 */
export function ProjectInfoDialog({
  name,
  documentName,
  publication,
  onSave,
  onClose,
}: ProjectInfoDialogProps) {
  const dialog = useRef<HTMLElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState({ name, cellName: documentName });
  useEffect(() => {
    const previousFocus = document.activeElement;
    nameInput.current?.focus({ preventScroll: true });
    nameInput.current?.select();
    return () => {
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus({ preventScroll: true });
    };
  }, []);
  const valid = draft.name.trim() !== "" && draft.cellName.trim() !== "";
  const changed =
    draft.name.trim() !== name || draft.cellName.trim() !== documentName;
  const author = publication?.author.trim() ?? "";
  const notes = publication?.description.trim() ?? "";
  return (
    <div
      className="help-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialog}
        className="project-info-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-info-title"
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          } else if (event.key === "Tab") {
            // Focus stays inside the dialog.
            const stops = [
              ...dialog.current!.querySelectorAll<HTMLElement>(
                "input, button:not(:disabled)",
              ),
            ];
            const at = stops.indexOf(document.activeElement as HTMLElement);
            const next =
              stops[
                (at + (event.shiftKey ? -1 : 1) + stops.length) % stops.length
              ];
            event.preventDefault();
            next?.focus();
          }
        }}
      >
        <h2 id="project-info-title">Project Info</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid) return;
            if (!changed || onSave(draft)) onClose();
          }}
        >
          <div className="project-info-details">
            <label>
              <span>Name</span>
              <input
                ref={nameInput}
                value={draft.name}
                maxLength={120}
                autoComplete="off"
                onChange={(event) => {
                  const name = event.currentTarget.value;
                  setDraft((current) => ({ ...current, name }));
                }}
              />
            </label>
            <label>
              <span>Current Cell</span>
              <input
                value={draft.cellName}
                maxLength={128}
                autoComplete="off"
                onChange={(event) => {
                  const cellName = event.currentTarget.value;
                  setDraft((current) => ({ ...current, cellName }));
                }}
              />
            </label>
            {publication ? (
              <dl>
                <div>
                  <dt>Contributor</dt>
                  <dd>{author || "Unknown contributor"}</dd>
                </div>
                {notes ? (
                  <div>
                    <dt>Notes</dt>
                    <dd>{notes}</dd>
                  </div>
                ) : null}
              </dl>
            ) : null}
          </div>
          <div className="project-info-actions">
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="primary"
              disabled={!valid || !changed}
            >
              Save
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
