import { useState } from "react";
import {
  CellSymbolPresentationSchema,
  projectCellInterface,
  type CellSymbolPresentation,
  type SchematicDocument,
} from "@icm/model";
import { createHierarchicalBlockSymbol } from "@icm/symbols";
import { SymbolArtwork } from "../component-insert/symbol-artwork";

/** Definition preview: never manufacture a caller just to edit its master. */
export function CellSymbolReview({
  cell,
  onApply,
}: {
  cell: SchematicDocument;
  onApply(presentation: CellSymbolPresentation | null): void;
}) {
  const [draft, setDraft] = useState<CellSymbolPresentation>(
    cell.presentation.cellSymbol ?? {},
  );
  const [error, setError] = useState("");
  const ports = projectCellInterface(cell.netlist).ports;
  const parsed = CellSymbolPresentationSchema.safeParse(draft);
  const symbol = parsed.success
    ? createHierarchicalBlockSymbol({
        ...cell,
        presentation: { ...cell.presentation, cellSymbol: parsed.data },
      })
    : null;
  const setPin = (id: string, side: string, offset: number) => {
    const placements =
      draft.pinPlacements?.filter((p) => p.terminalId !== id) ?? [];
    if (side !== "auto")
      placements.push({
        terminalId: id,
        side: side as "west" | "east" | "north" | "south",
        offset,
      });
    setDraft({ ...draft, pinPlacements: placements });
  };
  if (!cell.netlist)
    return <p>Create a formal Cell interface before using it as a DUT.</p>;
  return (
    <details className="cell-symbol-review">
      <summary>Review Symbol</summary>
      <p>
        Preview only until Apply. Pin order and electrical connections do not
        change.
      </p>
      {ports.length === 0 && <p>This Cell has a valid zero-port interface.</p>}
      <div style={{ width: 300, maxWidth: "100%", height: 170 }}>
        {symbol && (
          <SymbolArtwork
            symbol={symbol}
            className="cell-symbol-review-artwork"
          />
        )}
      </div>
      <div>
        {(["width", "height"] as const).map((axis) => (
          <label key={axis}>
            Minimum body {axis}
            <input
              aria-label={`Symbol ${axis}`}
              type="number"
              min="10"
              step="10"
              value={draft.minimumBodySize?.[axis] ?? ""}
              placeholder="Auto"
              onChange={(e) =>
                setDraft({
                  ...draft,
                  minimumBodySize:
                    e.target.value === ""
                      ? undefined
                      : {
                          width: draft.minimumBodySize?.width ?? 80,
                          height: draft.minimumBodySize?.height ?? 40,
                          [axis]: Number(e.target.value),
                        },
                })
              }
            />
          </label>
        ))}
      </div>
      {ports.map((port) => {
        const pin = draft.pinPlacements?.find((p) => p.terminalId === port.id);
        return (
          <div key={port.id}>
            <label>
              {port.name} side{" "}
              <select
                aria-label={`${port.name} symbol side`}
                value={pin?.side ?? "auto"}
                onChange={(e) =>
                  setPin(port.id, e.target.value, pin?.offset ?? 0)
                }
              >
                {["auto", "west", "east", "north", "south"].map((side) => (
                  <option key={side}>{side}</option>
                ))}
              </select>
            </label>
            <label>
              Offset{" "}
              <input
                aria-label={`${port.name} symbol offset`}
                type="number"
                step="10"
                disabled={!pin}
                value={pin?.offset ?? 0}
                onChange={(e) =>
                  setPin(port.id, pin?.side ?? "auto", Number(e.target.value))
                }
              />
            </label>
          </div>
        );
      })}
      <p role="status">
        {!parsed.success ? parsed.error.issues[0]?.message : error}
      </p>
      <button
        type="button"
        disabled={!parsed.success}
        onClick={() => {
          try {
            if (parsed.success) onApply(parsed.data);
            setError("");
          } catch (cause) {
            setError(
              cause instanceof Error
                ? cause.message
                : "Could not update Symbol",
            );
          }
        }}
      >
        Apply Symbol
      </button>
      <button
        type="button"
        onClick={() => {
          setDraft({});
          onApply(null);
        }}
      >
        Use default Symbol
      </button>
    </details>
  );
}
