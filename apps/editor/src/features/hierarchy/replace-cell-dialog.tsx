import { useEffect, useRef, useState } from "react";
import { projectCellInterface, type CircuitProject } from "@icm/model";

import {
  cellUses,
  replacementCandidates,
  type CellUse,
} from "./hierarchy-refactor";

/**
 * Switch an instance, or every instance of its Cell, to another Cell with the
 * same Pins. Cells that differ, or would contain themselves, are listed with
 * the reason they cannot be chosen.
 */
export function ReplaceCellDialog({
  project,
  use,
  onCancel,
  onReplace,
}: {
  project: CircuitProject;
  use: CellUse;
  onCancel(): void;
  onReplace(uses: CellUse[], replacementId: string): void;
}) {
  const [scope, setScope] = useState<"one" | "all">("one");
  const [filter, setFilter] = useState("");
  const [choice, setChoice] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => dialogRef.current?.focus(), []);
  const parent = project.documents.find((cell) => cell.id === use.documentId);
  const instance = parent?.instances.find((item) => item.id === use.instanceId);
  const binding = instance?.netlist?.binding;
  const source =
    binding?.kind === "subcircuit"
      ? project.documents.find((cell) => cell.id === binding.childDocumentId)
      : undefined;
  if (!parent || !instance || !source?.netlist) return null;

  const everywhere = cellUses(project, source.id);
  const uses = scope === "all" ? everywhere : [use];
  const query = filter.trim().toLowerCase();
  const candidates = replacementCandidates(project, uses, source.id)
    .filter(({ cell }) => cell.name.toLowerCase().includes(query))
    .sort(
      (a, b) =>
        Number(Boolean(a.issue)) - Number(Boolean(b.issue)) ||
        a.cell.name.localeCompare(b.cell.name),
    );
  const chosen = candidates.find(
    (item) => item.cell.id === choice && !item.issue,
  );
  const pins = projectCellInterface(source.netlist)
    .ports.map((port) => port.name)
    .join(", ");
  const reference = instance.reference ?? instance.id;

  return (
    <div
      className="insert-dialog-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      <section
        ref={dialogRef}
        tabIndex={-1}
        className="editor-action-dialog replace-cell-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="replace-cell-title"
      >
        <header className="editor-action-dialog-header">
          <h2 id="replace-cell-title">Replace {source.name}</h2>
          <p className="replace-cell-pins">Cells with the Pins {pins}</p>
        </header>
        <div className="editor-action-dialog-body">
          <div
            className="replace-cell-scope"
            role="radiogroup"
            aria-label="Replace where"
          >
            <label>
              <input
                type="radio"
                name="replace-scope"
                checked={scope === "one"}
                onChange={() => {
                  setScope("one");
                  setChoice(null);
                }}
              />
              Only {reference} in {parent.name}
            </label>
            <label>
              <input
                type="radio"
                name="replace-scope"
                checked={scope === "all"}
                disabled={everywhere.length < 2}
                onChange={() => {
                  setScope("all");
                  setChoice(null);
                }}
              />
              All {everywhere.length} instances of {source.name}
            </label>
          </div>
          <input
            type="search"
            className="replace-cell-filter"
            aria-label="Filter Cells"
            placeholder="Filter Cells"
            value={filter}
            onChange={(event) => setFilter(event.currentTarget.value)}
          />
          <div
            className="replace-cell-list"
            role="listbox"
            aria-label="Replacement Cells"
          >
            {candidates.map(({ cell, issue }) => (
              <button
                key={cell.id}
                type="button"
                role="option"
                aria-selected={cell.id === choice}
                disabled={Boolean(issue)}
                title={issue}
                onClick={() => setChoice(cell.id)}
                onDoubleClick={() => {
                  if (!issue) onReplace(uses, cell.id);
                }}
              >
                <span>{cell.name}</span>
                <small>{issue ?? "Same Pins"}</small>
              </button>
            ))}
          </div>
          {!candidates.some((item) => !item.issue) ? (
            <p>
              No other Cell has these Pins. Make unique copy gives this instance
              its own Cell to change instead.
            </p>
          ) : null}
        </div>
        <footer className="editor-action-dialog-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            disabled={!chosen}
            onClick={() => {
              if (chosen) onReplace(uses, chosen.cell.id);
            }}
          >
            Replace
          </button>
        </footer>
      </section>
    </div>
  );
}
