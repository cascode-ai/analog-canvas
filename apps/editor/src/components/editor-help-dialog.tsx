import type { RefObject } from "react";

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
            <p className="help-kicker">Interactive Circuit Maker</p>
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
              Interactive Circuit Maker is a browser-based schematic editor.
              Import SPICE or open a project, edit the circuit on the canvas,
              then export an editable project or drawing file.
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
              PDF drawings.
            </p>
            <h3>Place, select, and connect</h3>
            <p>
              Click a starter or recent chip in the left{" "}
              <strong>Library</strong>
              column for quick placement defaults, or press <kbd>I</kbd> / use{" "}
              <strong>Insert</strong> at the bottom of that column for the full
              library with parameters. Drawing tools live on the left tool rail
              and in the
              <strong>Draw</strong> menu. Select objects to move them; open
              Properties with <kbd>Q</kbd> or by double-clicking a device.
              Choose Wire (or <kbd>W</kbd>), click a terminal to start, click to
              add bends, then press
              <kbd>Enter</kbd> to finish. <kbd>Delete</kbd> or
              <kbd>Backspace</kbd> removes the selection, or removes the latest
              wire bend while drawing.
            </p>
            <h3>View and drawing tools</h3>
            <p>
              With the pointer over the canvas, use the mouse wheel to zoom and
              middle-drag to pan; <kbd>F</kbd> fits the circuit in view. The
              left rail is the primary Draw home; the <strong>Draw</strong>
              menu mirrors Wire, Text, Arrow, Construction line, and Rectangle.
              With no rotatable selection, <kbd>R</kbd> starts Rectangle; with a
              component or drawing selected it rotates clockwise.{" "}
              <kbd>Shift+R</kbd> mirrors left/right; <kbd>Shift+V</kbd> mirrors
              top/bottom. <kbd>F</kbd> always fits the circuit in view. Guides
              are available from More and can be shown, cleared, or locked for
              alignment. <kbd>C</kbd> starts a mouse-following copy; click
              places it and <kbd>Esc</kbd> cancels.
            </p>
          </section>
          <section id="help-shortcuts" className="help-shortcuts">
            <h3>Keyboard shortcuts</h3>
            <p className="help-quick-ref">
              <strong>Quick reference:</strong> <kbd>I</kbd> insert ·{" "}
              <kbd>C</kbd> copy · <kbd>R</kbd> rotate · <kbd>W</kbd> wire ·{" "}
              <kbd>G</kbd> guide · <kbd>Home</kbd> fit · wheel zoom ·
              middle-drag pan · <kbd>Enter</kbd> finish
            </p>
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
                  cancel); <kbd>R</kbd> rotate; <kbd>Shift</kbd> + <kbd>R</kbd>
                  mirror left/right; <kbd>Shift</kbd> + <kbd>V</kbd> mirror
                  top/bottom; <kbd>F</kbd> fit view;
                  <kbd>Delete</kbd> or <kbd>Backspace</kbd> delete.
                </dd>
              </div>
              <div>
                <dt>Tools and view</dt>
                <dd>
                  <kbd>W</kbd> wire; <kbd>L</kbd> edits a selected Net Label;
                  <kbd>T</kbd> text; <kbd>A</kbd> arrow; <kbd>P</kbd>
                  construction line; <kbd>Q</kbd> Properties; <kbd>G</kbd>{" "}
                  guide;
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
              This editor runs in your browser. Recovery data may be kept on
              this device, but it is not cloud storage and can be lost when
              browser data is cleared. Export a project file whenever you need a
              durable backup or want to move work to another device.
            </p>
          </section>
        </div>
      </section>
    </div>
  );
}
