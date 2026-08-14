import { useState } from "react";

import type { ComponentInsertRequest } from "../component-insert/component-insert-request";
import { SymbolArtwork } from "../component-insert/symbol-artwork";
import { initialComponentParameterValues } from "../component-insert/component-parameters";
import {
  componentCatalog,
  findPaletteSymbol,
} from "../component-insert/symbol-catalog";

const COMPACT_LIBRARY_LABELS: Readonly<Record<string, string>> = {
  "current-source": "Current Source",
  npn: "NPN",
  opamp: "Op Amp",
  pnp: "PNP",
  "voltage-amplifier": "Voltage Amp",
  "voltage-source": "Voltage Source",
};

function libraryLabel(symbolId: string, symbolName: string): string {
  return COMPACT_LIBRARY_LABELS[symbolId] ?? symbolName;
}

function categorySlug(category: string): string {
  return category.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

export function quickPlaceRequest(
  styleProfileId: string,
  symbolId: string,
): ComponentInsertRequest | null {
  const symbol = findPaletteSymbol(styleProfileId, symbolId);
  if (!symbol) return null;
  if (symbolId === "vdd") {
    return {
      kind: "vdd-rail",
      symbolId: "vdd",
      symbolName: "VDD Rail",
    };
  }
  return {
    kind: "symbol",
    symbolId: symbol.id,
    symbolName: symbol.name,
    // Quick-place follows the full Insert dialog's existing blank-value
    // semantics. Placeholders remain hints rather than silently persisted
    // electrical parameters.
    properties: initialComponentParameterValues(symbolId),
    initialRotation: 0,
    showReference: true,
    referenceText: null,
  };
}

export interface ShapesPanelProps {
  styleProfileId: string;
  recentSymbolIds: readonly string[];
  open: boolean;
  onOpenInsert(): void;
  onQuickPlace(request: ComponentInsertRequest): void;
}

export function ShapesPanel({
  styleProfileId,
  recentSymbolIds,
  open,
  onOpenInsert,
  onQuickPlace,
}: ShapesPanelProps) {
  const libraryGroups = componentCatalog(styleProfileId, "");
  const librarySymbolCount = libraryGroups.reduce(
    (count, group) => count + group.symbols.length,
    0,
  );
  const [openCategories, setOpenCategories] = useState<ReadonlySet<string>>(
    () => new Set(libraryGroups.map((group) => group.category)),
  );

  const recents = recentSymbolIds
    .map((symbolId) => findPaletteSymbol(styleProfileId, symbolId))
    .filter((symbol): symbol is NonNullable<typeof symbol> => Boolean(symbol))
    .slice(0, 6);

  function placeSymbol(symbolId: string): void {
    const request = quickPlaceRequest(styleProfileId, symbolId);
    if (request) onQuickPlace(request);
  }

  function setCategoryOpen(category: string, open: boolean): void {
    setOpenCategories((current) => {
      if (current.has(category) === open) return current;
      const next = new Set(current);
      if (open) next.add(category);
      else next.delete(category);
      return next;
    });
  }

  return (
    <aside
      id="shapes-library-panel"
      className={open ? "shapes-panel" : "shapes-panel collapsed"}
      aria-label="Shapes"
      aria-hidden={!open}
      inert={!open ? true : undefined}
      data-testid="shapes-library-panel"
      data-open={open ? "true" : "false"}
    >
      <header className="shapes-panel-header">
        <button
          type="button"
          className="shapes-panel-title"
          onClick={onOpenInsert}
          title="Open insert dialog (I)"
        >
          <span className="shapes-kicker">Quick place</span>
          <span className="shapes-panel-heading">Library</span>
        </button>
      </header>

      <div className="shapes-panel-body">
        <details className="shapes-fold" open data-testid="shapes-fold-library">
          <summary className="shapes-fold-summary">
            <span className="shapes-fold-label">All devices</span>
            <span className="shapes-fold-count">{librarySymbolCount}</span>
          </summary>
          <div className="shapes-fold-body">
            <div className="shapes-category-list">
              {libraryGroups.map((group) => (
                <details
                  key={group.category}
                  className="shapes-category"
                  open={openCategories.has(group.category)}
                  data-testid={`shapes-category-${categorySlug(group.category)}`}
                  onToggle={(event) =>
                    setCategoryOpen(group.category, event.currentTarget.open)
                  }
                >
                  <summary className="shapes-category-header">
                    <span className="shapes-category-label">
                      {group.category}
                    </span>
                    <span className="shapes-category-count">
                      {group.symbols.length}
                    </span>
                  </summary>
                  <div className="shapes-grid">
                    {group.symbols.map((symbol) => (
                      <button
                        key={symbol.id}
                        type="button"
                        className="shapes-chip"
                        data-testid={`shapes-chip-${symbol.id}`}
                        data-vdd-rail={symbol.id === "vdd" ? "true" : undefined}
                        aria-label={`Place ${symbol.name}`}
                        title={`Place ${symbol.name}`}
                        onClick={() => placeSymbol(symbol.id)}
                      >
                        <SymbolArtwork
                          symbol={symbol}
                          className="shapes-chip-art"
                          paddingRatio={0.04}
                        />
                        <span>{libraryLabel(symbol.id, symbol.name)}</span>
                      </button>
                    ))}
                  </div>
                </details>
              ))}
            </div>
          </div>
        </details>

        <details
          className="shapes-fold"
          open={recents.length > 0}
          data-testid="shapes-fold-recent"
        >
          <summary className="shapes-fold-summary">
            <span className="shapes-fold-label">Recent</span>
            <span className="shapes-fold-count">{recents.length}</span>
          </summary>
          <div className="shapes-fold-body">
            {recents.length > 0 ? (
              <div className="shapes-grid">
                {recents.map((symbol) => (
                  <button
                    key={`recent-${symbol.id}`}
                    type="button"
                    className="shapes-chip"
                    data-testid={`shapes-recent-${symbol.id}`}
                    aria-label={`Place ${symbol.name}`}
                    title={`Place ${symbol.name}`}
                    onClick={() => placeSymbol(symbol.id)}
                  >
                    <SymbolArtwork
                      symbol={symbol}
                      className="shapes-chip-art"
                      paddingRatio={0.04}
                    />
                    <span>{libraryLabel(symbol.id, symbol.name)}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="shapes-hint">
                Recent parts appear here after you place something. Use Insert
                for the full catalog with parameters.
              </p>
            )}
          </div>
        </details>
      </div>

      <footer className="shapes-panel-footer">
        <button
          type="button"
          className="shapes-insert"
          data-testid="shapes-insert"
          onClick={onOpenInsert}
          title="Insert component with parameters (I)"
        >
          Insert
          <kbd>I</kbd>
        </button>
      </footer>
    </aside>
  );
}
