import type { RefObject } from "react";

import editorPackage from "../../package.json";

const REPOSITORY_URL = "https://github.com/cascode-ai/analog-canvas";
const CHANGE_LOG_URL = `${REPOSITORY_URL}/commits/main`;
const OWNER_URL = "https://www.tokenzhang.com";
const GETTING_STARTED_URL = `${REPOSITORY_URL}/blob/main/docs/user/getting-started.md`;
const TROUBLESHOOTING_URL = `${REPOSITORY_URL}/blob/main/docs/user/troubleshooting.md`;

export interface EditorHelpDialogProps {
  closeButtonRef: RefObject<HTMLButtonElement | null>;
  onClose(): void;
}

export function EditorHelpDialog({
  closeButtonRef,
  onClose,
}: EditorHelpDialogProps) {
  return (
    <div
      className="help-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="help-dialog"
        id="editor-help-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
      >
        <header className="help-dialog-header">
          <div>
            <p className="help-kicker">Analog Canvas</p>
            <h2 id="help-title">Help</h2>
          </div>
          <button
            type="button"
            ref={closeButtonRef}
            onClick={onClose}
            aria-label="Close help"
          >
            Close
          </button>
        </header>
        <div className="help-dialog-content">
          <section id="help-introduction" className="help-introduction">
            <p className="help-section-label">Editor help</p>
            <p>
              Use <strong>File</strong> to open, save, import, or export a
              Project. Use the Library and Draw toolbar to edit the canvas.
              Keyboard shortcuts stay hidden until you click{" "}
              <strong>Hints</strong> beside the Grid control.
            </p>
          </section>
          <section id="help-data" className="help-data-note">
            <h3>Projects and recovery</h3>
            <p>
              <strong>Save</strong> updates your private Cloud Project.
              Exporting creates a portable local copy. Browser recovery is only
              a safety copy; use <strong>File / Recover Local Work…</strong>{" "}
              after an interruption.
            </p>
          </section>
          <section className="help-about">
            <h3>About Analog Canvas</h3>
            <p>
              <strong>Analog Canvas</strong> is a local-first schematic editor
              for editable circuit design.
            </p>
            <p>
              Version <strong>{editorPackage.version}</strong>
            </p>
            <nav
              className="help-resource-links"
              aria-label="Analog Canvas resources"
            >
              <a href={GETTING_STARTED_URL} target="_blank" rel="noreferrer">
                Getting Started
              </a>
              <a href={TROUBLESHOOTING_URL} target="_blank" rel="noreferrer">
                Troubleshooting
              </a>
              <a href={REPOSITORY_URL} target="_blank" rel="noreferrer">
                Repository
              </a>
              <a href={CHANGE_LOG_URL} target="_blank" rel="noreferrer">
                Change Log
              </a>
              <a href={OWNER_URL} target="_blank" rel="noreferrer">
                Owner
              </a>
            </nav>
          </section>
        </div>
      </section>
    </div>
  );
}
