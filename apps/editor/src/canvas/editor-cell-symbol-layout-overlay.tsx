import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { transformPoint, type Point, type SchematicDocument } from "@icm/model";
import type { SymbolDefinition, SymbolPin } from "@icm/symbols";
import { ComponentPlacementPreview } from "../features/component-insert/component-placement-preview";

type Placement = NonNullable<
  SchematicDocument["instances"][number]["placement"]
>;

export function EditorCellSymbolLayoutOverlay({
  placement,
  body,
  pins,
  onDragStart,
  onDragPreview,
  onDragCancel,
}: {
  placement: Placement;
  body: { left: number; right: number; top: number; bottom: number };
  pins: readonly { terminalId: string; pin: SymbolPin }[];
  onDragPreview?: (
    event: ReactPointerEvent<SVGGElement>,
  ) => SymbolDefinition | null;
  onDragCancel?: () => void;
  onDragStart: (
    event: ReactPointerEvent<SVGCircleElement>,
    kind: "body" | "pin",
    terminalId?: string,
  ) => void;
}) {
  // Keep pointer feedback local to the overlay; do not rebuild the Project,
  // routing or the whole editor for every pointer sample.
  const [preview, setPreview] = useState<SymbolDefinition | null>(null);
  const pending = useRef<SymbolDefinition | null>(null);
  const frame = useRef<number | null>(null);
  const clearPreview = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    pending.current = null;
    setPreview(null);
  };
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );
  const previewBody = preview?.primitives.find(
    (primitive) => primitive.kind === "polygon",
  );
  if (previewBody?.kind === "polygon") {
    body = {
      left: Math.min(...previewBody.points.map((point) => point.x)),
      right: Math.max(...previewBody.points.map((point) => point.x)),
      top: Math.min(...previewBody.points.map((point) => point.y)),
      bottom: Math.max(...previewBody.points.map((point) => point.y)),
    };
  }
  if (preview)
    pins = pins.map(({ terminalId, pin }) => ({
      terminalId,
      pin: preview.pins.find((candidate) => candidate.name === pin.name) ?? pin,
    }));
  const world = (point: Point) =>
    transformPoint(point, placement.position, placement);
  const bodyCorner = world({ x: body.right, y: body.bottom });
  return (
    <g
      className="cell-symbol-layout-overlay"
      data-testid="cell-symbol-layout-overlay"
      onPointerMove={(event) => {
        const next = onDragPreview?.(event);
        if (!next) return;
        event.stopPropagation();
        pending.current = next;
        if (frame.current === null)
          frame.current = requestAnimationFrame(() => {
            frame.current = null;
            setPreview(pending.current);
          });
      }}
      onPointerUp={clearPreview}
      onPointerCancel={() => {
        clearPreview();
        onDragCancel?.();
      }}
      onLostPointerCapture={() => {
        clearPreview();
        onDragCancel?.();
      }}
    >
      {preview ? (
        <g
          className="cell-symbol-layout-preview"
          data-testid="cell-symbol-layout-preview"
        >
          <ComponentPlacementPreview
            symbol={preview}
            symbolId={preview.id}
            styleProfileId="razavi-textbook"
            position={placement.position}
            rotation={placement.rotation}
            mirror={placement.mirror}
          />
        </g>
      ) : null}
      <circle
        data-testid="cell-symbol-body-handle"
        className="cell-symbol-layout-handle body"
        cx={bodyCorner.x}
        cy={bodyCorner.y}
        r="7"
        onPointerDown={(event) => onDragStart(event, "body")}
      />
      {pins.map(({ terminalId, pin }) => {
        const bodyPoint =
          pin.direction === "west"
            ? { x: body.left, y: pin.at.y }
            : pin.direction === "east"
              ? { x: body.right, y: pin.at.y }
              : pin.direction === "north"
                ? { x: pin.at.x, y: body.top }
                : { x: pin.at.x, y: body.bottom };
        const pinPoint = world(bodyPoint);
        return (
          <circle
            key={terminalId}
            data-testid={`cell-symbol-pin-handle-${terminalId}`}
            className="cell-symbol-layout-handle pin"
            cx={pinPoint.x}
            cy={pinPoint.y}
            r="6"
            onPointerDown={(event) => onDragStart(event, "pin", terminalId)}
          />
        );
      })}
    </g>
  );
}
