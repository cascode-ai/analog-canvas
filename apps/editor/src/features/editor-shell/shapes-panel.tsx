import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import type { ComponentInsertRequest } from "../component-insert/component-insert-request";
import type { InsertLaunch } from "../component-insert/insert-launch";
import { SymbolArtwork } from "../component-insert/symbol-artwork";
import { startCanvasDrag } from "./canvas-drag";
import { initialComponentParameterValues } from "../component-insert/component-parameters";
import {
  annotationDrawingTool,
  annotationPolarity,
  annotationTextPreset,
} from "../component-insert/annotation-preview-symbols";
import {
  componentCatalog,
  findPaletteSymbol,
  libraryDescription,
  libraryDisplayName,
} from "../component-insert/symbol-catalog";

/**
 * A tile is 40px wide, so its label is an abbreviation — "Cap", "Res", "NPN".
 * A Cell Pin shortens to "Pin" and a Bias Voltage Port to "Bias"; full names
 * remain in the tooltip and Insert dialog, where there is room to read them.
 */
const COMPACT_LIBRARY_LABELS: Readonly<Record<string, string>> = {
  capacitor: "Cap",
  "closed-switch": "Closed",
  "current-source": "I Src",
  "d-flip-flop": "DFF",
  "d-flip-flop-reset": "DFF R",
  "d-flip-flop-q": "DFQ",
  "ideal-switch": "Open",
  "simple-switch": "Simple",
  "spdt-switch": "SPDT",
  // "Voltage-Controlled Switch" overflows the tile; the SPICE letter is what
  // a reader is looking for anyway.
  "voltage-controlled-switch": "S Switch",
  "voltage-amplifier-lettered": "V Amp A",
  inductor: "Ind L",
  "inductor-compact": "Ind",
  ndmos: "NDMOS",
  npn: "NPN",
  adc: "ADC",
  dac: "DAC",
  "opamp-lettered": "OpAmp A",
  "opamp-differential-lettered": "FD Amp A",
  "and-gate": "AND",
  comparator: "Comp",
  "comparator-unmarked": "Comp U",
  inverter: "Inv",
  "nand-gate": "NAND",
  "nor-gate": "NOR",
  "or-gate": "OR",
  "xnor-gate": "XNOR",
  "xor-gate": "XOR",
  pnp: "PNP",
  pdmos: "PDMOS",
  port: "Pin",
  "port-filled": "Bias",
  resistor: "Res",
  "variable-capacitor": "Var Cap",
  "variable-inductor": "Var Ind",
  "variable-resistor": "Var Res",
  vdd: "VDD Rail",
  "no-connect": "NoConn",
  "vdd-port": "VDD",
  "voltage-amplifier": "V Amp",
  "voltage-source": "V Src",
  adder: "Add",
  multiplier: "Mult",
  transconductance: "gm",
  "differential-transconductance": "Diff gm",
  integrator: "1/s",
  "unit-delay": "z⁻¹",
  "discrete-time-integrator": "DT Int",
  quantizer: "Quant",
  "annotation-arrow": "Arrow",
  "annotation-line": "Line",
  "annotation-rectangle": "Rect",
  "annotation-circle": "Circle",
  "annotation-polarity-both": "+ V −",
  "annotation-text-plus": "+",
  "annotation-text-minus": "−",
  "annotation-ellipsis": "•••",
};

const CONTROLLED_SOURCE_LIBRARY_MARKS: Readonly<Record<string, string>> = {
  vcvs: "E",
  vccs: "G",
  cccs: "F",
  ccvs: "H",
};

