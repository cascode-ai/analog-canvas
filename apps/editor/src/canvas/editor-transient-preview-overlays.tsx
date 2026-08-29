import type { DerivedRect, GridRect, Point } from "@icm/model";
import type { SchematicStyleProfile } from "@icm/derived";
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
  onTextDelete,
  onReverseCurrentArrow,
}: {
  boxPreview: BoxPreview | null;
  draftingSource: Point | null;
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
  onTextDelete: () => void;
  onReverseCurrentArrow?: () => void;
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
      {draftingSource && draftingHover ? (
        <DraftingCreatePreview
          tool={tool}
          start={draftingSource}
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
          onDelete={onTextDelete}
          {...(onReverseCurrentArrow ? { onReverseCurrentArrow } : {})}
        />
      ) : null}
    </>
  );
}
