import { useEffect, useMemo, useRef, useState } from "react";

import { displayableInstanceValue } from "@icm/derived";
import type { SymbolDefinition } from "@icm/symbols";

import {
  componentParameters,
  initialComponentParameterValues,
} from "./component-parameters";
import {
  annotationDrawingTool,
  annotationPolarity,
} from "./annotation-preview-symbols";
import {
  componentCatalog,
  libraryDescription,
  libraryDisplayName,
} from "./symbol-catalog";
import type { ComponentInsertRequest } from "./component-insert-request";
import type { InsertScope } from "./insert-launch";
import { DisplayToggle } from "./display-toggle";
import { SymbolArtwork } from "./symbol-artwork";

export type { ComponentInsertRequest } from "./component-insert-request";

export interface InsertComponentDialogProps {
  open: boolean;
  styleProfileId: string;
  recentSymbolIds: readonly string[];
  cells: readonly CellInsertCandidate[];
  externalDefinitions?: readonly ExternalSubcircuitInsertCandidate[];
  scope?: InsertScope;
  initialSelectionId?: string | null;
  onApply(request: ComponentInsertRequest): void;
  onCancel(): void;
}

export interface CellInsertCandidate {
  readonly childDocumentId: string;
  readonly cellName: string;
  readonly symbol: SymbolDefinition;
}
export interface ExternalSubcircuitInsertCandidate {
  readonly definitionId: string;
  readonly masterName: string;
  readonly symbol: SymbolDefinition;
}

interface InsertChoice {
  readonly key: string;
  readonly kind: "symbol" | "cell" | "external-subcircuit";
  readonly symbol: SymbolDefinition;
  readonly childDocumentId?: string;
  readonly cellName?: string;
  readonly definitionId?: string;
  readonly masterName?: string;
}

