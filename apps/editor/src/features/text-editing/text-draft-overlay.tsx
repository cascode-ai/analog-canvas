import type { GridRect, Point, RichTextDocument } from "@icm/model";

import {
  CanvasTextEditorOverlay,
  type CanvasTextEditorOverlayProps,
} from "./canvas-text-editor-overlay";

/**
 * Text being written before it is placed. The Text tool opens its editor
 * first, the way a Net Label is named first; Enter then carries what was
 * written onto the pointer to be placed, rather than dragging a stock
 * "Design note" around and editing it afterwards.
 */
export interface TextDraft {
  content: RichTextDocument;
  sizeScale: number;
  alignment: "start" | "middle" | "end";
  /** Where the editor opens: the pointer's last place on the canvas. */
  position: Point;
}

export function TextDraftEditorOverlay({
  draft,
  viewBox,
  onChange,
  onSubmit,
  onCancel,
}: {
  draft: TextDraft | null;
  viewBox: GridRect;
  onChange: CanvasTextEditorOverlayProps["onUpdate"];
  onSubmit(): void;
  onCancel(): void;
}) {
  if (!draft) return null;
  return (
    <g data-testid="text-draft-editor" data-layer="text-draft-editor-overlay">
      <CanvasTextEditorOverlay
        session={{
          owner: "drafting",
          id: "pending-text",
          content: draft.content,
          sizeScale: draft.sizeScale,
          alignment: draft.alignment,
          defaultBold: true,
          bound: false,
        }}
        bounds={{
          x: draft.position.x,
          y: draft.position.y,
          width: 1,
          height: 1,
        }}
        viewBox={viewBox}
        disabled={false}
        onUpdate={onChange}
        onCommit={onSubmit}
        onCancel={onCancel}
        onEscape={onCancel}
        onDelete={onCancel}
        showDelete={false}
      />
    </g>
  );
}
