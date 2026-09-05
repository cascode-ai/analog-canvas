import { useState } from "react";

import type { SchematicDocument } from "@icm/model";

export interface NewTestbenchRequest {
  readonly dutDocumentId: string;
  readonly name: string;
  readonly placeDut: boolean;
}

export function nextTestbenchCellName(
  documents: readonly SchematicDocument[],
  dutDocumentId: string,
): string {
  const dut = documents.find((document) => document.id === dutDocumentId);
  const base = `${dut?.name ?? "DUT"}_tb`;
  if (!documents.some((document) => document.name === base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}_${suffix}`;
    if (!documents.some((document) => document.name === candidate)) {
      return candidate;
    }
  }
}

/**
 * One explicit boundary between a reusable DUT Cell and an ordinary
 * testbench Cell. The dialog only collects intent; Project edits and cursor
 * placement remain owned by App and the existing hierarchy placement path.
 */
export function NewTestbenchDialog({
  documents,
  initialDutDocumentId,
  onCancel,
  onCreate,
}: {
  documents: readonly SchematicDocument[];
  initialDutDocumentId: string;
  onCancel(): void;
  onCreate(request: NewTestbenchRequest): void;
}) {
  const initialDut =
    documents.find((document) => document.id === initialDutDocumentId) ??
    documents[0];
  const [dutDocumentId, setDutDocumentId] = useState(initialDut?.id ?? "");
  const [name, setName] = useState(() =>
    nextTestbenchCellName(documents, initialDut?.id ?? ""),
  );
  const [placeDut, setPlaceDut] = useState(true);
  const dut = documents.find((document) => document.id === dutDocumentId);
  const duplicate = documents.some(
    (document) => document.name.toLowerCase() === name.trim().toLowerCase(),
  );
  const portCount = dut?.netlist?.terminals.length ?? 0;

  return (
    <div
      className="insert-dialog-backdrop"
      onPointerDown={(event) =>
        event.target === event.currentTarget && onCancel()
      }
    >
      <form
        className="editor-action-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-testbench-title"
        onSubmit={(event) => {
          event.preventDefault();
          if (!dut || !name.trim() || duplicate) return;
          onCreate({ dutDocumentId, name: name.trim(), placeDut });
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
        }}
      >
        <header className="editor-action-dialog-header">
          <p>Project hierarchy</p>
          <h2 id="new-testbench-title">New Testbench Cell</h2>
        </header>
        <div className="editor-action-dialog-body">
          <p>
            Keep the design Cell reusable, then place its Symbol View in a
            separate testbench Cell.
          </p>
          <label className="editor-action-dialog-field">
            <span>DUT Cell</span>
            <select
              autoFocus
              aria-label="DUT Cell"
              value={dutDocumentId}
              onChange={(event) => {
                const nextDutId = event.currentTarget.value;
                setDutDocumentId(nextDutId);
                setName(nextTestbenchCellName(documents, nextDutId));
              }}
            >
              {documents.map((document) => (
                <option key={document.id} value={document.id}>
                  {document.name}
                </option>
              ))}
            </select>
          </label>
          <div className="editor-action-dialog-field">
            <span>Symbol View</span>
            <strong>
              {dut?.presentation.cellSymbol ? "Reviewed" : "Auto-derived"}
            </strong>
            <small>
              {portCount} formal {portCount === 1 ? "port" : "ports"}; the
              testbench stores a reference to this Cell, not a copied symbol.
            </small>
          </div>
          <label className="editor-action-dialog-field">
            <span>Testbench Cell name</span>
            <input
              aria-label="Testbench Cell name"
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
            />
          </label>
          {duplicate ? (
            <p role="alert">A Cell with this name already exists.</p>
          ) : null}
          <label>
            <input
              type="checkbox"
              checked={placeDut}
              onChange={(event) => setPlaceDut(event.currentTarget.checked)}
            />
            Place the DUT Symbol View after creating the testbench
          </label>
        </div>
        <footer className="editor-action-dialog-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="submit"
            className="primary"
            disabled={!dut || !name.trim() || duplicate}
          >
            Create Testbench
          </button>
        </footer>
      </form>
    </div>
  );
}
