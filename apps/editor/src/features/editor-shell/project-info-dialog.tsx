import { useEffect, useRef } from "react";

export interface ProjectInfoDialogProps {
  name: string;
  /** The Cell on screen. */
  documentName: string;
  /** Who published this drawing to the Gallery, when it has an entry. */
  publication: { author: string; description: string } | null;
  onClose(): void;
}

/** Read-only project facts. Project names are edited in their tabs. */
export function ProjectInfoDialog({
  name,
  documentName,
  publication,
  onClose,
}: ProjectInfoDialogProps) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement;
    close.current?.focus({ preventScroll: true });
    return () => {
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus({ preventScroll: true });
    };
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
        className="project-info-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-info-title"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          } else if (event.key === "Tab") {
            event.preventDefault();
            close.current?.focus();
          }
        }}
      >
        <h2 id="project-info-title">Project Info</h2>
        <dl className="project-info-details">
          <div>
            <dt>Name</dt>
            <dd>{name}</dd>
          </div>
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
        <div className="project-info-actions">
          <button ref={close} type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </section>
    </div>
  );
}
