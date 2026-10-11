import type { BlockSymbolLayoutTarget } from "../hierarchy/block-symbol-layout-target";
import { hierarchicalBlockBodySize } from "@icm/symbols";

type PinSide = "north" | "east" | "south" | "west" | "auto";

export function CellSymbolLayoutProperties({
  target,
  enabled,
  readOnly = false,
  onToggle,
  onBodySizeChange,
  onPortPlacementChange,
  onReset,
}: {
  target: BlockSymbolLayoutTarget;
  enabled: boolean;
  readOnly?: boolean;
  onToggle?: () => void;
  onReset?: () => void;
  onBodySizeChange: (width: number, height: number) => void;
  onPortPlacementChange: (
    terminalId: string,
    side: PinSide,
    offset: number,
  ) => void;
}) {
  const bodySize = target.presentation?.minimumBodySize;
  const automaticSize = hierarchicalBlockBodySize(target.terminals);
  const actualSize = hierarchicalBlockBodySize(
    target.terminals,
    target.presentation,
  );
  return (
    <div
      className="cell-symbol-layout-properties"
      aria-label="Cell symbol layout"
    >
      <div className="property-section-heading">Cell symbol layout</div>
      {onToggle ? (
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
      ) : null}
      {enabled ? (
        <small>
          Drag the corner to resize, or a pin dot to change its side and offset.
        </small>
      ) : null}
      <div className="component-geometry-row">
        <label>
          Minimum width
          <input
            key={`${target.id}-${target.revision}-symbol-width`}
            disabled={readOnly}
            aria-label="Cell symbol width"
            autoComplete="off"
            placeholder="Auto"
            defaultValue={bodySize ? String(bodySize.width) : ""}
            inputMode="numeric"
            onBlur={(event) =>
              onBodySizeChange(
                event.currentTarget.value.trim()
                  ? Number(event.currentTarget.value)
                  : automaticSize.width,
                bodySize?.height ?? automaticSize.height,
              )
            }
          />
        </label>
        <label>
          Minimum height
          <input
            key={`${target.id}-${target.revision}-symbol-height`}
            disabled={readOnly}
            aria-label="Cell symbol height"
            autoComplete="off"
            placeholder="Auto"
            defaultValue={bodySize ? String(bodySize.height) : ""}
            inputMode="numeric"
            onBlur={(event) =>
              onBodySizeChange(
                bodySize?.width ?? automaticSize.width,
                event.currentTarget.value.trim()
                  ? Number(event.currentTarget.value)
                  : automaticSize.height,
              )
            }
          />
        </label>
      </div>
      <small>
        Actual size: {actualSize.width} × {actualSize.height}
      </small>
      {onReset ? (
        <button
          type="button"
          disabled={readOnly || !target.presentation}
          onClick={onReset}
        >
          Reset layout
        </button>
      ) : null}
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
                    disabled={readOnly}
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
                    disabled={readOnly || !pinPlacement}
                    title={
                      !pinPlacement
                        ? "Choose a side to set an offset."
                        : undefined
                    }
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
