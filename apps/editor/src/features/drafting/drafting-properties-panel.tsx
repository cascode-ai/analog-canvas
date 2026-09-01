import {
  resolveDocumentStyleProfile,
  resolveDraftingObjectGeometry,
} from "@icm/derived";
import type { DraftingObject, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import { normalizedBearing } from "../../canvas/canvas-geometry";
import { ToolIcon } from "../editor-shell/tool-icon";
import { ColorOverrideControl } from "../properties/color-override-control";
import type {
  DraftingGeometryPatch,
  DraftingStylePatch,
} from "./drafting-manipulation";
import { quadraticTangentAngle } from "./drafting-path";

export interface DraftingPropertiesPanelProps {
  document: SchematicDocument;
  resolver: SymbolResolver;
  object: DraftingObject;
  defaultColor: string;
  inspectorSegment: { objectId: string; index: number } | null;
  tangentInput: { key: string; value: string } | null;
  bearingInput: { objectId: string; value: string } | null;
  onInspectorSegmentChange: (
    value: { objectId: string; index: number } | null,
  ) => void;
  onTangentInputChange: (value: { key: string; value: string } | null) => void;
  onBearingInputChange: (
    value: { objectId: string; value: string } | null,
  ) => void;
  onStyleChange: (patch: DraftingStylePatch) => void;
  onGeometryChange: (patch: DraftingGeometryPatch) => void;
  onTangentAngleChange: (angle: number) => void;
  onBearingChange: (bearing: number) => void;
  onReverse: () => void;
  onRotate: () => void;
  onToggleLock: () => void;
}

/** Property editor for authored arrows, construction lines, and rectangles. */
export function DraftingPropertiesPanel({
  document,
  resolver,
  object,
  defaultColor,
  inspectorSegment,
  tangentInput,
  bearingInput,
  onInspectorSegmentChange,
  onTangentInputChange,
  onBearingInputChange,
  onStyleChange,
  onGeometryChange,
  onTangentAngleChange,
  onBearingChange,
  onReverse,
  onRotate,
  onToggleLock,
}: DraftingPropertiesPanelProps) {
  const geometry = resolveDraftingObjectGeometry(document, resolver, object);
  if (geometry.kind === "text" && object.kind === "text") {
    const profile = resolveDocumentStyleProfile(document.presentation);
    return (
      <section
        className="property-section drafting-text-properties"
        aria-label="Drawing text properties"
        data-testid="drafting-properties"
      >
        <div className="property-card">
          <div className="property-section-heading">Text</div>
          <ColorOverrideControl
            label="Text color"
            value={object.styleOverride?.color}
            fallback={profile.foreground}
            disabled={object.locked}
            onChange={(color) => onStyleChange({ color })}
          />
          <small>Auto inherits the document text color.</small>
          <button
            type="button"
            className="drafting-text-lock"
            onClick={onToggleLock}
          >
            <ToolIcon name="lock" />
            {object.locked ? "Unlock" : "Lock"}
          </button>
        </div>
      </section>
    );
  }
  if (
    geometry.kind !== "arrow" &&
    geometry.kind !== "construction-line" &&
    geometry.kind !== "rectangle" &&
    geometry.kind !== "circle"
  ) {
    return null;
  }
  const lineStyle =
    object.styleOverride?.lineStyle ??
    (object.kind === "construction-line" ||
    object.kind === "rectangle" ||
    object.kind === "circle"
      ? object.lineStyle
      : "solid");
  const isRectangle = geometry.kind === "rectangle";
  const isCircle = geometry.kind === "circle";
  const points = isRectangle
    ? geometry.corners
    : isCircle
      ? []
      : geometry.points;
  const curveControls =
    isRectangle || isCircle
      ? points.slice(0, -1).map(() => null)
      : geometry.curveControls;
  const segmentIndex =
    inspectorSegment?.objectId === object.id
      ? inspectorSegment.index
      : Math.max(0, curveControls.findIndex(Boolean));
  const tangentAngle =
    isRectangle || isCircle
      ? 0
      : quadraticTangentAngle(
          points[segmentIndex]!,
          curveControls[segmentIndex] ?? null,
          points[segmentIndex + 1]!,
        );
  const tangentInputKey = `${object.id}:${segmentIndex}`;
  const realizedAngleText = String(Math.round(tangentAngle * 10) / 10);
  const tangentInputValue =
    tangentInput?.key === tangentInputKey
      ? tangentInput.value
      : realizedAngleText;
  const bearing = isRectangle
    ? geometry.rotation
    : isCircle
      ? 0
      : normalizedBearing(points[0]!, points[1]!);
  const realizedBearingText = String(Math.round(bearing * 10) / 10);
  const bearingInputValue =
    bearingInput?.objectId === object.id
      ? bearingInput.value
      : realizedBearingText;

  return (
    <section
      className="context-actions drawing-properties"
      aria-label="Drawing style"
      data-testid="drafting-properties"
    >
      <h2>Drawing style</h2>
      <label>
        Line style
        <select
          aria-label="Line style"
          value={lineStyle}
          disabled={object.locked}
          onChange={(event) =>
            onStyleChange({
              lineStyle: event.currentTarget.value as
                "solid" | "dashed" | "dotted",
            })
          }
        >
          <option value="solid">Solid</option>
          <option value="dashed">Dashed</option>
          <option value="dotted">Dotted</option>
        </select>
      </label>
      <label>
        Stroke width (×)
        <input
          aria-label="Stroke width"
          type="number"
          min="0.25"
          max="4"
          step="0.05"
          value={String(object.styleOverride?.strokeScale ?? 1)}
          disabled={object.locked}
          onChange={(event) => {
            const scale = Number(event.currentTarget.value);
            if (Number.isFinite(scale)) {
              onStyleChange({
                strokeScale: Math.min(4, Math.max(0.25, scale)),
              });
            }
          }}
        />
      </label>
      <ColorOverrideControl
        label="Stroke color"
        value={object.styleOverride?.color}
        fallback={defaultColor}
        disabled={object.locked}
        onChange={(color) => onStyleChange({ color })}
      />
      {isCircle && object.kind === "circle" ? (
        <label>
          Radius
          <input
            aria-label="Circle radius"
            type="number"
            min="1"
            step="1"
            value={String(object.radius)}
            disabled={object.locked}
            onChange={(event) => {
              const radius = Number(event.currentTarget.value);
              if (Number.isFinite(radius) && radius >= 1) {
                onGeometryChange({ radius });
              }
            }}
          />
        </label>
      ) : null}
      {isRectangle && object.kind === "rectangle" ? (
        <>
          <label>
            Width
            <input
              aria-label="Rectangle width"
              type="number"
              min="1"
              step="1"
              value={String(object.width)}
              disabled={object.locked}
              onChange={(event) => {
                const width = Number(event.currentTarget.value);
                if (Number.isFinite(width) && width >= 1) {
                  onGeometryChange({ width });
                }
              }}
            />
          </label>
          <label>
            Height
            <input
              aria-label="Rectangle height"
              type="number"
              min="1"
              step="1"
              value={String(object.height)}
              disabled={object.locked}
              onChange={(event) => {
                const height = Number(event.currentTarget.value);
                if (Number.isFinite(height) && height >= 1) {
                  onGeometryChange({ height });
                }
              }}
            />
          </label>
        </>
      ) : null}
      {object.kind === "construction-line" && points.length > 2 ? (
        <label>
          Curve segment
          <select
            aria-label="Curve segment"
            value={String(segmentIndex)}
            disabled={object.locked}
            onChange={(event) => {
              onInspectorSegmentChange({
                objectId: object.id,
                index: Number(event.currentTarget.value),
              });
              onTangentInputChange(null);
            }}
          >
            {points.slice(0, -1).map((_, index) => (
              <option key={index} value={index}>
                Segment {index + 1}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {!isRectangle && !isCircle ? (
        <label>
          Tangent angle (°)
          <input
            aria-label="Tangent angle"
            type="number"
            min="0"
            max="170"
            step="1"
            value={tangentInputValue}
            disabled={object.locked}
            placeholder={realizedAngleText}
            onFocus={() =>
              onTangentInputChange({ key: tangentInputKey, value: "" })
            }
            onChange={(event) => {
              const value = event.currentTarget.value;
              onTangentInputChange({ key: tangentInputKey, value });
              const angle = Number(value);
              if (value !== "" && Number.isFinite(angle)) {
                onTangentAngleChange(angle);
              }
            }}
            onBlur={() => onTangentInputChange(null)}
          />
        </label>
      ) : null}
      {!isCircle ? (
        <label>
          Bearing (°)
          <input
            aria-label="Drawing bearing"
            type="number"
            min="0"
            max="359"
            step="1"
            value={bearingInputValue}
            disabled={object.locked}
            placeholder={realizedBearingText}
            onFocus={() =>
              onBearingInputChange({ objectId: object.id, value: "" })
            }
            onChange={(event) => {
              const value = event.currentTarget.value;
              onBearingInputChange({ objectId: object.id, value });
              const nextBearing = Number(value);
              if (value !== "" && Number.isFinite(nextBearing)) {
                onBearingChange(nextBearing);
              }
            }}
            onBlur={() => onBearingInputChange(null)}
          />
        </label>
      ) : null}
      {object.kind === "arrow" ? (
        <>
          <label>
            Arrow head
            <select
              aria-label="Arrow head"
              value={object.styleOverride?.arrowHead ?? "filled"}
              disabled={object.locked}
              onChange={(event) =>
                onStyleChange({
                  arrowHead: event.currentTarget.value as
                    "none" | "filled" | "open",
                })
              }
            >
              <option value="none">No head</option>
              <option value="filled">Filled</option>
              <option value="open">Open</option>
            </select>
          </label>
          {/* Placement is its own question, kept beside style rather than
              multiplied into it: one combined list would need seven entries
              to say what two short lists say, and the entries would grow
              again the moment another head style appears. Hidden when there
              is no head to place, so the panel never offers a choice that
              cannot change anything. */}
          {(object.styleOverride?.arrowHead ?? "filled") !== "none" ? (
            <label>
              Arrow head at
              <select
                aria-label="Arrow head at"
                value={object.styleOverride?.arrowHeadAt ?? "end"}
                disabled={object.locked}
                onChange={(event) =>
                  onStyleChange({
                    arrowHeadAt: event.currentTarget.value as
                      "end" | "start" | "both",
                  })
                }
              >
                <option value="end">End</option>
                <option value="start">Start</option>
                <option value="both">Both ends</option>
              </select>
            </label>
          ) : null}
          <label>
            Arrow head size
            <select
              aria-label="Arrow head size"
              value={String(object.styleOverride?.arrowHeadScale ?? 1)}
              disabled={object.locked}
              onChange={(event) =>
                onStyleChange({
                  arrowHeadScale: Number(event.currentTarget.value) as
                    0.75 | 1 | 1.25 | 1.5,
                })
              }
            >
              <option value="0.75">0.75×</option>
              <option value="1">1×</option>
              <option value="1.25">1.25×</option>
              <option value="1.5">1.5×</option>
            </select>
          </label>
          <button type="button" disabled={object.locked} onClick={onReverse}>
            Reverse
          </button>
        </>
      ) : null}
      {!isCircle ? (
        <button type="button" disabled={object.locked} onClick={onRotate}>
          <ToolIcon name="rotate" />
          Rotate
        </button>
      ) : null}
      <button type="button" onClick={onToggleLock}>
        <ToolIcon name="lock" />
        {object.locked ? "Unlock" : "Lock"}
      </button>
    </section>
  );
}
