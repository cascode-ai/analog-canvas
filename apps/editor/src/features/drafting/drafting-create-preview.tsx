import type { Point } from "@icm/model";
import type { SchematicStyleProfile } from "@icm/derived";

import {
  normalizedRect,
  serializePolylinePoints,
} from "../../canvas/canvas-geometry";
import type { EditorTool } from "../../interaction/interaction-state";
import {
  DEFAULT_ARROW_PRESET,
  outlinePlacement,
  type ArrowPreset,
} from "./arrow-presets";
import { ArrowArtworkView } from "./arrow-artwork-view";

export interface DraftingCreatePreviewProps {
  tool: EditorTool;
  start: Point | null;
  arrowPreset?: ArrowPreset;
  waypoints: Point[];
  hover: Point;
  snap: Point | null;
  styleProfile: SchematicStyleProfile;
}

/** Transient Canvas overlay for two-phase drafting creation. */
export function DraftingCreatePreview({
  tool,
  start: source,
  arrowPreset = DEFAULT_ARROW_PRESET,
  waypoints,
  hover,
  snap,
  styleProfile,
}: DraftingCreatePreviewProps) {
  const isOutline = tool === "arrow" && arrowPreset.family === "outline";
  const placement = isOutline ? outlinePlacement(source, hover) : null;
  const start = placement?.from ?? source ?? hover;
  const end = placement?.to ?? hover;
  const path = [start, ...waypoints, end];
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const rectangle = normalizedRect(start, hover);
  const isRectangle = tool === "rectangle";
  const isCircle = tool === "circle";
  const labelX = start.x + dx / 2;
  const labelY = start.y + dy / 2 - 8;

  return (
    <g data-testid="drafting-create-preview" pointerEvents="none">
      {tool === "arrow" ? (
        <ArrowArtworkView
          object={{
            styleOverride: {
              arrowHead: arrowPreset.head,
              arrowHeadAt: arrowPreset.at,
            },
            ...(placement ? { outline: { width: placement.width } } : {}),
          }}
          points={path}
          profile={styleProfile}
          color="#246bfd"
        />
      ) : isRectangle ? (
        <rect className="drafting-create-preview" {...rectangle} fill="none" />
      ) : isCircle ? (
        <circle
          className="drafting-create-preview"
          cx={start.x}
          cy={start.y}
          r={length}
          fill="none"
        />
      ) : (
        <polyline
          className="drafting-create-preview"
          points={serializePolylinePoints(path)}
          fill="none"
        />
      )}
      <circle
        className="drafting-create-anchor"
        cx={start.x}
        cy={start.y}
        r="3"
      />
      <circle
        className="drafting-create-anchor draft-create-anchor-end"
        cx={end.x}
        cy={end.y}
        r="3"
      />
      {!isRectangle &&
        !isCircle &&
        waypoints.map((point, index) => (
          <circle
            key={`draft-preview-vx-${index}`}
            className="drafting-create-anchor draft-create-anchor-vx"
            cx={point.x}
            cy={point.y}
            r="2.5"
          />
        ))}
      {snap ? (
        <circle
          className="drafting-create-snap"
          cx={snap.x}
          cy={snap.y}
          r="6"
        />
      ) : null}
      <text
        className="drafting-create-readout"
        x={labelX}
        y={labelY}
        textAnchor="middle"
      >
        {isRectangle
          ? `${Math.round(rectangle.width)} × ${Math.round(rectangle.height)}`
          : isCircle
            ? `r ${Math.round(length)}`
            : `${Math.round(length)} · ${Math.round(angle)}°`}
      </text>
    </g>
  );
}
