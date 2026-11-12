import { useEffect, useMemo, useRef, useState } from "react";
import {
  ComponentDefinitionSchema,
  cellSymbolArtworkIssues,
  projectCellSymbolArtwork,
  type CircuitProject,
  type ComponentDefinition,
  type ExternalSubcircuitDefinition,
  type SymbolDefinition,
} from "@icm/model";
import {
  capturedCellSymbolArtwork,
  parseCellSymbolArtworkText,
  type CellSymbolArtworkInput,
} from "@icm/edit-engine";
import { hierarchicalSymbolId, projectCellSymbolTerminals } from "@icm/symbols";

import { InlineConfirm } from "../../components/inline-confirm";
import ProjectTextEditor from "../project-code/project-text-editor";
import { SymbolArtwork } from "../component-insert/symbol-artwork";
import { DefinitionWorkspace } from "../user-components/definition-workspace";
import { CircuitPinEditor } from "../user-components/circuit-pin-editor";

export interface CellSymbolAuthoringDialogProps {
  project: CircuitProject;
  cellId: string;
  onClose(): void;
  /** Applies for every caller; returns the refusal, if any. */
  onApply(cellId: string, input: CellSymbolArtworkInput): string | undefined;
}

const artworkJson = (value: unknown) => JSON.stringify(value, null, 2);

/**
 * A Cell's Symbol view, as a User Component's: Automatic or Custom JSON
 * artwork, its preview as callers draw it, and the Pin mapping editor.
 * Customize captures the generated block; switching modes keeps the
 * inactive JSON; Apply redraws every caller on its pins.
 */
