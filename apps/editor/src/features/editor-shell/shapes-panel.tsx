import {
  SymbolArtwork,
  type ComponentInsertRequest,
} from "../component-insert/insert-component-dialog";
import {
  componentParameters,
  initialComponentParameterValues,
} from "../component-insert/component-parameters";
import { findPaletteSymbol } from "../component-insert/symbol-catalog";

/** Starter chips always offered in the left shapes column . */
export const STARTER_SYMBOL_IDS = [
  "resistor",
  "capacitor",
  "nmos",
  "pmos",
  "voltage-source",
  "ground",
  "vdd",
  "opamp",
] as const;

export function quickPlaceRequest(
  styleProfileId: string,
  symbolId: string,
): ComponentInsertRequest | null {
  const symbol = findPaletteSymbol(styleProfileId, symbolId);
  if (!symbol) return null;
  const parameters = componentParameters(symbolId);
  const properties =
    parameters.length === 0
      ? initialComponentParameterValues(symbolId)
      : Object.fromEntries(
          parameters.map((parameter) => [
            parameter.key,
            parameter.placeholder || "",
          ]),
        );
  return {
    symbolId: symbol.id,
    symbolName: symbol.name,
    properties,
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
  const starters = STARTER_SYMBOL_IDS.map((symbolId) =>
    findPaletteSymbol(styleProfileId, symbolId),
  ).filter((symbol): symbol is NonNullable<typeof symbol> => Boolean(symbol));

  const recents = recentSymbolIds
    .map((symbolId) => findPaletteSymbol(styleProfileId, symbolId))
    .filter((symbol): symbol is NonNullable<typeof symbol> => Boolean(symbol))
    .slice(0, 6);

  function placeSymbol(symbolId: string): void {
    const request = quickPlaceRequest(styleProfileId, symbolId);
    if (request) onQuickPlace(request);
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
        <details
          className="shapes-fold"
          open
          data-testid="shapes-fold-starters"
        >
          <summary className="shapes-fold-summary">
            <span className="shapes-fold-label">Starters</span>
            <span className="shapes-fold-count">{starters.length}</span>
          </summary>
          <div className="shapes-fold-body">
            <div className="shapes-grid">
              {starters.map((symbol) => (
                <button
                  key={symbol.id}
                  type="button"
                  className="shapes-chip"
                  data-testid={`shapes-chip-${symbol.id}`}
                  title={`Place ${symbol.name}`}
                  onClick={() => placeSymbol(symbol.id)}
                >
                  <SymbolArtwork
                    symbol={symbol}
                    className="shapes-chip-art"
                    paddingRatio={0.04}
                  />
                  <span>{symbol.name}</span>
                </button>
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
                    title={`Place ${symbol.name}`}
                    onClick={() => placeSymbol(symbol.id)}
                  >
                    <SymbolArtwork
                      symbol={symbol}
                      className="shapes-chip-art"
                      paddingRatio={0.04}
                    />
                    <span>{symbol.name}</span>
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
