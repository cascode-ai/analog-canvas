import { useEffect, useMemo, useRef, useState } from "react";

import { renderSymbolDefinitionBody } from "@icm/render-svg";

import { defaultRazaviSymbolVariantId } from "../../presentation/razavi-presentation";
import {
  componentParameters,
  initialComponentParameterValues,
} from "./component-parameters";
import {
  componentCatalog,
  findPaletteSymbol,
  flattenComponentCatalog,
} from "./symbol-catalog";
import type { ComponentInsertRequest } from "./component-insert-request";
import { SymbolArtwork } from "./symbol-artwork";

export type { ComponentInsertRequest } from "./component-insert-request";

export interface InsertComponentDialogProps {
  open: boolean;
  styleProfileId: string;
  recentSymbolIds: readonly string[];
  onApply(request: ComponentInsertRequest): void;
  onCancel(): void;
}

export function ComponentPlacementPreview({
  styleProfileId,
  symbolId,
  position,
  rotation,
  mirror = "none",
}: {
  styleProfileId: string;
  symbolId: string;
  position: { x: number; y: number };
  rotation: 0 | 90 | 180 | 270;
  mirror?: "none" | "x";
}) {
  const symbol = findPaletteSymbol(styleProfileId, symbolId);
  if (!symbol) return null;
  const variantId = defaultRazaviSymbolVariantId(symbol.id);
  const variant = symbol.variants.find(
    (candidate) => candidate.id === variantId,
  );

  return (
    <g
      data-testid="component-placement-preview"
      className="component-placement-preview"
      transform={`translate(${position.x} ${position.y}) rotate(${rotation})${
        mirror === "x" ? " scale(-1 1)" : ""
      }`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinecap="square"
      strokeLinejoin="miter"
      dangerouslySetInnerHTML={{
        __html: renderSymbolDefinitionBody(
          symbol,
          variant?.hiddenPrimitiveParts,
          variant?.additionalPrimitives,
        ),
      }}
    />
  );
}

export function InsertComponentDialog({
  open,
  styleProfileId,
  recentSymbolIds,
  onApply,
  onCancel,
}: InsertComponentDialogProps) {
  const initialSymbols = useMemo(
    () =>
      flattenComponentCatalog(
        componentCatalog(styleProfileId, "", recentSymbolIds),
      ),
    [recentSymbolIds, styleProfileId],
  );
  const [query, setQuery] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(
    () => initialSymbols[0]?.id ?? null,
  );
  const [parameterValues, setParameterValues] = useState<
    Record<string, string>
  >({});
  const [initialRotation, setInitialRotation] = useState<0 | 90 | 180 | 270>(0);
  const [showReference, setShowReference] = useState(true);
  const [referenceText, setReferenceText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const groups = useMemo(
    () => componentCatalog(styleProfileId, query, recentSymbolIds),
    [query, recentSymbolIds, styleProfileId],
  );
  const symbols = useMemo(() => flattenComponentCatalog(groups), [groups]);
  const selected =
    symbols.find((symbol) => symbol.id === selectedId) ?? symbols[0] ?? null;
  const selectedIsVddRail = selected?.id === "vdd";
  const parameters = componentParameters(selected?.id ?? "");

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setPickerOpen(false);
    setSelectedId(initialSymbols[0]?.id ?? null);
    setInitialRotation(0);
    setShowReference(true);
    setReferenceText("");
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [initialSymbols, open]);

  useEffect(() => {
    setParameterValues(initialComponentParameterValues(selected?.id ?? ""));
  }, [selected?.id]);

  useEffect(() => {
    if (symbols.length === 0) {
      setSelectedId(null);
    } else if (!symbols.some((symbol) => symbol.id === selectedId)) {
      setSelectedId(symbols[0]!.id);
    }
  }, [selectedId, symbols]);

  if (!open) return null;

  const selectOffset = (offset: number): void => {
    if (symbols.length === 0) return;
    const index = Math.max(
      0,
      symbols.findIndex((symbol) => symbol.id === selected?.id),
    );
    const next = (index + offset + symbols.length) % symbols.length;
    setSelectedId(symbols[next]!.id);
    setPickerOpen(true);
  };

  const selectSymbol = (symbolId: string): void => {
    setSelectedId(symbolId);
    setQuery("");
    setPickerOpen(false);
  };

  const rotatePreview = (): void => {
    if (selectedIsVddRail) return;
    setInitialRotation(
      (current) => ((current + 90) % 360) as 0 | 90 | 180 | 270,
    );
  };

  const apply = (): void => {
    if (!selected) return;
    if (selectedIsVddRail) {
      onApply({
        kind: "vdd-rail",
        symbolId: "vdd",
        symbolName: "VDD Rail",
      });
      return;
    }
    const properties = Object.fromEntries(
      Object.entries(parameterValues)
        .map(([key, value]) => [key, value.trim()] as const)
        .filter(([, value]) => value !== ""),
    );
    const trimmedReference = referenceText.trim();
    onApply({
      kind: "symbol",
      symbolId: selected.id,
      symbolName: selected.name,
      properties,
      initialRotation,
      showReference,
      referenceText: trimmedReference === "" ? null : trimmedReference,
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
            setPickerOpen(true);
            setSelectedId(symbols[0]?.id ?? null);
          } else if (event.key === "End") {
            event.preventDefault();
            setPickerOpen(true);
            setSelectedId(symbols.at(-1)?.id ?? null);
          }
        }}
      >
        <header className="insert-dialog-header">
          <div>
            <p>Place device</p>
            <h2 id="insert-component-title">Insert Component</h2>
          </div>
          <kbd>I</kbd>
        </header>

        <div className="insert-dialog-body">
          <aside className="insert-control-column" aria-label="Device setup">
            <section className="insert-component-picker">
              <label className="insert-search-field">
                <span>Component</span>
                <div className="insert-picker-input-row">
                  <input
                    ref={inputRef}
                    role="combobox"
                    aria-label="Component search"
                    aria-autocomplete="list"
                    aria-expanded={pickerOpen}
                    aria-controls="insert-component-options"
                    aria-activedescendant={
                      selected
                        ? `insert-component-option-${selected.id}`
                        : undefined
                    }
                    value={query}
                    placeholder={
                      selected
                        ? `${selected.name} · ${selected.id}`
                        : "Search component"
                    }
                    onChange={(event) => {
                      setQuery(event.currentTarget.value);
                      setPickerOpen(true);
                    }}
                  />
                  <button
                    type="button"
                    className="insert-picker-toggle"
                    aria-label={
                      pickerOpen
                        ? "Collapse component list"
                        : "Expand component list"
                    }
                    aria-expanded={pickerOpen}
                    onClick={() => setPickerOpen((current) => !current)}
                  >
                    {pickerOpen ? "⌃" : "⌄"}
                  </button>
                </div>
              </label>
              {pickerOpen ? (
                <div
                  id="insert-component-options"
                  className="insert-component-options"
                  role="listbox"
                  aria-label="Component choices"
                >
                  {groups.map((group) => (
                    <section
                      key={group.category}
                      className="insert-option-group"
                    >
                      <h3>{group.category}</h3>
                      {group.symbols.map((symbol) => (
                        <button
                          type="button"
                          id={`insert-component-option-${symbol.id}`}
                          key={symbol.id}
                          role="option"
                          aria-selected={symbol.id === selected?.id}
                          data-testid={`insert-component-${symbol.id}`}
                          onClick={() => selectSymbol(symbol.id)}
                        >
                          <span>{symbol.name}</span>
                          <small>{symbol.id}</small>
                        </button>
                      ))}
                    </section>
                  ))}
                  {symbols.length === 0 ? (
                    <p className="insert-no-results">No matching components</p>
                  ) : null}
                </div>
              ) : null}
            </section>

            {!selectedIsVddRail ? (
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
                <div className="insert-label-control">
                  <label className="insert-reference-toggle">
                    <input
                      type="checkbox"
                      checked={showReference}
                      onChange={(event) =>
                        setShowReference(event.currentTarget.checked)
                      }
                    />
                    <span>Label</span>
                  </label>
                  <input
                    aria-label="Label name"
                    value={referenceText}
                    disabled={!showReference}
                    placeholder="Name (auto)"
                    onChange={(event) =>
                      setReferenceText(event.currentTarget.value)
                    }
                  />
                </div>
              </section>
            ) : null}

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
                  symbol={selected}
                  className="insert-symbol-artwork"
                  rotation={initialRotation}
                />
                <div>
                  <h3>{selected.name}</h3>
                  <p>{selected.id}</p>
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