export function CellSymbolAuthoringDialog({
  project,
  cellId,
  onClose,
  onApply,
}: CellSymbolAuthoringDialogProps) {
  const cell = project.documents.find((item) => item.id === cellId);
  const stored = cell?.presentation.cellSymbol?.artwork;
  const dialogRef = useRef<HTMLElement>(null);
  const [mode, setMode] = useState<"automatic" | "custom">(
    stored ? "custom" : "automatic",
  );
  const [text, setText] = useState(stored ? artworkJson(stored) : "");
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => dialogRef.current?.focus(), []);
  useEffect(() => {
    if (!cell?.netlist) onClose();
  }, [cell, onClose]);

  const terminals = useMemo(
    () => (cell?.netlist ? projectCellSymbolTerminals(cell) : []),
    [cell],
  );
  // The Pin editor speaks the source-backed binding: the Cell is its owner.
  const owner = useMemo<ExternalSubcircuitDefinition>(
    () => ({
      id: cellId,
      name: cell?.netlist?.name ?? cellId,
      terminals: terminals.map(({ id, name, direction }) => ({
        id,
        name,
        direction,
      })),
      formalParameters: [],
      interfaceStatus: "declared",
    }),
    [cell, cellId, terminals],
  );
  const parsed = useMemo(() => {
    if (mode !== "custom" || !text) return { artwork: null, error: null };
    try {
      return { artwork: parseCellSymbolArtworkText(text), error: null };
    } catch (error) {
      return {
        artwork: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [mode, text]);
  const lastValid = useRef<SymbolDefinition | null>(null);
  if (!cell?.netlist) return null;
  const cellName = cell.netlist.name;

  const mapped = parsed.artwork && {
    symbol: parsed.artwork.symbol,
    terminals: parsed.artwork.terminals ?? [],
  };
  const component: ComponentDefinition | null = mapped
    ? {
        symbol: mapped.symbol,
        circuitBinding: { definitionId: owner.id, terminals: mapped.terminals },
      }
    : null;
  const issues = mapped ? cellSymbolArtworkIssues(mapped, terminals) : [];
  const preview = mapped
    ? (projectCellSymbolArtwork(mapped, terminals, {
        id: hierarchicalSymbolId(cellName),
        name: cell.name,
      }) ?? mapped.symbol)
    : null;
  if (preview) lastValid.current = preview;

  const chooseMode = (next: "automatic" | "custom") => {
    setMessage(null);
    setMode(next);
    // Customize starts from the generated block; inactive JSON is kept.
    if (next === "custom" && !text)
      setText(artworkJson(capturedCellSymbolArtwork(project, cellId)));
  };
  const apply = () => {
    const refusal = onApply(
      cellId,
      mode === "custom"
        ? { symbolMode: "custom", artworkText: text }
        : { symbolMode: "automatic" },
    );
    if (refusal) setMessage(refusal);
    else onClose();
  };

  return (
    <div
      className="insert-dialog-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="cell-symbol-authoring-dialog"
        role="dialog"
        data-plain-keys="local"
        aria-modal="true"
        aria-label={`${cell.name} symbol`}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.stopPropagation();
          onClose();
        }}
      >
        <header className="cell-props-header">
          <h2>{cell.name} symbol</h2>
          <button
            type="button"
            className="cell-props-close"
            aria-label="Close Cell symbol"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="component-symbol-controls">
          <label>
            Symbol mode{" "}
            <select
              aria-label="Symbol mode"
              value={mode}
              onChange={(event) =>
                chooseMode(event.currentTarget.value as typeof mode)
              }
            >
              <option value="automatic">Automatic</option>
              <option value="custom">Custom JSON</option>
            </select>
          </label>
          {mode === "automatic" ? (
            <button type="button" onClick={() => chooseMode("custom")}>
              Customize symbol
            </button>
          ) : null}
        </div>
        {mode === "custom" ? (
          <>
            <DefinitionWorkspace initialSplit={55}>
              <section className="component-definition-code">
                <ProjectTextEditor
                  ariaLabel="Cell symbol JSON"
                  language="json"
                  value={text}
                  invalid={!!parsed.error}
                  onChange={(next) => {
                    setMessage(null);
                    setText(next);
                  }}
                  onModEnter={apply}
                />
              </section>
              <section
                className="component-definition-preview"
                aria-label="Custom symbol preview"
              >
                {(preview ?? lastValid.current) ? (
                  <>
                    {!preview ? (
                      <small>Showing the last valid preview.</small>
                    ) : null}
                    <SymbolArtwork
                      fitContent
                      symbol={(preview ?? lastValid.current)!}
                      className="component-definition-artwork"
                    />
                  </>
                ) : (
                  <p>Correct the JSON to preview.</p>
                )}
              </section>
            </DefinitionWorkspace>
            {parsed.error ? <p role="status">{parsed.error}</p> : null}
            {component ? (
              <details open>
                <summary>
                  Pin mapping{issues.length ? " · incomplete" : ""}
                </summary>
                <CircuitPinEditor
                  owner={owner}
                  component={component}
                  onChange={(next) => {
                    setMessage(null);
                    const binding = ComponentDefinitionSchema.parse(next);
                    setText(
                      artworkJson({
                        symbol: binding.symbol,
                        terminals: binding.circuitBinding?.terminals ?? [],
                      }),
                    );
                  }}
                />
              </details>
            ) : null}
          </>
        ) : (
          <p className="cell-props-note">
            The block follows the Cell&apos;s Pins; size and Pin sides are set
            in Cell symbol layout.
          </p>
        )}
        {message ? (
          <p role="alert" className="cell-symbol-authoring-message">
            {message}
          </p>
        ) : null}
        <footer className="external-model-actionbar">
          <button type="button" className="primary" onClick={apply}>
            Apply symbol
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          {stored ? (
            <InlineConfirm
              confirmLabel="Reset to automatic"
              cancelLabel="Keep custom symbol"
              onConfirm={() => {
                const refusal = onApply(cellId, { symbolMode: "automatic" });
                if (refusal) setMessage(refusal);
                else onClose();
              }}
            >
              Reset to automatic…
            </InlineConfirm>
          ) : null}
        </footer>
      </section>
    </div>
  );
}
