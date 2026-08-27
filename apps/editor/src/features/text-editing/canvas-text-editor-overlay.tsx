import type { DerivedRect, GridRect } from "@icm/model";

import { RichTextEditor } from "./rich-text-editor";
import type { TextEditingSession } from "./text-editing";

type TextEditingUpdate = Partial<
  Pick<TextEditingSession, "content" | "sizeScale" | "alignment">
>;

export interface CanvasTextEditorOverlayProps {
  session: TextEditingSession;
  bounds: DerivedRect;
  viewBox: GridRect;
  disabled: boolean;
  onUpdate(change: TextEditingUpdate): void;
  onCommit(): void;
  onDelete(): void;
  onReverseCurrentArrow?(): void;
}

/**
 * The editor's own layout, in CSS pixels. Its contents — toolbar, buttons,
 * text — are laid out at this size and then scaled as one, so the panel keeps
 * its proportions instead of reflowing as the camera moves.
 */
const EDITOR_LAYOUT_WIDTH = 420;
const EDITOR_LAYOUT_MIN_HEIGHT = 150;

/**
 * How much of the camera the panel occupies.
 *
 * Sizing the panel in Document units made it a part of the drawing: it grew
 * on zoom in and shrank to illegibility on zoom out. A fraction of the camera
 * is the same fraction of the canvas at every zoom, so the panel holds one
 * apparent size — and because its contents are laid out at a fixed pixel size
 * and scaled with it, they hold their size too.
 */
const EDITOR_VIEW_FRACTION = 0.44;

export interface CanvasTextEditorFrame {
  /** Where the panel sits, in Document units. */
  x: number;
  y: number;
  /** Document units covered, for clamping and for the counter-scale. */
  width: number;
  height: number;
  /** Document units per CSS pixel of the panel's own layout. */
  scale: number;
  layoutWidth: number;
  layoutHeight: number;
}

export function resolveCanvasTextEditorFrame(
  bounds: DerivedRect,
  viewBox: GridRect,
  sizeScale: number,
): CanvasTextEditorFrame {
  const scale = (viewBox.width * EDITOR_VIEW_FRACTION) / EDITOR_LAYOUT_WIDTH;
  // A name longer than the box wraps, and the frame is sized before any of it
  // is typed, so budget for a few wrapped lines instead of the one the
  // committed bounds imply. Anything past that scrolls rather than being
  // clipped away by the foreignObject.
  const lineHeight = 15.116 * sizeScale * 1.2;
  const layoutHeight = Math.max(EDITOR_LAYOUT_MIN_HEIGHT, 54 + lineHeight * 3);
  const width = EDITOR_LAYOUT_WIDTH * scale;
  const height = layoutHeight * scale;
  const viewportInset = 8;
  const targetGap = 8;
  const minX = viewBox.x + viewportInset;
  const maxX = viewBox.x + viewBox.width - width - viewportInset;
  const minY = viewBox.y + viewportInset;
  const maxY = viewBox.y + viewBox.height - height - viewportInset;
  const x = Math.max(minX, Math.min(maxX, bounds.x - 6));
  const above = bounds.y - height - targetGap;
  const below = bounds.y + bounds.height + targetGap;
  const y =
    above >= minY
      ? above
      : below <= maxY
        ? below
        : Math.max(minY, Math.min(maxY, above));
  return {
    x,
    y,
    width,
    height,
    scale,
    layoutWidth: EDITOR_LAYOUT_WIDTH,
    layoutHeight,
  };
}

export function CanvasTextEditorOverlay({
  session,
  bounds,
  viewBox,
  disabled,
  onUpdate,
  onCommit,
  onDelete,
  onReverseCurrentArrow,
}: CanvasTextEditorOverlayProps) {
  const frame = resolveCanvasTextEditorFrame(
    bounds,
    viewBox,
    session.sizeScale,
  );

  return (
    <g transform={`translate(${frame.x} ${frame.y}) scale(${frame.scale})`}>
      <foreignObject
        data-testid="canvas-text-editor"
        className="canvas-text-editor-overlay"
        pointerEvents="all"
        x={0}
        y={0}
        width={frame.layoutWidth}
        height={frame.layoutHeight}
        onPointerDown={(event) => event.stopPropagation()}
        onPointerMove={(event) => event.stopPropagation()}
        onPointerUp={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.stopPropagation()}
        onWheel={(event) => event.stopPropagation()}
      >
        <RichTextEditor
          targetKey={`${session.owner}:${session.id}`}
          content={session.content}
          disabled={disabled}
          sizeScale={session.sizeScale}
          alignment={session.alignment}
          sourceOnly={
            session.bound &&
            session.bindingKind !== "instance-schematic-name" &&
            session.bindingKind !== "net-name" &&
            session.bindingKind !== "cell-terminal-name"
          }
          multiline={!session.bound}
          onChange={(content) => onUpdate({ content })}
          onSizeChange={(sizeScale) => onUpdate({ sizeScale })}
          onAlignmentChange={(alignment) => onUpdate({ alignment })}
          onCommit={onCommit}
          onDelete={onDelete}
          {...(onReverseCurrentArrow ? { onReverseCurrentArrow } : {})}
        />
      </foreignObject>
    </g>
  );
}
