import {
  DEFAULT_ARROW_PRESET,
  type ArrowPreset,
} from "../features/drafting/arrow-presets";
import {
  defaultDraftTextDocument,
  type DerivedRect,
  type GridRect,
  type Point,
} from "@icm/model";
import {
  razaviTextbookProfile,
  resolvePolarityTextGeometry,
  richTextMetrics,
  type SchematicStyleProfile,
} from "@icm/derived";
import { renderRichTextDocument } from "@icm/render-svg";
import type { SymbolDefinition } from "@icm/symbols";

import {
  ComponentPlacementPreview,
  type ComponentPlacementPreviewProps,
} from "../features/component-insert/component-placement-preview";
import { DraftingCreatePreview } from "../features/drafting/drafting-create-preview";
import {
  CanvasTextEditorOverlay,
  type CanvasTextEditorOverlayProps,
} from "../features/text-editing/canvas-text-editor-overlay";
import type { TextEditingSession } from "../features/text-editing/text-editing";
import type { EditorTool } from "../interaction/interaction-state";
import { marqueeMode } from "../features/selection/marquee-selection";
import type { BoxPreview } from "./canvas-gesture-model";
import { normalizedRect } from "./canvas-geometry";

export function EditorPlacementPreview({
  vddRailMode,
  vddRailStart,
  previewPoint,
  powerRailStrokeWidth,
  styleProfileId,
  pendingSymbolId,
  pendingSymbol,
  draftingText,
  draftingPolarity,
  styleProfile = razaviTextbookProfile,
  rotation,
  mirror,
}: {
  vddRailMode: boolean;
  vddRailStart: Point | null;
  previewPoint: Point | null;
  powerRailStrokeWidth: number;
  styleProfileId: string;
  pendingSymbolId: string | null;
  pendingSymbol?: SymbolDefinition;
  draftingText?: string;
  draftingPolarity?: "both" | "positive" | "negative";
  styleProfile?: SchematicStyleProfile;
  rotation: ComponentPlacementPreviewProps["rotation"];
  mirror: NonNullable<ComponentPlacementPreviewProps["mirror"]>;
}) {
  if (!previewPoint) return null;
  if (vddRailMode) {
    return vddRailStart ? (
      <line
        data-testid="vdd-rail-preview"
        className="vdd-rail-preview"
        x1={vddRailStart.x}
        y1={vddRailStart.y}
        x2={previewPoint.x}
        y2={previewPoint.y}
        strokeWidth={powerRailStrokeWidth}
      />
    ) : (
      <ComponentPlacementPreview
        styleProfileId={styleProfileId}
        symbolId="vdd"
        position={previewPoint}
        rotation={0}
      />
    );
  }
  if (draftingText !== undefined || draftingPolarity !== undefined) {
    const barePolarity =
      draftingPolarity === "positive" || draftingPolarity === "negative";
    const content = draftingPolarity
      ? barePolarity
        ? { runs: [{ kind: "line-break" as const }] }
        : defaultDraftTextDocument("Vx")
      : { runs: [{ kind: "text" as const, value: draftingText! }] };
    const metrics = richTextMetrics(styleProfile, "label");
    const polarityGeometry = draftingPolarity
      ? resolvePolarityTextGeometry(
          { x: 0, y: 0 },
          draftingPolarity,
          content,
          metrics,
          rotation,
        )
      : null;
    const textPosition = polarityGeometry?.textPosition ?? { x: 0, y: 0 };
    const baselineY = draftingPolarity
      ? textPosition.y + metrics.fontSize * 0.35
      : textPosition.y;
    return (
      <g
        data-testid="text-placement-preview"
        className="component-placement-preview"
        transform={`translate(${previewPoint.x} ${previewPoint.y})`}
      >
        {polarityGeometry?.lines.map((line) => (
          <line
            key={line.role}
            data-role={`polarity-${line.role}`}
            x1={line.from.x}
            y1={line.from.y}
            x2={line.to.x}
            y2={line.to.y}
            stroke="currentColor"
            strokeWidth={styleProfile.strokes.annotation}
            strokeLinecap={styleProfile.lineCap}
          />
        ))}
        {!barePolarity ? (
          <text
            x={textPosition.x}
            y={baselineY}
            textAnchor="middle"
            fontSize={metrics.fontSize}
            fontFamily={styleProfile.typography.fontFamily}
            fontWeight="bold"
            fontStyle="normal"
            fill="currentColor"
            dangerouslySetInnerHTML={{
              __html: renderRichTextDocument(content, styleProfile, {
                lineOriginX: textPosition.x,
                fontSize: metrics.fontSize,
                defaultBold: true,
                defaultItalic: false,
              }),
            }}
          />
        ) : null}
      </g>
    );
  }
  if (!pendingSymbolId) return null;
  return (
    <ComponentPlacementPreview
      styleProfileId={styleProfileId}
      symbolId={pendingSymbolId}
      {...(pendingSymbol ? { symbol: pendingSymbol } : {})}
      position={previewPoint}
      rotation={rotation}
      mirror={mirror}
    />
  );
}

