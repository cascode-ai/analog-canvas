import { useEffect, useMemo, useRef, useState } from "react";

import type { SymbolDefinition } from "@icm/symbols";

import { initialComponentParameterValues } from "./component-parameters";
import {
  annotationDrawingTool,
  annotationPolarity,
  annotationTextPreset,
} from "./annotation-preview-symbols";
import { componentCatalog, libraryDisplayName } from "./symbol-catalog";
import type { ComponentInsertRequest } from "./component-insert-request";
import type { InsertScope } from "./insert-launch";
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
  readonly category: string;
  readonly childDocumentId?: string;
  readonly cellName?: string;
  readonly definitionId?: string;
  readonly masterName?: string;
}

const CELLS_CATEGORY = "Cells";
const EXTERNAL_CATEGORY = "External masters";

function categorySlug(category: string): string {
  return category.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

/**
 * The I picker is a one-glance speed surface: every candidate tiles into one
 * flat grid in the Library's category order and a click or Enter starts
 * placement immediately. Per-device setup (parameters, reference text, value
 * display, supply names) lives in the Properties panel after placement, not
 * here.
 */
export function InsertComponentDialog({
  open,
  styleProfileId,
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
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hiddenCategories, setHiddenCategories] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // The filter row lists every category the full catalog offers, in the same
  // order the Library sidebar uses, independent of the current search text.
  const availableCategories = useMemo<string[]>(() => {
    const categories = cellsOnly
      ? []
      : componentCatalog(styleProfileId, "", []).map((group) => group.category);
    return [
      ...categories.filter(
        (category, index) => categories.indexOf(category) === index,
      ),
      ...(cells.length > 0 ? [CELLS_CATEGORY] : []),
      ...(!cellsOnly && externalDefinitions.length > 0
        ? [EXTERNAL_CATEGORY]
        : []),
    ];
  }, [cells.length, cellsOnly, externalDefinitions.length, styleProfileId]);

  const choices = useMemo<InsertChoice[]>(() => {
    const normalized = query.trim().toLowerCase();
    const cellChoices = cells
      .filter(
        (cell) =>
          normalized.length === 0 ||
          `${cell.cellName} ${cell.symbol.id}`
            .toLowerCase()
            .includes(normalized),
      )
      .map<InsertChoice>((cell) => ({
        key: `cell:${cell.childDocumentId}`,
        kind: "cell",
        symbol: cell.symbol,
        category: CELLS_CATEGORY,
        childDocumentId: cell.childDocumentId,
        cellName: cell.cellName,
      }));
    const externalChoices = (cellsOnly ? [] : externalDefinitions)
      .filter(
        (definition) =>
          normalized.length === 0 ||
          `${definition.masterName} ${definition.symbol.id}`
            .toLowerCase()
            .includes(normalized),
      )
      .map<InsertChoice>((definition) => ({
        key: `external:${definition.definitionId}`,
        kind: "external-subcircuit",
        symbol: definition.symbol,
        category: EXTERNAL_CATEGORY,
        definitionId: definition.definitionId,
        masterName: definition.masterName,
      }));
    // Library order, not recency: the grid reads exactly like the sidebar —
    // transistors first, categories together — so positions stay learnable.
    const symbolChoices = cellsOnly
      ? []
      : componentCatalog(styleProfileId, query, []).flatMap((group) =>
          group.symbols.map<InsertChoice>((symbol) => ({
            key: symbol.id,
            kind: "symbol",
            symbol,
            category: group.category,
          })),
        );
    return [...symbolChoices, ...cellChoices, ...externalChoices].filter(
      (choice) => !hiddenCategories.has(choice.category),
    );
  }, [
    cellsOnly,
    cells,
    externalDefinitions,
    hiddenCategories,
    query,
    styleProfileId,
  ]);

  const selected =
    choices.find((choice) => choice.key === selectedId) ?? choices[0] ?? null;

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelectedId(initialSelectionId);
    // A quick pick always reopens showing everything.
    setHiddenCategories(new Set());
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [initialSelectionId, open]);

  const clearAllCategories = (): void => {
    // Start from zero: hide everything, then chips turn kinds back on one by
    // one.
    setHiddenCategories(new Set(availableCategories));
    inputRef.current?.focus();
  };

  const toggleCategory = (category: string): void => {
    setHiddenCategories((current) => {
      const next = new Set(current);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
    // Typing keeps working right after a toggle.
    inputRef.current?.focus();
  };

  useEffect(() => {
    if (choices.length === 0) {
      setSelectedId(null);
    } else if (!choices.some((choice) => choice.key === selectedId)) {
      setSelectedId(choices[0]!.key);
    }
  }, [choices, selectedId]);

  useEffect(() => {
    if (!open || !selected) return;
    gridRef.current
      ?.querySelector(
        `[id="insert-component-option-${CSS.escape(selected.key)}"]`,
      )
      ?.scrollIntoView({ block: "nearest" });
  }, [open, selected]);

  if (!open) return null;

  const gridColumns = (): number => {
    const options =
      gridRef.current?.querySelectorAll<HTMLElement>('[role="option"]');
    if (!options || options.length === 0) return 1;
    const firstTop = options[0]!.offsetTop;
    let columns = 0;
    for (const option of options) {
      if (option.offsetTop !== firstTop) break;
      columns += 1;
    }
    return Math.max(1, columns);
  };

  const selectOffset = (offset: number): void => {
    if (choices.length === 0) return;
    const index = Math.max(
      0,
      choices.findIndex((choice) => choice.key === selected?.key),
    );
    const next = Math.min(Math.max(index + offset, 0), choices.length - 1);
    setSelectedId(choices[next]!.key);
  };

  const applyChoice = (choice: InsertChoice | null): void => {
    if (!choice) return;
    const symbolId = choice.symbol.id;
    if (choice.kind === "symbol" && symbolId === "vdd") {
      onApply({
        kind: "vdd-rail",
        symbolId: "vdd",
        symbolName: "Power Rail",
        netName: "VDD",
      });
      return;
    }
    const drawingTool =
      choice.kind === "symbol" ? annotationDrawingTool(symbolId) : undefined;
    if (drawingTool) {
      onApply({
        kind: "drawing-tool",
        symbolId,
        symbolName: choice.symbol.name,
        tool: drawingTool,
      });
      return;
    }
    const polarity =
      choice.kind === "symbol" ? annotationPolarity(symbolId) : undefined;
    if (polarity) {
      onApply({
        kind: "polarity-annotation",
        symbolId,
        symbolName: choice.symbol.name,
        polarity,
        initialRotation: 0,
      });
      return;
    }
    const textPreset =
      choice.kind === "symbol" ? annotationTextPreset(symbolId) : undefined;
    if (textPreset) {
      onApply({
        kind: "drafting-text",
        symbolId,
        symbolName: choice.symbol.name,
        text: textPreset,
        initialRotation: 0,
      });
      return;
    }
    if (choice.kind === "cell") {
      onApply({
        kind: "cell",
        symbolId,
        symbolName: choice.cellName ?? choice.symbol.name,
        childDocumentId: choice.childDocumentId!,
        cellName: choice.cellName ?? choice.symbol.name,
        parameters: {},
        initialRotation: 0,
        showReference: true,
        referenceText: null,
        showValue: true,
      });
      return;
    }
    if (choice.kind === "external-subcircuit") {
      onApply({
        kind: "external-subcircuit",
        symbolId,
        symbolName: choice.masterName ?? choice.symbol.name,
        definitionId: choice.definitionId!,
        masterName: choice.masterName ?? choice.symbol.name,
        parameters: {},
        initialRotation: 0,
        showReference: true,
        referenceText: null,
        showValue: true,
      });
      return;
    }
    if (symbolId === "port" || symbolId === "port-filled") {
      onApply({
        kind: "symbol",
        symbolId,
        symbolName: choice.symbol.name,
        parameters: {},
        initialRotation: 0,
        showReference: false,
        referenceText: null,
        showValue: false,
        portDirection: "passive",
      });
      return;
    }
    // Devices arrive with their catalog defaults (a MOS still lands as
    // 1u/180n); everything is editable in Properties after placement.
    const parameters = Object.fromEntries(
      Object.entries(initialComponentParameterValues(symbolId))
        .map(([key, value]) => [key, value.trim()] as const)
        .filter(([, value]) => value !== ""),
    );
    onApply({
      kind: "symbol",
      symbolId,
      symbolName: choice.symbol.name,
      parameters,
      initialRotation: 0,
      showReference: true,
      referenceText: null,
      showValue: false,
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
      <div
        className="insert-component-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="insert-component-title"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          } else if (event.key === "Enter") {
            event.preventDefault();
            applyChoice(selected);
          } else if (event.key === "ArrowRight") {
            event.preventDefault();
            selectOffset(1);
          } else if (event.key === "ArrowLeft") {
            event.preventDefault();
            selectOffset(-1);
          } else if (event.key === "ArrowDown") {
            event.preventDefault();
            selectOffset(gridColumns());
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            selectOffset(-gridColumns());
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

        <input
          ref={inputRef}
          className="insert-quick-search"
          role="combobox"
          aria-label={`${pickerNoun} search`}
          aria-autocomplete="list"
          aria-expanded={true}
          aria-controls="insert-component-options"
          aria-activedescendant={
            selected ? `insert-component-option-${selected.key}` : undefined
          }
          value={query}
          placeholder={`Search ${pickerNoun.toLowerCase()}s`}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />

        {availableCategories.length > 1 ? (
          <div
            className="insert-category-filter"
            role="group"
            aria-label={`${pickerNoun} categories`}
          >
            <button
              type="button"
              className="insert-category-chip insert-category-clear"
              data-testid="insert-category-clear"
              title="Hide every category, then pick the ones to show"
              onClick={clearAllCategories}
            >
              Clear all
            </button>
            {availableCategories.map((category) => (
              <button
                type="button"
                key={category}
                className="insert-category-chip"
                aria-pressed={!hiddenCategories.has(category)}
                data-testid={`insert-category-${categorySlug(category)}`}
                title={
                  hiddenCategories.has(category)
                    ? `Show ${category}`
                    : `Hide ${category}`
                }
                onClick={() => toggleCategory(category)}
              >
                {category}
              </button>
            ))}
          </div>
        ) : null}

        <div
          ref={gridRef}
          id="insert-component-options"
          className="insert-tile-grid"
          role="listbox"
          aria-label={`${pickerNoun} choices`}
        >
          {choices.map((choice) => {
            const label =
              choice.cellName ??
              choice.masterName ??
              libraryDisplayName(choice.symbol.id, choice.symbol.name);
            return (
              <button
                type="button"
                id={`insert-component-option-${choice.key}`}
                key={choice.key}
                role="option"
                aria-selected={choice.key === selected?.key}
                className="insert-tile"
                title={
                  choice.kind === "cell"
                    ? `${label} · Cell`
                    : `${label} · ${choice.symbol.id}`
                }
                data-testid={
                  choice.kind === "cell"
                    ? `insert-cell-${choice.childDocumentId}`
                    : `insert-component-${choice.symbol.id}`
                }
                onClick={() => applyChoice(choice)}
              >
                <SymbolArtwork
                  symbol={choice.symbol}
                  className="insert-symbol-artwork"
                />
                <span>{label}</span>
              </button>
            );
          })}
          {choices.length === 0 ? (
            <p className="insert-no-results">
              No matching {pickerNoun.toLowerCase()}s
            </p>
          ) : null}
        </div>

        <footer className="insert-dialog-actions">
          <small>
            Type to filter · ←↑↓→ choose · Enter or click places · Esc closes
          </small>
        </footer>
      </div>
    </div>
  );
}
