import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type Ref,
} from "react";

import {
  razaviTextbookProfile,
  type Flightline,
  type SchematicStyleProfile,
} from "@icm/derived";
import type { GridRect, Point, RichTextDocument } from "@icm/model";
import { renderRichTextDocument } from "@icm/render-svg";

import { CanvasTextEditorOverlay } from "../features/text-editing/canvas-text-editor-overlay";
import type { WireMemberChoice } from "@icm/edit-engine";
import type { WireRepeat } from "../interaction/interaction-state";
import type { WireDraftPreview } from "../features/wiring/wire-draft-preview";
import { serializePolylinePoints } from "./canvas-geometry";

export interface NetLabelPlacementState {
  phase: "naming" | "placing";
  content: RichTextDocument;
  sizeScale: number;
  alignment: "start" | "middle" | "end";
  position: Point;
  /** The wire the label will attach to, when that wire asks for a look. */
  target?: {
    alignment?: "start" | "middle" | "end";
    rotation?: 0 | 270;
  } | null;
  /** How R has turned the label, for the preview away from any wire. */
  look?: { alignment: "start" | "end"; rotation: 0 | 270 };
}

export interface EditorWiringOverlayProps {
  netLabelPlacement: NetLabelPlacementState | null;
  onNetLabelTextChange: (
    change: Partial<{
      content: RichTextDocument;
      sizeScale: number;
      alignment: "start" | "middle" | "end";
    }>,
  ) => void;
  onNetLabelSubmit: () => void;
  onExpandNetLabels?: (() => void) | undefined;
  onNetLabelEscape: () => void;
  flightlines: readonly Flightline[];
  onFlightlineClick: (
    event: ReactMouseEvent<SVGLineElement>,
    flightline: Flightline,
  ) => void;
  wireDraftPreview: WireDraftPreview;
  memberChoice?: WireMemberChoice | null | undefined;
  wireRepeat?: WireRepeat | undefined;
  onContinuousTaps?:
    | ((
        order: "ascending" | "descending" | "fanout",
        memberId?: string,
      ) => void)
    | undefined;
  onWireMemberChoose?: ((memberId: string | null) => void) | undefined;
  onWireExpressionPreview?:
    ((expression: string) => { text: string; valid: boolean }) | undefined;
  onWireExpressionChoose?: ((expression: string) => void) | undefined;
  onWireMemberCancel?: (() => void) | undefined;
  wireSnapTarget?: Point | undefined;
  bulkRoutePreview: boolean;
  snapGuideLayerRef: Ref<SVGGElement>;
  viewBox: GridRect;
  styleProfile?: SchematicStyleProfile;
}

type NetLabelEditorOverlayProps = Pick<
  EditorWiringOverlayProps,
  | "netLabelPlacement"
  | "onNetLabelTextChange"
  | "onNetLabelSubmit"
  | "onExpandNetLabels"
  | "onNetLabelEscape"
  | "viewBox"
>;

/**
 * The naming surface is composed separately at the end of the SVG overlay.
 * Keeping it out of the wiring layer prevents later transparent hit targets
 * from intercepting text selection and toolbar gestures.
 */
export function NetLabelEditorOverlay({
  netLabelPlacement,
  onNetLabelTextChange,
  onNetLabelSubmit,
  onExpandNetLabels,
  onNetLabelEscape,
  viewBox,
}: NetLabelEditorOverlayProps) {
  if (netLabelPlacement?.phase !== "naming") return null;
  return (
    <g data-testid="net-label-editor" data-layer="net-label-editor-overlay">
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
        secondaryAction={
          onExpandNetLabels
            ? {
                label: "Expand onto selected branches",
                onClick: onExpandNetLabels,
              }
            : undefined
        }
        onCancel={onNetLabelEscape}
        onEscape={onNetLabelEscape}
        onDelete={onNetLabelEscape}
        showDelete={false}
      />
    </g>
  );
}

