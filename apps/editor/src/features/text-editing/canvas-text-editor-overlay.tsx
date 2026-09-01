import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import type { DerivedRect, GridRect } from "@icm/model";
import { flattenRichText } from "@icm/model";

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
  onCancel(): void;
  onDelete(): void;
  onReverseCurrentArrow?(): void;
  onConvertFormulaToLiteral?(formula: TextEditingSession["content"]): boolean;
}

/**
 * The editor's own layout, in CSS pixels. Its contents — toolbar, buttons,
 * text — are laid out at this size and then scaled as one, so the panel keeps
 * its proportions instead of reflowing as the camera moves.
 */
const EDITOR_FALLBACK_LAYOUT_WIDTH = 420;
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
const EDITOR_VIEW_FRACTION = 2 / 3;

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
  pixelsPerUnit?: number | null,
  preferredLayoutHeight?: number | null,
): CanvasTextEditorFrame {
  const width = viewBox.width * EDITOR_VIEW_FRACTION;
  // Laying the panel out at true screen pixels is what lets its type be set
  // against the rest of the chrome rather than against the drawing. Without a
  // measurement — the first render, before the canvas is on screen — fall back
  // to a fixed layout width, which still keeps the panel proportional.
  const scale =
    pixelsPerUnit && pixelsPerUnit > 0
      ? 1 / pixelsPerUnit
      : width / EDITOR_FALLBACK_LAYOUT_WIDTH;
  const layoutWidth = width / scale;
  // A name longer than the box wraps, and the frame is sized before any of it
  // is typed, so budget for a few wrapped lines instead of the one the
  // committed bounds imply. Anything past that scrolls rather than being
  // clipped away by the foreignObject.
  const lineHeight = 15.116 * sizeScale * 1.2;
  const layoutHeight = Math.max(
    EDITOR_LAYOUT_MIN_HEIGHT,
    54 + lineHeight * 3,
    preferredLayoutHeight ?? 0,
  );
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
    layoutWidth,
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
  onCancel,
  onDelete,
  onReverseCurrentArrow,
  onConvertFormulaToLiteral,
}: CanvasTextEditorOverlayProps) {
  const anchorRef = useRef<SVGGElement | null>(null);
  const [canvasSize, setCanvasSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [measuredLayoutHeight, setMeasuredLayoutHeight] = useState<
    number | null
  >(null);

  useEffect(() => {
    setMeasuredLayoutHeight(null);
  }, [session.id, session.owner]);

  const handleLayoutHeightChange = useCallback((height: number): void => {
    setMeasuredLayoutHeight((current) =>
      current !== null && Math.abs(current - height) < 1 ? current : height,
    );
  }, []);

  // How many screen pixels one Document unit covers. The panel is laid out in
  // those pixels so its type can be set against the rest of the chrome, and
  // the canvas can be resized under it, so the measurement is observed.
  useLayoutEffect(() => {
    const svg = anchorRef.current?.ownerSVGElement;
    if (!svg) return;
    const measure = () => {
      const rect = svg.getBoundingClientRect();
      setCanvasSize({ width: rect.width, height: rect.height });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);

  const frame = resolveCanvasTextEditorFrame(
    bounds,
    viewBox,
    session.sizeScale,
    // preserveAspectRatio="meet" fits the camera inside the element, so the
    // painted scale is the smaller of the two ratios — not the width's alone.
    canvasSize && viewBox.width > 0 && viewBox.height > 0
      ? Math.min(
          canvasSize.width / viewBox.width,
          canvasSize.height / viewBox.height,
        )
      : null,
    measuredLayoutHeight,
  );
  const sourceOnly =
    // A Symbol's body text is a plain string in the Symbol's own script
    // syntax. Offering bold, an overbar or the formula tool on a field that
    // cannot store any of them would promise formatting the commit drops.
    session.owner === "instance-formula" ||
    (session.bound &&
      session.bindingKind !== "instance-reference" &&
      session.bindingKind !== "net-name" &&
      session.bindingKind !== "cell-terminal-name");

  return (
    <g
      ref={anchorRef}
      transform={`translate(${frame.x} ${frame.y}) scale(${frame.scale})`}
    >
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
          sourceOnly={sourceOnly}
          multiline={!session.bound}
          onChange={(content) => onUpdate({ content })}
          onSizeChange={(sizeScale) => onUpdate({ sizeScale })}
          onAlignmentChange={(alignment) => onUpdate({ alignment })}
          onCommit={onCommit}
          onCancel={onCancel}
          onDelete={onDelete}
          {...(session.bound && !sourceOnly
            ? { formulaSemanticText: flattenRichText(session.content) }
            : {})}
          {...(session.bindingKind === "instance-reference" &&
          onConvertFormulaToLiteral
            ? { onConvertFormulaToLiteral }
            : {})}
          onLayoutHeightChange={handleLayoutHeightChange}
          {...(onReverseCurrentArrow ? { onReverseCurrentArrow } : {})}
        />
      </foreignObject>
    </g>
  );
}