function libraryLabel(symbolId: string, symbolName: string): string {
  return (
    COMPACT_LIBRARY_LABELS[symbolId] ?? libraryDisplayName(symbolId, symbolName)
  );
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
  if (symbolId === "no-connect")
    return { kind: "no-connect", symbolId, symbolName: "No Connect" };
  const drawingTool = annotationDrawingTool(symbolId);
  if (drawingTool) {
    return {
      kind: "drawing-tool",
      symbolId,
      symbolName: symbol.name,
      tool: drawingTool,
    };
  }
  const polarity = annotationPolarity(symbolId);
  if (polarity) {
    return {
      kind: "polarity-annotation",
      symbolId,
      symbolName: symbol.name,
      polarity,
      initialRotation: 0,
    };
  }
  const textPreset = annotationTextPreset(symbolId);
  if (textPreset) {
    return {
      kind: "drafting-text",
      symbolId,
      symbolName: symbol.name,
      text: textPreset,
      initialRotation: 0,
    };
  }
  if (symbolId === "vdd") {
    return {
      kind: "vdd-rail",
      symbolId: "vdd",
      symbolName: "Power Rail",
      netName: "VDD",
    };
  }
  if (symbolId === "port" || symbolId === "port-filled") {
    return {
      kind: "symbol",
      symbolId,
      symbolName: symbol.name,
      parameters: {},
      initialRotation: 0,
      showReference: false,
      referenceText: null,
      showValue: false,
      portDirection: "passive",
    };
  }
  return {
    kind: "symbol",
    symbolId: symbol.id,
    symbolName: symbol.name,
    // Quick-place follows the full Insert dialog's existing blank-value
    // semantics. Placeholders remain hints rather than silently persisted
    // electrical parameters.
    parameters: initialComponentParameterValues(symbolId),
    initialRotation: 0,
    showReference: true,
    referenceText: null,
    showValue: false,
  };
}

/** What a component fold receives from the panel it sits in. */
export interface LibraryFold {
  open: boolean;
  /** The panel's search, which Official components share. */
  query: string;
  /** Where the fold's header keeps its list's own tools. */
  toolsSlot: HTMLElement | null;
  /** Typing on a row continues the search, as in a file explorer. */
  focusSearch(): void;
}

export interface ShapesPanelProps {
  styleProfileId: string;
  open: boolean;
  onStartInsert(launch: InsertLaunch): void;
  /** A dragged tile places once where the pointer is released. */
  onDropPlacement?(clientX: number, clientY: number): void;
  /** Components beyond the official set, loaded once their fold opens or a
   * search runs: the public catalog, or the desktop's private library. */
  userComponents?: {
    label: string;
    open: boolean;
    onOpenChange(open: boolean): void;
    /** Each new value brings focus to the search. */
    focusRequest: number;
    onCreate(): void;
    render(fold: LibraryFold): ReactNode;
  };
}