export function EditorWiringOverlay({
  netLabelPlacement,
  flightlines,
  onFlightlineClick,
  wireDraftPreview,
  wireSnapTarget,
  bulkRoutePreview,
  snapGuideLayerRef,
  styleProfile = razaviTextbookProfile,
}: EditorWiringOverlayProps) {
  const previewFontSize =
    styleProfile.typography.netFontSize * (netLabelPlacement?.sizeScale ?? 1);
  // Turned as the committed label will be: the wire's look, else R's.
  const previewRotation =
    netLabelPlacement?.target?.rotation ??
    netLabelPlacement?.look?.rotation ??
    0;
  const netLabelHtml = useMemo(
    () =>
      netLabelPlacement?.phase === "placing"
        ? {
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
          }
        : null,
    [
      netLabelPlacement?.phase,
      netLabelPlacement?.content,
      netLabelPlacement?.position.x,
      styleProfile,
      previewFontSize,
    ],
  );
  return (
    <>
      {netLabelPlacement?.phase === "placing" && netLabelHtml ? (
        <g data-testid="net-label-placement-preview" pointerEvents="none">
          <text
            className="net-label-placement-preview"
            x={netLabelPlacement.position.x}
            y={netLabelPlacement.position.y}
            textAnchor={
              netLabelPlacement.target?.alignment ??
              netLabelPlacement.look?.alignment ??
              netLabelPlacement.alignment
            }
            transform={
              previewRotation
                ? `rotate(${previewRotation} ${netLabelPlacement.position.x} ${netLabelPlacement.position.y})`
                : undefined
            }
            fontSize={previewFontSize}
            dangerouslySetInnerHTML={netLabelHtml}
          />
        </g>
      ) : null}
      {flightlines.map((flightline) => (
        <g key={flightline.id}>
          <title>
            Original import routing reference, not a wire. Check Issues for
            differences from the current circuit.
          </title>
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
          data-blocked={wireDraftPreview.blocked || undefined}
          data-bus-width={
            wireDraftPreview.width && wireDraftPreview.width > 1
              ? wireDraftPreview.width
              : undefined
          }
          points={serializePolylinePoints(wireDraftPreview.points)}
        />
      ) : null}
      {wireDraftPreview.message && wireDraftPreview.points.at(-1) ? (
        <text
          aria-label="Wire connection preview"
          className="wire-connection-preview"
          pointerEvents="none"
          x={wireDraftPreview.points.at(-1)!.x + 12}
          y={wireDraftPreview.points.at(-1)!.y - 12}
        >
          {wireDraftPreview.message}
        </text>
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

/** Above canvas hit targets, like the existing inline Label editor. */
export function WireMemberChoiceOverlay({
  memberChoice,
  wireRepeat,
  onContinuousTaps,
  onWireMemberChoose,
  onWireExpressionPreview,
  onWireExpressionChoose,
  onWireMemberCancel,
  viewBox,
}: Pick<
  EditorWiringOverlayProps,
  | "memberChoice"
  | "wireRepeat"
  | "onContinuousTaps"
  | "onWireMemberChoose"
  | "onWireMemberCancel"
  | "viewBox"
  | "onWireExpressionPreview"
  | "onWireExpressionChoose"
>) {
  const root = useRef<SVGForeignObjectElement | null>(null);
  const [unitsPerPixel, setUnitsPerPixel] = useState(1);
  const [expression, setExpression] = useState("");
  useLayoutEffect(() => setExpression(""), [memberChoice]);
  useLayoutEffect(() => {
    const svg = root.current?.ownerSVGElement;
    if (!svg) return;
    const measure = () => {
      const matrix = svg.getScreenCTM();
      if (matrix) setUnitsPerPixel(1 / Math.hypot(matrix.a, matrix.b));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(svg);
    return () => observer.disconnect();
  }, [memberChoice, viewBox]);
  if (!memberChoice && !wireRepeat) return null;
  const preview = expression.trim()
    ? onWireExpressionPreview?.(expression)
    : null;
  const point = (memberChoice?.source ?? wireRepeat!.source).connection
    .contactPoint;
  const widthPixels = Math.min(240, viewBox.width / unitsPerPixel - 16);
  const width = widthPixels * unitsPerPixel;
  const x = Math.max(
    viewBox.x + 8,
    Math.min(point.x + 12, viewBox.x + viewBox.width - width - 8),
  );
  const y = Math.max(
    viewBox.y + 8,
    Math.min(point.y + 12, viewBox.y + viewBox.height - 280 * unitsPerPixel),
  );
  return (
    <foreignObject
      ref={root}
      x={x}
      y={y}
      width={width}
      height={(memberChoice ? 272 : 56) * unitsPerPixel}
      data-canvas-overlay="wire-member-choice"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onPointerMove={(event) => event.stopPropagation()}
    >
      <div
        style={{
          width: widthPixels,
          transform: `scale(${unitsPerPixel})`,
          transformOrigin: "top left",
        }}
        className="wire-member-choice"
        role="group"
        aria-label="Bus member choice"
      >
        {wireRepeat && !memberChoice ? (
          <div role="status" aria-label="Continuous taps">
            {wireRepeat.index >= wireRepeat.members.length
              ? "All members completed · Choose a new source"
              : `${wireRepeat.fanout ? "Fanout" : "Next tap"}: ${wireRepeat.members[wireRepeat.index]!.label}`}
            <div>Esc ends continuous taps</div>
          </div>
        ) : null}
        {memberChoice?.sharedPinLabel ? (
          <>
            <button
              type="button"
              autoFocus
              onClick={() => onWireMemberChoose?.(null)}
            >
              {memberChoice.sharedPinLabel}
            </button>
            <button type="button" onClick={onWireMemberCancel}>
              Cancel · Esc
            </button>
          </>
        ) : memberChoice ? (
          <>
            <label>
              Connect {memberChoice.options.length}-member bus
              <select
                aria-label="Bus connection"
                autoFocus={!memberChoice.allowWhole}
                value={memberChoice.allowWhole ? "whole" : ""}
                onChange={(event) => {
                  if (event.target.value.startsWith("fanout:"))
                    onContinuousTaps?.("fanout", event.target.value.slice(7));
                  else if (event.target.value === "whole")
                    onWireMemberChoose?.(null);
                  else if (event.target.value.startsWith("member:"))
                    onWireMemberChoose?.(event.target.value.slice(7));
                }}
              >
                <option value="" disabled>
                  Choose connection…
                </option>
                {memberChoice.allowWhole ? (
                  <option value="whole">
                    Whole bus · {memberChoice.options.length} members
                  </option>
                ) : null}
                {memberChoice.options.map((option) => (
                  <option key={option.id} value={`member:${option.id}`}>
                    {option.label}
                  </option>
                ))}
                {memberChoice.allowWhole ? (
                  <optgroup label="Repeat one member">
                    {memberChoice.options.map((option) => (
                      <option key={option.id} value={`fanout:${option.id}`}>
                        Fanout {option.label}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </select>
            </label>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (preview?.valid) onWireExpressionChoose?.(expression);
              }}
            >
              <input
                aria-label="Bus member expression"
                value={expression}
                placeholder="<7:4> or CLK,DATA<3,0>"
                onChange={(event) => setExpression(event.target.value)}
              />
              {preview ? (
                <div
                  aria-label="Bus selection preview"
                  role={preview.valid ? "status" : "alert"}
                >
                  {preview.text}
                </div>
              ) : null}
              <button type="submit" disabled={!preview?.valid}>
                Use selection
              </button>
            </form>
            {memberChoice.allowWhole ? (
              <div aria-label="Continuous tap order">
                <button
                  type="button"
                  onClick={() => onContinuousTaps?.("ascending")}
                >
                  Tap ascending
                </button>
                <button
                  type="button"
                  onClick={() => onContinuousTaps?.("descending")}
                >
                  Tap descending
                </button>
                <button
                  type="button"
                  onClick={() => onContinuousTaps?.("fanout")}
                >
                  Fanout first member
                </button>
              </div>
            ) : null}
            <button type="button" onClick={onWireMemberCancel}>
              {memberChoice.allowWhole ? "Hide" : "Cancel · Esc"}
            </button>
          </>
        ) : null}
      </div>
    </foreignObject>
  );
}
