import { useEffect, useRef, useState } from "react";

export interface ProjectPropertiesDialogProps {
  name: string;
  /** The Cell on screen. */
  documentName: string;
  /** Who published this drawing to the Gallery, when it has an entry. */
  publication: { author: string; description: string } | null;
  onRename(name: string): void;
  onClose(): void;
}

/**
 * File → Project Properties…: the project's name and details, kept out of
 * the File menu so the menu holds commands only. OK or Enter applies a new
 * name; Cancel, Escape or a click outside leaves the name as it was.
 */
export function ProjectPropertiesDialog({
  name,
  documentName,
  publication,
  onRename,
  onClose,
}: ProjectPropertiesDialogProps) {
  const [draft, setDraft] = useState(name);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, []);
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
        className="project-properties-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-properties-title"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
      >
        <h2 id="project-properties-title">Project Properties</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const next = draft.trim();
            if (next && next !== name) onRename(next);
            onClose();
          }}
        >
          <label className="project-properties-name">
            <span>Name</span>
            <input
              ref={input}
              aria-label="Project name"
              autoComplete="off"
              value={draft}
              onChange={(event) => setDraft(event.currentTarget.value)}
            />
          </label>
          <dl className="project-properties-details">
            <div>
              <dt>Current Cell</dt>
              <dd>{documentName}</dd>
            </div>
            {publication ? (
              <>
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
              </>
            ) : null}
          </dl>
          <div className="project-properties-actions">
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="project-properties-ok"
              disabled={!draft.trim()}
            >
              OK
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
