import type { BlockSymbolLayoutTarget } from "../hierarchy/block-symbol-layout-target";

type PinSide = "north" | "east" | "south" | "west" | "auto";

export function CellSymbolLayoutProperties({
  target,
  enabled,
  onToggle,
  onBodySizeChange,
  onPortPlacementChange,
}: {
  target: BlockSymbolLayoutTarget;
  enabled: boolean;
  onToggle: () => void;
  onBodySizeChange: (width: number, height: number) => void;
  onPortPlacementChange: (
    terminalId: string,
    side: PinSide,
    offset: number,
  ) => void;
}) {
  const bodySize = target.presentation?.minimumBodySize;
  return (
    <div
      className="cell-symbol-layout-properties"
      aria-label="Cell symbol layout"
    >
      <div className="property-section-heading">Cell symbol layout</div>
      <button
        type="button"
        className="cell-symbol-layout-toggle"
        aria-pressed={enabled}
        onClick={onToggle}
      >
        {enabled
          ? "Done editing canvas layout"
          : "Edit symbol layout on canvas"}
      </button>
      {enabled ? (
        <small>
          Drag the corner to resize, or a pin dot to change its side and offset.
        </small>
      ) : null}
      <div className="component-geometry-row">
        <label>
          Width
          <input
            key={`${target.id}-${target.revision}-symbol-width`}
            aria-label="Cell symbol width"
            autoComplete="off"
            defaultValue={String(bodySize?.width ?? 100)}
            inputMode="numeric"
            onBlur={(event) =>
              onBodySizeChange(
                Number(event.currentTarget.value),
                bodySize?.height ?? 60,
              )
            }
          />
        </label>
        <label>
          Height
          <input
            key={`${target.id}-${target.revision}-symbol-height`}
            aria-label="Cell symbol height"
            autoComplete="off"
            defaultValue={String(bodySize?.height ?? 60)}
            inputMode="numeric"
            onBlur={(event) =>
              onBodySizeChange(
                bodySize?.width ?? 100,
                Number(event.currentTarget.value),
              )
            }
          />
        </label>
      </div>
      <table className="cell-symbol-pin-layout-table">
        <thead>
          <tr>
            <th scope="col">Pin</th>
            <th scope="col">Side</th>
            <th scope="col">Offset</th>
          </tr>
        </thead>
        <tbody>
          {target.terminals.map((terminal) => {
            const pinPlacement = target.presentation?.pinPlacements?.find(
              (placement) => placement.terminalId === terminal.id,
            );
            return (
              <tr key={terminal.id}>
                <th scope="row" title={terminal.name}>
                  {terminal.name}
                </th>
                <td>
                  <select
                    key={`${target.revision}-${terminal.id}-side`}
                    aria-label={`Cell symbol ${terminal.name} pin side`}
                    defaultValue={pinPlacement?.side ?? "auto"}
                    onChange={(event) =>
                      onPortPlacementChange(
                        terminal.id,
                        event.currentTarget.value as PinSide,
                        pinPlacement?.offset ?? 0,
                      )
                    }
                  >
                    <option value="auto">Auto</option>
                    <option value="west">Left</option>
                    <option value="east">Right</option>
                    <option value="north">Top</option>
                    <option value="south">Bottom</option>
                  </select>
                </td>
                <td>
                  <input
                    key={`${target.revision}-${terminal.id}-offset`}
                    aria-label={`Cell symbol ${terminal.name} pin offset`}
                    autoComplete="off"
                    defaultValue={String(pinPlacement?.offset ?? 0)}
                    inputMode="numeric"
                    onBlur={(event) =>
                      onPortPlacementChange(
                        terminal.id,
                        pinPlacement?.side ?? "auto",
                        Number(event.currentTarget.value),
                      )
                    }
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