export function InsertComponentDialog({
  open,
  styleProfileId,
  recentSymbolIds,
  cells,
  externalDefinitions = [],
  scope = "all",
  initialSelectionId = null,
  onApply,
  onCancel,
}: InsertComponentDialogProps) {
  const cellsOnly = scope === "cells";
  const pickerNoun = cellsOnly ? "Cell" : "Component";
  const dialogTitle = cellsOnly
    ? "Place Hierarchical Cell"
    : "Insert Component";
  const initialChoices = useMemo<InsertChoice[]>(
    () => [
      ...(cellsOnly
        ? []
        : componentCatalog(styleProfileId, "", recentSymbolIds).flatMap(
            (group) =>
              group.symbols.map((symbol) => ({
                key: symbol.id,
                kind: "symbol" as const,
                symbol,
              })),
          )),
      ...cells.map((cell) => ({
        key: `cell:${cell.childDocumentId}`,
        kind: "cell" as const,
        symbol: cell.symbol,
        childDocumentId: cell.childDocumentId,
        cellName: cell.cellName,
      })),
      ...(cellsOnly
        ? []
        : externalDefinitions.map((definition) => ({
            key: `external:${definition.definitionId}`,
            kind: "external-subcircuit" as const,
            symbol: definition.symbol,
            definitionId: definition.definitionId,
            masterName: definition.masterName,
          }))),
    ],
    [cellsOnly, cells, externalDefinitions, recentSymbolIds, styleProfileId],
  );
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(
    () => initialChoices[0]?.key ?? null,
  );
  const [parameterValues, setParameterValues] = useState<
    Record<string, string>
  >({});
  const [initialRotation, setInitialRotation] = useState<0 | 90 | 180 | 270>(0);
  const [showReference, setShowReference] = useState(true);
  const [referenceText, setReferenceText] = useState("");
  const [showValue, setShowValue] = useState(false);
  const [railNetName, setRailNetName] = useState("VDD");
  const inputRef = useRef<HTMLInputElement>(null);
  const groups = useMemo<
    { category: string; subcategory?: string; choices: InsertChoice[] }[]
  >(() => {
    const cellChoices = cells
      .filter((cell) => {
        const normalized = query.trim().toLowerCase();
        return (
          normalized.length === 0 ||
          `${cell.cellName} ${cell.symbol.id}`
            .toLowerCase()
            .includes(normalized)
        );
      })
      .map<InsertChoice>((cell) => ({
        key: `cell:${cell.childDocumentId}`,
        kind: "cell",
        symbol: cell.symbol,
        childDocumentId: cell.childDocumentId,
        cellName: cell.cellName,
      }));
    const externalChoices = (cellsOnly ? [] : externalDefinitions)
      .filter((definition) => {
        const normalized = query.trim().toLowerCase();
        return (
          normalized.length === 0 ||
          `${definition.masterName} ${definition.symbol.id}`
            .toLowerCase()
            .includes(normalized)
        );
      })
      .map<InsertChoice>((definition) => ({
        key: `external:${definition.definitionId}`,
        kind: "external-subcircuit",
        symbol: definition.symbol,
        definitionId: definition.definitionId,
        masterName: definition.masterName,
      }));
    return [
      ...(cellsOnly
        ? []
        : componentCatalog(styleProfileId, query, recentSymbolIds).map(
            (group) => ({
              category: group.category,
              ...(group.subcategory ? { subcategory: group.subcategory } : {}),
              choices: group.symbols.map<InsertChoice>((symbol) => ({
                key: symbol.id,
                kind: "symbol",
                symbol,
              })),
            }),
          )),
      ...(cellChoices.length > 0
        ? [{ category: "Cells", choices: cellChoices }]
        : []),
      ...(externalChoices.length > 0
        ? [{ category: "External masters", choices: externalChoices }]
        : []),
    ];
  }, [
    cellsOnly,
    cells,
    externalDefinitions,
    query,
    recentSymbolIds,
    styleProfileId,
  ]);
  const choices = useMemo(
    () => groups.flatMap((group) => group.choices),
    [groups],
  );
  const selected =
    choices.find((choice) => choice.key === selectedId) ?? choices[0] ?? null;
  const selectedIsVddRail =
    selected?.kind === "symbol" && selected.symbol.id === "vdd";
  const selectedIsPort =
    selected?.kind === "symbol" &&
    (selected.symbol.id === "port" || selected.symbol.id === "port-filled");
  const selectedDrawingTool =
    selected?.kind === "symbol"
      ? annotationDrawingTool(selected.symbol.id)
      : undefined;
  const selectedPolarity =
    selected?.kind === "symbol"
      ? annotationPolarity(selected.symbol.id)
      : undefined;
  const parameters = componentParameters(
    selected?.kind === "symbol" ? selected.symbol.id : "",
  );
  const valueDisplay = displayableInstanceValue({
    symbolId: selected?.kind === "symbol" ? selected.symbol.id : "",
    netlist: {
      parameters: Object.fromEntries(
        Object.entries(parameterValues)
          .map(([key, value]) => [key, value.trim()] as const)
          .filter(([, value]) => value !== ""),
      ),
    },
  });
  const valueAvailable =
    selected?.kind === "cell" || valueDisplay.kind === "displayable";

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelectedId(
      initialSelectionId &&
        initialChoices.some((choice) => choice.key === initialSelectionId)
        ? initialSelectionId
        : (initialChoices[0]?.key ?? null),
    );
    setInitialRotation(0);
    setShowReference(true);
    setReferenceText("");
    setShowValue(false);
    setRailNetName("VDD");
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [initialChoices, initialSelectionId, open]);

  useEffect(() => {
    setParameterValues(
      initialComponentParameterValues(
        selected?.kind === "symbol" ? selected.symbol.id : "",
      ),
    );
  }, [selected]);

  useEffect(() => {
    if (selected?.kind === "cell" || selected?.kind === "external-subcircuit")
      setShowValue(true);
  }, [selected?.kind]);

  useEffect(() => {
    if (choices.length === 0) {
      setSelectedId(null);
    } else if (!choices.some((choice) => choice.key === selectedId)) {
      setSelectedId(choices[0]!.key);
    }
  }, [choices, selectedId]);

  if (!open) return null;

  const selectOffset = (offset: number): void => {
    if (choices.length === 0) return;
    const index = Math.max(
      0,
      choices.findIndex((choice) => choice.key === selected?.key),
    );
    const next = (index + offset + choices.length) % choices.length;
    setSelectedId(choices[next]!.key);
  };

  // Selecting never folds the list away: the catalog stays in place so the
  // next pick is one click, not an expand-then-click.
  const selectChoice = (key: string): void => {
    setSelectedId(key);
    setQuery("");
  };

  const rotatePreview = (): void => {
    if (selectedIsVddRail || selectedDrawingTool) return;
    setInitialRotation(
      (current) => ((current + 90) % 360) as 0 | 90 | 180 | 270,
    );
  };

  const apply = (): void => {
    if (!selected) return;
    if (selectedIsVddRail) {
      const netName = railNetName.trim();
      if (!netName) return;
      onApply({
        kind: "vdd-rail",
        symbolId: "vdd",
        symbolName: "Power Rail",
        netName,
      });
      return;
    }
    if (selectedDrawingTool) {
      onApply({
        kind: "drawing-tool",
        symbolId: selected.symbol.id,
        symbolName: selected.symbol.name,
        tool: selectedDrawingTool,
      });
      return;
    }
    if (selectedPolarity) {
      onApply({
        kind: "polarity-annotation",
        symbolId: selected.symbol.id,
        symbolName: selected.symbol.name,
        polarity: selectedPolarity,
        initialRotation,
      });
      return;
    }
    if (selected.kind === "cell") {
      const trimmedReference = referenceText.trim();
      onApply({
        kind: "cell",
        symbolId: selected.symbol.id,
        symbolName: selected.cellName ?? selected.symbol.name,
        childDocumentId: selected.childDocumentId!,
        cellName: selected.cellName ?? selected.symbol.name,
        parameters: {},
        initialRotation,
        showReference,
        referenceText: trimmedReference === "" ? null : trimmedReference,
        showValue: true,
      });
      return;
    }
    if (selected.kind === "external-subcircuit") {
      const trimmedReference = referenceText.trim();
      onApply({
        kind: "external-subcircuit",
        symbolId: selected.symbol.id,
        symbolName: selected.masterName ?? selected.symbol.name,
        definitionId: selected.definitionId!,
        masterName: selected.masterName ?? selected.symbol.name,
        parameters: {},
        initialRotation,
        showReference,
        referenceText: trimmedReference === "" ? null : trimmedReference,
        showValue: true,
      });
      return;
    }
    if (selectedIsPort) {
      onApply({
        kind: "symbol",
        symbolId: selected.symbol.id,
        symbolName: selected.symbol.name,
        parameters: {},
        initialRotation,
        showReference: false,
        referenceText: null,
        showValue: false,
        portDirection: "passive",
      });
      return;
    }
    const parameters = Object.fromEntries(
      Object.entries(parameterValues)
        .map(([key, value]) => [key, value.trim()] as const)
        .filter(([, value]) => value !== ""),
    );
    const trimmedReference = referenceText.trim();
    onApply({
      kind: "symbol",
      symbolId: selected.symbol.id,
      symbolName: selected.symbol.name,
      parameters,
      initialRotation,
      showReference,
      referenceText: trimmedReference === "" ? null : trimmedReference,
      showValue: showValue && valueAvailable,
    });
  };

  return (
    <div
      className="insert-dialog-backdrop"
      data-testid="insert-component-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <form
        className="insert-component-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="insert-component-title"
        onSubmit={(event) => {
          event.preventDefault();
          apply();
        }}
        onKeyDown={(event) => {
          const target = event.target as HTMLElement;
          const isTextEntry = Boolean(
            target.closest('input, textarea, [contenteditable="true"]'),
          );
          if (
            event.key.toLowerCase() === "r" &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.altKey &&
            !isTextEntry
          ) {
            event.preventDefault();
            rotatePreview();
          } else if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          } else if (event.key === "ArrowDown") {
            event.preventDefault();
            selectOffset(1);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            selectOffset(-1);
          } else if (event.key === "Home") {
            event.preventDefault();
            setSelectedId(choices[0]?.key ?? null);
          } else if (event.key === "End") {
            event.preventDefault();
            setSelectedId(choices.at(-1)?.key ?? null);
          }
        }}
      >
        <header className="insert-dialog-header">
          <div>
            <p>{cellsOnly ? "Place reusable design" : "Place device"}</p>
            <h2 id="insert-component-title">{dialogTitle}</h2>
          </div>
          {cellsOnly ? null : <kbd>I</kbd>}
        </header>

        <div className="insert-dialog-body">
          <aside
            className="insert-control-column"
            aria-label={`${pickerNoun} setup`}
          >
            <section className="insert-component-picker">
              <label className="insert-search-field">
                <span>{pickerNoun}</span>
                <div className="insert-picker-input-row">
                  <input
                    ref={inputRef}
                    role="combobox"
                    aria-label={`${pickerNoun} search`}
                    aria-autocomplete="list"
                    aria-expanded={true}
                    aria-controls="insert-component-options"
                    aria-activedescendant={
                      selected
                        ? `insert-component-option-${selected.key}`
                        : undefined
                    }
                    value={query}
                    placeholder={`Search ${pickerNoun.toLowerCase()}`}
                    onChange={(event) => setQuery(event.currentTarget.value)}
                  />
                </div>
              </label>
              {
                <div
                  id="insert-component-options"
                  className="insert-component-options"
                  role="listbox"
                  aria-label={`${pickerNoun} choices`}
                >
                  {groups.map((group) => (
                    <section
                      key={`${group.category}:${group.subcategory ?? ""}`}
                      className="insert-option-group"
                    >
                      <h3>{group.category}</h3>
                      {group.subcategory ? <h4>{group.subcategory}</h4> : null}
                      {group.choices.map((choice) => (
                        <button
                          type="button"
                          id={`insert-component-option-${choice.key}`}
                          key={choice.key}
                          role="option"
                          aria-selected={choice.key === selected?.key}
                          data-testid={
                            choice.kind === "cell"
                              ? `insert-cell-${choice.childDocumentId}`
                              : `insert-component-${choice.symbol.id}`
                          }
                          onClick={() => selectChoice(choice.key)}
                          onDoubleClick={() => {
                            // The first click of the pair already committed
                            // this selection; the second applies it.
                            apply();
                          }}
                        >
                          <span>
                            {choice.cellName ??
                              libraryDisplayName(
                                choice.symbol.id,
                                choice.symbol.name,
                              )}
                          </span>
                          <small>
                            {choice.kind === "cell" ? "Cell" : choice.symbol.id}
                          </small>
                        </button>
                      ))}
                    </section>
                  ))}
                  {choices.length === 0 ? (
                    <p className="insert-no-results">
                      No matching {pickerNoun.toLowerCase()}s
                    </p>
                  ) : null}
                </div>
              }
            </section>

            {selectedIsVddRail ? (
              <section
                className="insert-placement-options"
                aria-label="Power rail options"
              >
                <label>
                  <span>Net name</span>
                  <input
                    aria-label="Power rail Net name"
                    value={railNetName}
                    onChange={(event) =>
                      setRailNetName(event.currentTarget.value)
                    }
                  />
                </label>
              </section>
            ) : selectedDrawingTool ? (
              <section
                className="insert-placement-options"
                aria-label="Drawing tool"
              >
                <p className="insert-cell-label-note">
                  Starts the existing {selected!.symbol.name.toLowerCase()}{" "}
                  tool. Click the canvas to draw; press Esc when finished.
                </p>
              </section>
            ) : (
              <section
                className="insert-placement-options"
                aria-label="Placement options"
              >
                <label className="insert-rotation-control">
                  <span>Rotate</span>
                  <select
                    aria-label="Initial rotation"
                    value={initialRotation}
                    onChange={(event) =>
                      setInitialRotation(
                        Number(event.currentTarget.value) as 0 | 90 | 180 | 270,
                      )
                    }
                  >
                    <option value="0">0°</option>
                    <option value="90">90°</option>
                    <option value="180">180°</option>
                    <option value="270">270°</option>
                  </select>
                </label>
                {selectedPolarity ? (
                  <p className="insert-cell-label-note">
                    Place the annotation, then edit its center text directly on
                    the canvas.
                  </p>
                ) : selectedIsPort ? (
                  <p className="insert-cell-label-note">
                    {libraryDescription(selected.symbol.id) ??
                      "Names a net on this sheet."}{" "}
                    Rename it on the canvas.
                  </p>
                ) : (
                  <div className="insert-label-control">
                    <DisplayToggle
                      label="Reference"
                      checked={showReference}
                      onChange={setShowReference}
                    />
                    <input
                      aria-label="Reference name"
                      value={referenceText}
                      disabled={!showReference}
                      placeholder="Name (auto)"
                      onChange={(event) =>
                        setReferenceText(event.currentTarget.value)
                      }
                    />
                    <DisplayToggle
                      label="Value"
                      checked={showValue}
                      disabled={!valueAvailable}
                      help={
                        valueAvailable
                          ? undefined
                          : "Fill the device parameters first"
                      }
                      onChange={setShowValue}
                    />
                  </div>
                )}
              </section>
            )}

            {parameters.length > 0 ? (
              <section
                className="insert-control-section"
                aria-label="Device parameters"
              >
                <h3>Device parameters</h3>
                {parameters.map((parameter) => (
                  <label key={parameter.key} title={parameter.help}>
                    <span className="insert-parameter-name">
                      {parameter.label}
                      {parameter.unit ? ` / ${parameter.unit}` : ""}
                      <em>({parameter.help})</em>
                    </span>
                    <input
                      aria-label={`Component ${parameter.label.toLowerCase()}`}
                      inputMode={parameter.inputMode}
                      value={parameterValues[parameter.key] ?? ""}
                      placeholder={parameter.placeholder}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        setParameterValues((current) => ({
                          ...current,
                          [parameter.key]: value,
                        }));
                      }}
                    />
                  </label>
                ))}
              </section>
            ) : null}
          </aside>

          <section
            className="insert-component-preview"
            aria-label="Component preview"
            aria-live="polite"
            tabIndex={0}
          >
            {selected ? (
              <>
                <SymbolArtwork
                  symbol={selected.symbol}
                  className="insert-symbol-artwork"
                  rotation={initialRotation}
                />
                <div>
                  <h3>{selected.cellName ?? selected.symbol.name}</h3>
                  <p>
                    {selected.kind === "cell" ? "Cell" : selected.symbol.id}
                  </p>
                </div>
              </>
            ) : (
              <p>Select a component to preview it.</p>
            )}
          </section>
        </div>

        <footer className="insert-dialog-actions">
          <small>Type to search · ↑↓ choose · Enter place · Esc cancel</small>
          <div>
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={!selected}>
              Apply
            </button>
          </div>
        </footer>
      </form>
    </div>
  );
}
