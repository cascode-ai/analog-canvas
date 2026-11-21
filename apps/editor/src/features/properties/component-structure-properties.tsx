import type { BlockSymbolLayoutTarget } from "../hierarchy/block-symbol-layout-target";
import { hierarchicalBlockBodySize } from "@icm/symbols";
import { PropertyActionRow } from "./property-action-row";

type PinSide = "north" | "east" | "south" | "west" | "auto";

export interface CellSymbolLayoutProps {
  target: BlockSymbolLayoutTarget;
  readOnly?: boolean;
  onReset?: () => void;
  onBodySizeChange: (width: number, height: number) => void;
  onPortPlacementChange: (
    terminalId: string,
    side: PinSide,
    offset: number,
  ) => void;
}

/**
 * The one symbol control a selected block keeps in Properties: its on-canvas
 * grips. Size, sides and offsets belong to the definition's own sheet.
 */
export function InstanceSymbolLayoutRow({
  target,
  instanceSymbolId,
  enabled,
  onToggle,
}: {
  target: BlockSymbolLayoutTarget;
  instanceSymbolId: string;
  enabled: boolean;
  onToggle: () => void;
}) {
  // An external occurrence can retain its own captured artwork after the
  // definition switches back to its automatic block; custom artwork owns its
  // geometry.
  if (target.kind === "external" && instanceSymbolId !== target.id) return null;
  if (target.presentation?.artwork) return null;
  return (
    <PropertyActionRow
      label="Symbol layout"
      note={
        enabled
          ? "Drag an edge or corner to resize. Select pin dots or frame them to arrange a group."
          : undefined
      }
    >
      <button type="button" aria-pressed={enabled} onClick={onToggle}>
        Edit on canvas
      </button>
    </PropertyActionRow>
  );
}

/** A definition's full block layout, edited where the definition is. */
export function CellSymbolLayoutProperties({
  target,
  readOnly = false,
  onBodySizeChange,
  onPortPlacementChange,
  onReset,
}: CellSymbolLayoutProps) {
  // Custom artwork owns its geometry; the automatic layout waits beside it.
  if (target.presentation?.artwork)
    return (
      <div
        className="cell-symbol-layout-properties"
        aria-label="Cell symbol layout"
      >
        <div className="property-section-heading">Cell symbol</div>
        <small>
          Blocks using the {target.name} Cell symbol share this artwork.
        </small>
      </div>
    );
  const automaticSize = hierarchicalBlockBodySize(target.terminals);
  const actualSize = hierarchicalBlockBodySize(
    target.terminals,
    target.presentation,
  );
  const bodySize = target.presentation?.bodyBounds
    ? actualSize
    : target.presentation?.minimumBodySize;
  return (
    <div
      className="cell-symbol-layout-properties"
      aria-label="Cell symbol layout"
    >
      <div className="property-section-heading">Cell symbol layout</div>
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
