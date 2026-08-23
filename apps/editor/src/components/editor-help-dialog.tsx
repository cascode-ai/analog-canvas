import type { RefObject } from "react";

import editorPackage from "../../package.json";

const REPOSITORY_URL = "https://github.com/cascode-ai/analog-canvas";

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
            <p className="help-section-label">Introduction</p>
            <p>
              Analog Canvas is a browser-based schematic editor. Import SPICE or
              open a project, edit the circuit on the canvas, then export an
              editable project or drawing file.
            </p>
          </section>
          <nav className="help-index" aria-label="Help sections">
            <a href="#help-introduction">Introduction</a>
            <a href="#help-handbook">Handbook</a>
            <a href="#help-shortcuts">Shortcuts</a>
            <a href="#help-data">Project data</a>
          </nav>
          <section id="help-handbook" className="help-handbook">
            <p className="help-section-label">Handbook</p>
            <h3>Start, open, and save</h3>
            <p>
              Use <strong>File / Open Project</strong> to continue an exported
              project, or <strong>File / Import SPICE</strong> to create
              editable Documents from SPICE source files. Use
              <strong>File / Save Project</strong> to download an editable
              project file; use <strong>File / Export</strong> for SVG, PNG, or
              PDF drawings. Because raw browser refresh shortcuts are blocked to
              protect unsaved work, use <strong>File / Refresh app</strong>
              when you deliberately want to reload; it saves and restores the
              current recovery snapshot.
            </p>
            <h3>Place, select, and connect</h3>
            <p>
              Select a symbol in the left Library, or a drawing tool from
              <strong>Draw</strong>, then click the canvas to place or draw. On
              compact screens, Library starts folded; use the left
              <strong>Library</strong> button to open its single-column list.
              Selecting an object opens Properties on the right; it overlays the
              canvas and closes Library while compact. Choose Wire (or
              <kbd>W</kbd>), click a terminal to start, click to add bends, then
              press <kbd>Enter</kbd> to finish. <kbd>Delete</kbd> or
              <kbd>Backspace</kbd> removes the selection, or removes the latest
              wire bend while drawing.
            </p>
            <p>
              The Edit menu separates three reversible Cell operations.{" "}
              <strong>Clear Drawing</strong> removes Route and drafting geometry
              but retains logical objects. <strong>Reset Cell Placement</strong>{" "}
              returns Instances to the tray and removes Route geometry while
              retaining devices, Nets, and ports.{" "}
              <strong>Reset Cell Body</strong> removes non-interface electrical
              content while preserving the formal Cell interface. Each command
              previews its impact and can be restored with Undo.
            </p>
            <h3>Hierarchical Cells</h3>
            <p>
              Select a rectangle and press <kbd>E</kbd> to convert it into a
              hierarchical block and enter its new child Cell. Select an
              existing hierarchical block and press <kbd>E</kbd>, or
              double-click it, to enter it. Use <strong>Up</strong> or
              <kbd>Shift+E</kbd> to return to the parent Cell.
            </p>
            <h3>View and drawing tools</h3>
            <p>
              With the pointer over the canvas, use the mouse wheel to zoom and
              middle-drag to pan; <kbd>F</kbd> fits the circuit in view. Draw
              also contains Wire, Text, Arrow, Construction line, and Rectangle.
              With no rotatable selection, <kbd>R</kbd> starts Rectangle; with a
              component or drawing selected it rotates clockwise.{" "}
              <kbd>Shift+R</kbd> mirrors left/right; <kbd>Ctrl+R</kbd> mirrors
              top/bottom. <kbd>M</kbd> makes the current selection follow the
              pointer; click to place it, or press <kbd>Esc</kbd> to cancel.{" "}
              <kbd>F</kbd> always fits the circuit in view. <kbd>C</kbd> starts
              a mouse-following copy; click places it and
              <kbd>Esc</kbd> cancels.
            </p>
          </section>
          <section id="help-shortcuts" className="help-shortcuts">
            <h3>Keyboard shortcuts</h3>
            <dl>
              <div>
                <dt>File and history</dt>
                <dd>
                  <kbd>Ctrl</kbd> + <kbd>S</kbd> save; <kbd>Ctrl</kbd> +
                  <kbd>O</kbd> open; <kbd>U</kbd> undo; <kbd>Shift</kbd> +
                  <kbd>U</kbd> redo; <kbd>Ctrl</kbd> + <kbd>Z</kbd> undo;
                  <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Z</kbd> or
                  <kbd>Ctrl</kbd> + <kbd>Y</kbd> redo.
                </dd>
              </div>
              <div>
                <dt>Selection and edit</dt>
                <dd>
                  <kbd>Ctrl</kbd> + <kbd>A</kbd> selects all placed components;
                  <kbd>C</kbd> copy-place (click to place, <kbd>Esc</kbd> to
                  cancel); <kbd>M</kbd> move/stretch the current selection;
                  <kbd>R</kbd> rotate; <kbd>Shift</kbd> + <kbd>R</kbd>
                  mirror left/right; <kbd>Ctrl</kbd> + <kbd>R</kbd> mirror
                  top/bottom; <kbd>Ctrl</kbd> + <kbd>D</kbd> deselect;{" "}
                  <kbd>F</kbd> fit view;
                  <kbd>E</kbd> enter or create a hierarchical Cell;{" "}
                  <kbd>Shift</kbd> + <kbd>E</kbd> return to its parent;
                  <kbd>Delete</kbd> or <kbd>Backspace</kbd> delete.
                </dd>
              </div>
              <div>
                <dt>Tools and view</dt>
                <dd>
                  <kbd>I</kbd> insert a component; <kbd>P</kbd> place a Port;
                  <kbd>W</kbd> wire; <kbd>L</kbd> edits a selected Net Label;
                  <kbd>T</kbd> text; <kbd>A</kbd> arrow; <kbd>K</kbd>
                  construction line; <kbd>Q</kbd> Properties open/close;{" "}
                  <kbd>Home</kbd> fit view; <kbd>X</kbd> reverses a selected
                  current arrow.
                </dd>
              </div>
              <div>
                <dt>In-progress drawing</dt>
                <dd>
                  <kbd>Enter</kbd> completes an active wire or drawing;
                  <kbd>Esc</kbd> cancels the active tool or closes Help.
                </dd>
              </div>
            </dl>
            <p>Shortcuts do not run while you are typing in a text field.</p>
          </section>
          <section id="help-data" className="help-data-note">
            <h3>Project data and recovery</h3>
            <p>
              This editor runs in your browser. After each accepted edit it
              keeps a safety copy of the current Project in this browser's
              storage: at most two recent working copies, each with a current
              and a previous generation (at most 4 MB each, 12 MB in total). Use{" "}
              <strong>File / Recover recent work…</strong> to browse, restore,
              download, or delete those copies. They are not cloud storage, can
              be lost when browser data is cleared, and a reload within a
              fraction of a second of an edit may miss that last edit. Saving or
              downloading a Project never deletes the safety copies; export a
              Project file whenever you need a durable backup or want to move
              work to another device.
            </p>
          </section>
          <section>
            <h3>About Analog Canvas</h3>
            <p>
              <strong>Analog Canvas</strong> is a local-first schematic editor
              for editable circuit design.
            </p>
            <p>
              Version <strong>{editorPackage.version}</strong>
            </p>
            <p>
              <a href={REPOSITORY_URL} target="_blank" rel="noreferrer">
                {REPOSITORY_URL}
              </a>
            </p>
          </section>
        </div>
      </section>
    </div>
  );
}