export function ShapesPanel({
  styleProfileId,
  open,
  onStartInsert,
  onDropPlacement,
  userComponents,
}: ShapesPanelProps) {
  const [query, setQuery] = useState("");
  const searching = query.trim().length > 0;
  const libraryGroups = componentCatalog(styleProfileId, query);
  const librarySymbolCount = libraryGroups.reduce(
    (count, group) => count + group.symbols.length,
    0,
  );
  const [openCategories, setOpenCategories] = useState<ReadonlySet<string>>(
    () => new Set(libraryGroups.map((group) => group.category)),
  );
  const [officialOpen, setOfficialOpen] = useState(true);
  const [componentTools, setComponentTools] = useState<HTMLElement | null>(
    null,
  );
  const panel = useRef<HTMLElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const focusSearch = () => search.current?.focus();
  const suppressClick = useRef(false);
  const componentsShown = Boolean(userComponents?.open || searching);
  // Once loaded it keeps its list while the fold is shut.
  const componentsLoaded = useRef(false);
  componentsLoaded.current ||= componentsShown;
  const focusRequest = userComponents?.focusRequest ?? 0;
  useEffect(() => {
    if (focusRequest && open) search.current?.focus();
  }, [focusRequest, open]);

  function placeSymbol(symbolId: string): void {
    const request = quickPlaceRequest(styleProfileId, symbolId);
    if (request) onStartInsert({ kind: "quick", request });
  }

  /** Drawing tools and rails have no single point to land on. */
  function beginTileDrag(symbolId: string): boolean {
    const request = quickPlaceRequest(styleProfileId, symbolId);
    if (request?.kind !== "symbol") return false;
    onStartInsert({ kind: "quick", request });
    return true;
  }

  function onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    const results = () =>
      panel.current?.querySelector<HTMLElement>(
        ".shapes-chip, .component-row-main:not([aria-disabled='true'])",
      );
    if (event.key === "Escape") {
      event.preventDefault();
      if (query) setQuery("");
      else event.currentTarget.blur();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      results()?.focus();
    } else if (event.key === "Enter" && searching) {
      event.preventDefault();
      // An official device wins over a community record of the same name.
      (
        panel.current?.querySelector<HTMLElement>(".shapes-chip") ?? results()
      )?.click();
    }
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
      ref={panel}
    >
      <div className="shapes-panel-search">
        <input
          ref={search}
          type="search"
          autoComplete="off"
          placeholder="Search components"
          aria-label="Search components"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={onSearchKeyDown}
        />
      </div>
      <div className="shapes-panel-body">
        {userComponents ? (
          // Above the long official list, shut, so it costs one line and is
          // still the first thing the panel names.
          <details
            className="shapes-fold"
            open={componentsShown}
            data-testid="shapes-fold-user-components"
            onToggle={(event) => {
              if (!searching)
                userComponents.onOpenChange(event.currentTarget.open);
            }}
          >
            <summary className="shapes-fold-summary">
              <span className="shapes-fold-label">{userComponents.label}</span>
              <span className="shapes-fold-tools" ref={setComponentTools} />
              <button
                type="button"
                className="shapes-fold-tool"
                aria-label="Create component"
                title="Create component"
                onClick={(event) => {
                  event.preventDefault();
                  userComponents.onCreate();
                }}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M8 3v10M3 8h10" />
                </svg>
              </button>
            </summary>
            <div className="shapes-fold-body">
              {componentsLoaded.current
                ? userComponents.render({
                    open: componentsShown,
                    query,
                    toolsSlot: componentTools,
                    focusSearch,
                  })
                : null}
            </div>
          </details>
        ) : null}
        <details
          className="shapes-fold"
          open={officialOpen || searching}
          data-testid="shapes-fold-library"
          onToggle={(event) => {
            if (!searching) setOfficialOpen(event.currentTarget.open);
          }}
        >
          <summary className="shapes-fold-summary">
            <span className="shapes-fold-label">
              <span className="shapes-fold-label-full">
                Official components
              </span>
              <span className="shapes-fold-label-compact">Official</span>
            </span>
            <span className="shapes-fold-count">{librarySymbolCount}</span>
          </summary>
          <div className="shapes-fold-body">
            <div className="shapes-category-list">
              {libraryGroups.map((group) => (
                <details
                  key={group.category}
                  className="shapes-category"
                  open={searching || openCategories.has(group.category)}
                  data-testid={`shapes-category-${categorySlug(group.category)}`}
                  onToggle={(event) => {
                    if (!searching)
                      setCategoryOpen(group.category, event.currentTarget.open);
                  }}
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
                        aria-label={`Place ${libraryDisplayName(
                          symbol.id,
                          symbol.name,
                        )}`}
                        title={
                          libraryDescription(symbol.id) ??
                          `Place ${libraryDisplayName(symbol.id, symbol.name)}`
                        }
                        onPointerDown={(event) =>
                          startCanvasDrag(event, {
                            begin: () => beginTileDrag(symbol.id),
                            drop: (x, y) => onDropPlacement?.(x, y),
                            suppressClick,
                          })
                        }
                        onClick={(event) => {
                          event.currentTarget.blur();
                          if (!suppressClick.current) placeSymbol(symbol.id);
                        }}
                      >
                        <SymbolArtwork
                          symbol={symbol}
                          className="shapes-chip-art"
                          paddingRatio={0.04}
                          {...(CONTROLLED_SOURCE_LIBRARY_MARKS[symbol.id]
                            ? {
                                libraryMark:
                                  CONTROLLED_SOURCE_LIBRARY_MARKS[symbol.id]!,
                              }
                            : {})}
                        />
                        <span>{libraryLabel(symbol.id, symbol.name)}</span>
                      </button>
                    ))}
                  </div>
                </details>
              ))}
              {searching && !libraryGroups.length ? (
                <p className="user-components-message">
                  No official component matches “{query.trim()}”.
                </p>
              ) : null}
            </div>
          </div>
        </details>
      </div>
    </aside>
  );
}
