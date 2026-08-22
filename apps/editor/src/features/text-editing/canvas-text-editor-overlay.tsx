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

export function resolveCanvasTextEditorFrame(
  bounds: DerivedRect,
  viewBox: GridRect,
  sizeScale: number,
): DerivedRect {
  const width = Math.min(Math.max(420, bounds.width + 12), viewBox.width - 16);
  // A name longer than the box wraps, and the frame is sized before any of it
  // is typed, so budget for a few wrapped lines instead of the one the
  // committed bounds imply. Anything past that scrolls rather than being
  // clipped away by the foreignObject.
  const lineHeight = 15.116 * sizeScale * 1.2;
  const height = Math.min(
    Math.max(76, bounds.height + 36, 54 + lineHeight * 3),
    viewBox.height - 16,
  );
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
  return { x, y, width, height };
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
    <foreignObject
      data-testid="canvas-text-editor"
      className="canvas-text-editor-overlay"
      pointerEvents="all"
      {...frame}
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
  );
}
