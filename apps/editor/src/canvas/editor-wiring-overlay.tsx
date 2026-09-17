import {
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type Ref,
} from "react";

import type { Flightline } from "@icm/derived";
import type { GridRect, Point } from "@icm/model";

import type { WireDraftPreview } from "../features/wiring/wire-draft-preview";
import { serializePolylinePoints } from "./canvas-geometry";

export function EditorWiringOverlay({
  netLabelPlacement,
  netLabelEditorInputRef,
  onNetLabelDraftChange,
  onNetLabelSubmit,
  onNetLabelEscape,
  flightlines,
  onFlightlineClick,
  wireDraftPreview,
  wireSnapTarget,
  bulkRoutePreview,
  snapGuideLayerRef,
  viewBox,
}: {
  netLabelPlacement: {
    phase: "naming" | "placing";
    draft: string;
    position: Point;
  } | null;
  netLabelEditorInputRef: Ref<HTMLInputElement>;
  onNetLabelDraftChange: (value: string) => void;
  onNetLabelSubmit: () => void;
  onNetLabelEscape: () => void;
  flightlines: readonly Flightline[];
  onFlightlineClick: (
    event: ReactMouseEvent<SVGLineElement>,
    flightline: Flightline,
  ) => void;
  wireDraftPreview: WireDraftPreview;
  wireSnapTarget?: Point | undefined;
  bulkRoutePreview: boolean;
  snapGuideLayerRef: Ref<SVGGElement>;
  viewBox: GridRect;
}) {
  const labelAnchorRef = useRef<SVGGElement | null>(null);
  const [pixelsPerUnit, setPixelsPerUnit] = useState<number | null>(null);
  useLayoutEffect(() => {
    const svg = labelAnchorRef.current?.ownerSVGElement;
    if (!svg || viewBox.width <= 0 || viewBox.height <= 0) return;
    const measure = () => {
      const rect = svg.getBoundingClientRect();
      setPixelsPerUnit(
        Math.min(rect.width / viewBox.width, rect.height / viewBox.height),
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(svg);
    return () => observer.disconnect();
  }, [netLabelPlacement?.phase, viewBox.height, viewBox.width]);
  const labelScale =
    pixelsPerUnit && pixelsPerUnit > 0
      ? 1 / pixelsPerUnit
      : (viewBox.width * 0.26) / 164;
  const labelWidth = Math.max(
    0,
    Math.min(164, (viewBox.width - 16) / labelScale),
  );
  const labelHeight = 30;
  const labelX = netLabelPlacement
    ? Math.max(
        viewBox.x + 8,
        Math.min(
          viewBox.x + viewBox.width - labelWidth * labelScale - 8,
          netLabelPlacement.position.x + 8,
        ),
      )
    : 0;
  const labelY = netLabelPlacement
    ? Math.max(
        viewBox.y + 8,
        Math.min(
          viewBox.y + viewBox.height - labelHeight * labelScale - 8,
          netLabelPlacement.position.y - labelHeight * labelScale - 8,
        ),
      )
    : 0;
  return (
    <>
      {netLabelPlacement?.phase === "naming" ? (
        <g
          ref={labelAnchorRef}
          transform={`translate(${labelX} ${labelY}) scale(${labelScale})`}
        >
          <foreignObject
            data-testid="net-label-editor"
            width={labelWidth}
            height={labelHeight}
          >
            <form
              className="net-label-editor"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
              onSubmit={(event) => {
                event.preventDefault();
                onNetLabelSubmit();
              }}
            >
              <input
                ref={netLabelEditorInputRef}
                aria-label="Net Label"
                autoComplete="off"
                value={netLabelPlacement.draft}
                onChange={(event) =>
                  onNetLabelDraftChange(event.currentTarget.value)
                }
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    onNetLabelEscape();
                  }
                }}
              />
            </form>
          </foreignObject>
        </g>
      ) : null}
      {netLabelPlacement?.phase === "placing" ? (
        <g data-testid="net-label-placement-preview" pointerEvents="none">
          <text
            className="net-label-placement-preview"
            x={netLabelPlacement.position.x}
            y={netLabelPlacement.position.y}
          >
            {netLabelPlacement.draft}
          </text>
        </g>
      ) : null}
      {flightlines.map((flightline) => (
        <g key={flightline.id}>
          <line
            data-testid="flightline-hit"
            className="flightline-hit"
            data-net-id={flightline.netId}
            x1={flightline.fromPoint.x}
            y1={flightline.fromPoint.y}
            x2={flightline.toPoint.x}
            y2={flightline.toPoint.y}
            onClick={(event) => onFlightlineClick(event, flightline)}
          />
          <line
            data-testid="flightline"
            className="flightline"
            data-net-id={flightline.netId}
            x1={flightline.fromPoint.x}
            y1={flightline.fromPoint.y}
            x2={flightline.toPoint.x}
            y2={flightline.toPoint.y}
          />
        </g>
      ))}
      {wireDraftPreview.points.length >= 2 ? (
        <polyline
          data-testid="wire-preview"
          className={
            bulkRoutePreview
              ? "wire-preview bulk-route-preview"
              : "wire-preview"
          }
          points={serializePolylinePoints(wireDraftPreview.points)}
        />
      ) : null}
      {/* A pin the run passes straight through is a connection the release
          will make. Drawing the contact is the difference between a wire
          that looks like it crosses a pin and one that reads as joining
          it. */}
      {wireDraftPreview.points.length >= 2
        ? wireDraftPreview.contacts.map((contact) => (
            <circle
              key={`${contact.x}:${contact.y}`}
              data-testid="wire-preview-contact"
              className="wire-preview-contact"
              cx={contact.x}
              cy={contact.y}
              r={3}
            />
          ))
        : null}
      {wireSnapTarget ? (
        <circle
          data-testid="wire-snap-target"
          className="wire-snap-target"
          cx={wireSnapTarget.x}
          cy={wireSnapTarget.y}
          r={5}
          pointerEvents="none"
        />
      ) : null}
      <g ref={snapGuideLayerRef} data-layer="snap-guides" />
    </>
  );
}
