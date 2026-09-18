import type { MouseEvent as ReactMouseEvent, Ref } from "react";

import {
  razaviTextbookProfile,
  type Flightline,
  type SchematicStyleProfile,
} from "@icm/derived";
import type { GridRect, Point, RichTextDocument } from "@icm/model";
import { renderRichTextDocument } from "@icm/render-svg";

import { CanvasTextEditorOverlay } from "../features/text-editing/canvas-text-editor-overlay";
import type { WireDraftPreview } from "../features/wiring/wire-draft-preview";
import { serializePolylinePoints } from "./canvas-geometry";

export function EditorWiringOverlay({
  netLabelPlacement,
  onNetLabelTextChange,
  onNetLabelSubmit,
  onNetLabelEscape,
  flightlines,
  onFlightlineClick,
  wireDraftPreview,
  wireSnapTarget,
  bulkRoutePreview,
  snapGuideLayerRef,
  viewBox,
  styleProfile = razaviTextbookProfile,
}: {
  netLabelPlacement: {
    phase: "naming" | "placing";
    content: RichTextDocument;
    sizeScale: number;
    alignment: "start" | "middle" | "end";
    position: Point;
  } | null;
  onNetLabelTextChange: (
    change: Partial<{
      content: RichTextDocument;
      sizeScale: number;
      alignment: "start" | "middle" | "end";
    }>,
  ) => void;
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
  styleProfile?: SchematicStyleProfile;
}) {
  const previewFontSize =
    styleProfile.typography.netFontSize * (netLabelPlacement?.sizeScale ?? 1);
  return (
    <>
      {netLabelPlacement?.phase === "naming" ? (
        <g data-testid="net-label-editor">
          <CanvasTextEditorOverlay
            session={{
              owner: "annotation",
              id: "pending-net-label",
              content: netLabelPlacement.content,
              sizeScale: netLabelPlacement.sizeScale,
              alignment: netLabelPlacement.alignment,
              defaultBold: true,
              defaultItalic: true,
              bound: true,
              bindingKind: "net-name",
            }}
            bounds={{
              x: netLabelPlacement.position.x,
              y: netLabelPlacement.position.y,
              width: 1,
              height: 1,
            }}
            viewBox={viewBox}
            disabled={false}
            onUpdate={onNetLabelTextChange}
            onCommit={onNetLabelSubmit}
            onCancel={onNetLabelEscape}
            onEscape={onNetLabelEscape}
            onDelete={onNetLabelEscape}
            showDelete={false}
          />
        </g>
      ) : null}
      {netLabelPlacement?.phase === "placing" ? (
        <g data-testid="net-label-placement-preview" pointerEvents="none">
          <text
            className="net-label-placement-preview"
            x={netLabelPlacement.position.x}
            y={netLabelPlacement.position.y}
            textAnchor={netLabelPlacement.alignment}
            fontSize={previewFontSize}
            dangerouslySetInnerHTML={{
              __html: renderRichTextDocument(
                netLabelPlacement.content,
                styleProfile,
                {
                  lineOriginX: netLabelPlacement.position.x,
                  fontSize: previewFontSize,
                  defaultBold: true,
                  defaultItalic: true,
                },
              ),
            }}
          />
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