export function EditorInteractionPreviews({
  boxPreview,
  draftingSource,
  arrowPreset = DEFAULT_ARROW_PRESET,
  draftingWaypoints,
  draftingHover,
  draftingSnapPoint,
  tool,
  styleProfile,
  wirePreviewPoint,
  textEditing,
  textEditingBounds,
  viewBox,
  textEditingLocked,
  onTextUpdate,
  onTextCommit,
  onTextCancel,
  onTextEscape,
  onTextDelete,
  onDisplayAliasChange,
}: {
  boxPreview: BoxPreview | null;
  draftingSource: Point | null;
  arrowPreset?: ArrowPreset;
  draftingWaypoints: Point[];
  draftingHover: Point | null;
  draftingSnapPoint: Point | null;
  tool: EditorTool;
  styleProfile: SchematicStyleProfile;
  wirePreviewPoint: Point | null;
  textEditing: TextEditingSession | null;
  textEditingBounds: DerivedRect | null;
  viewBox: GridRect;
  textEditingLocked: boolean;
  onTextUpdate: CanvasTextEditorOverlayProps["onUpdate"];
  onTextCommit: () => void;
  onTextCancel: () => void;
  onTextEscape?: () => void;
  onTextDelete: () => void;
  onDisplayAliasChange?: CanvasTextEditorOverlayProps["onDisplayAliasChange"];
}) {
  return (
    <>
      {boxPreview ? (
        <rect
          data-testid={
            boxPreview.intent === "zoom" ? "zoom-box" : "selection-box"
          }
          className={
            boxPreview.intent === "zoom"
              ? "zoom-box"
              : `selection-box selection-box--${marqueeMode(
                  boxPreview.start,
                  boxPreview.end,
                )}`
          }
          {...normalizedRect(boxPreview.start, boxPreview.end)}
        />
      ) : null}
      {draftingHover &&
      (draftingSource ||
        (tool === "arrow" && arrowPreset.family === "outline")) ? (
        <DraftingCreatePreview
          tool={tool}
          start={draftingSource}
          arrowPreset={arrowPreset}
          waypoints={draftingWaypoints}
          hover={draftingHover}
          snap={draftingSnapPoint}
          styleProfile={styleProfile}
        />
      ) : null}
      {tool === "wire" && wirePreviewPoint ? (
        <circle
          className="snap-preview"
          cx={wirePreviewPoint.x}
          cy={wirePreviewPoint.y}
          r="4"
        />
      ) : null}
      {textEditing && textEditingBounds ? (
        <CanvasTextEditorOverlay
          session={textEditing}
          bounds={textEditingBounds}
          viewBox={viewBox}
          disabled={textEditingLocked}
          onUpdate={onTextUpdate}
          onCommit={onTextCommit}
          onCancel={onTextCancel}
          {...(onTextEscape ? { onEscape: onTextEscape } : {})}
          onDelete={onTextDelete}
          {...(onDisplayAliasChange ? { onDisplayAliasChange } : {})}
        />
      ) : null}
    </>
  );
}
