import type { MouseEvent as ReactMouseEvent, Ref } from "react";

import type { Flightline } from "@icm/derived";
import type { Point } from "@icm/model";

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
  bulkRoutePreview,
  snapGuideLayerRef,
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
  bulkRoutePreview: boolean;
  snapGuideLayerRef: Ref<SVGGElement>;
}) {
  return (
    <>
      {netLabelPlacement?.phase === "naming" ? (
        <foreignObject
          data-testid="net-label-editor"
          x={netLabelPlacement.position.x + 8}
          y={netLabelPlacement.position.y - 42}
          width="160"
          height="34"
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
      <g ref={snapGuideLayerRef} data-layer="snap-guides" />
    </>
  );
}
