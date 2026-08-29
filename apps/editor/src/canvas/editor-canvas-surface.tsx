import { useEffect, useRef } from "react";
import type { ComponentProps, SVGProps } from "react";

import {
  CanvasGridOverlay,
  CanvasInputPlanes,
  NetHighlightOverlay,
  WireUnderSymbolOverlay,
  NetLabelTetherOverlay,
  type NetLabelTether,
} from "./editor-canvas-overlays";
import { EditorCanvasHitLayer } from "./editor-canvas-hit-layer";
import { EditorCellSymbolLayoutOverlay } from "./editor-cell-symbol-layout-overlay";
import { EditorRouteHandles } from "./editor-route-handles";
import {
  EditorDraftingHandles,
  EditorDraftingHitTargets,
} from "./editor-drafting-hit-targets";
import {
  EditorInteractionPreviews,
  EditorPlacementPreview,
} from "./editor-transient-preview-overlays";
import { EditorWiringOverlay } from "./editor-wiring-overlay";

export interface EditorCanvasSurfaceProps {
  empty: boolean;
  className: string;
  viewBox: string;
  eventHandlers: SVGProps<SVGSVGElement>;
  /**
   * Native wheel handler, attached non-passively. React's onWheel rides the
   * passive root listener, where preventDefault cannot stop browser page
   * zoom (pinch) or history-swipe navigation (horizontal scroll).
   */
  onWheel: (event: WheelEvent, element: SVGSVGElement) => void;
  grid: ComponentProps<typeof CanvasGridOverlay>;
  sceneInnerHtml: { __html: string };
  cellSymbolLayout: ComponentProps<typeof EditorCellSymbolLayoutOverlay> | null;
  netHighlight: ComponentProps<typeof NetHighlightOverlay>;
  wireUnderSymbol: ComponentProps<typeof WireUnderSymbolOverlay>;
  netLabelTether: NetLabelTether | null;
  copyPreviewInnerHtml: { __html: string } | null;
  inputPlanes: ComponentProps<typeof CanvasInputPlanes>;
  placementPreview: ComponentProps<typeof EditorPlacementPreview>;
  wiring: ComponentProps<typeof EditorWiringOverlay>;
  routeHandles: ComponentProps<typeof EditorRouteHandles>;
  selectionHitLayer: ComponentProps<typeof EditorCanvasHitLayer>;
  draftingHitTargets: ComponentProps<typeof EditorDraftingHitTargets>;
  draftingHandles: ComponentProps<typeof EditorDraftingHandles>;
  interactionPreviews: ComponentProps<typeof EditorInteractionPreviews>;
}

const CADENCE_QUICK_SHORTCUTS = [
  { keys: ["F"], action: "Fit view" },
  { keys: ["I"], action: "Insert component" },
  { keys: ["R"], action: "Rotate" },
  { keys: ["M"], action: "Move selection" },
  { keys: ["U"], action: "Undo" },
  { keys: ["P"], action: "Place Cell Pin" },
  { keys: ["C"], action: "Copy selection" },
  { keys: ["Q"], action: "Properties" },
  { keys: ["W"], action: "Draw wire" },
  { keys: ["L"], action: "Edit Net Label" },
  { keys: ["Shift", "R"], action: "Mirror left / right" },
  { keys: ["Ctrl", "R"], action: "Mirror top / bottom" },
  { keys: ["Esc"], action: "Cancel tool" },
  { keys: ["Shift", "U"], action: "Redo" },
] as const;

function CanvasShortcutChord({ keys }: { keys: readonly string[] }) {
  return (
    <span className="canvas-shortcut-chord" aria-label={keys.join(" plus ")}>
      {keys.map((key) => (
        <kbd key={key}>{key}</kbd>
      ))}
    </span>
  );
}

/** SVG scene composition; interaction semantics arrive through typed models. */
export function EditorCanvasSurface({
  empty,
  className,
  viewBox,
  eventHandlers,
  onWheel,
  grid,
  sceneInnerHtml,
  cellSymbolLayout,
  netHighlight,
  wireUnderSymbol,
  netLabelTether,
  copyPreviewInnerHtml,
  inputPlanes,
  placementPreview,
  wiring,
  routeHandles,
  selectionHitLayer,
  draftingHitTargets,
  draftingHandles,
  interactionPreviews,
}: EditorCanvasSurfaceProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const onWheelRef = useRef(onWheel);
  useEffect(() => {
    onWheelRef.current = onWheel;
  });
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const listener = (event: WheelEvent) => {
      // The editor lives inside this SVG through a foreignObject, but it owns
      // ordinary document scrolling. React's delegated onWheel handler runs
      // too late to protect it from this non-passive native canvas listener,
      // which otherwise prevents the default scroll and zooms the camera.
      const targetsTextEditor = event
        .composedPath()
        .some(
          (target) =>
            target instanceof Element &&
            target.matches('[data-testid="canvas-text-editor"]'),
        );
      if (targetsTextEditor) return;
      onWheelRef.current(event, svg);
    };
    svg.addEventListener("wheel", listener, { passive: false });
    return () => svg.removeEventListener("wheel", listener);
  }, []);
  return (
    <section className="canvas-panel">
      {empty ? (
        <aside
          className="canvas-shortcut-menu"
          data-testid="canvas-empty-state"
          aria-label="Quick start shortcuts"
        >
          <div className="canvas-shortcut-menu-heading">
            <p className="canvas-shortcut-menu-title">Quick start</p>
            <span>Cadence keys</span>
          </div>
          <ul className="canvas-shortcut-list">
            {CADENCE_QUICK_SHORTCUTS.map((shortcut) => (
              <li key={shortcut.keys.join("-")}>
                <CanvasShortcutChord keys={shortcut.keys} />
                <span>{shortcut.action}</span>
              </li>
            ))}
          </ul>
        </aside>
      ) : null}
      <svg
        ref={svgRef}
        className={className}
        data-testid="schematic-canvas"
        role="img"
        aria-label="Schematic canvas"
        viewBox={viewBox}
        {...eventHandlers}
      >
        <CanvasGridOverlay {...grid} />
        <g dangerouslySetInnerHTML={sceneInnerHtml} />
        {cellSymbolLayout ? (
          <EditorCellSymbolLayoutOverlay {...cellSymbolLayout} />
        ) : null}
        <NetHighlightOverlay {...netHighlight} />
        <NetLabelTetherOverlay tether={netLabelTether} />
        {copyPreviewInnerHtml ? (
          <g
            data-testid="copy-placement-preview"
            className="copy-placement-preview"
            dangerouslySetInnerHTML={copyPreviewInnerHtml}
          />
        ) : null}
        <CanvasInputPlanes {...inputPlanes} />
        <g data-layer="editor-overlay">
          <EditorPlacementPreview {...placementPreview} />
          <EditorWiringOverlay {...wiring} />
          <EditorRouteHandles {...routeHandles} />
          <EditorCanvasHitLayer {...selectionHitLayer} />
          <EditorDraftingHitTargets {...draftingHitTargets} />
          <WireUnderSymbolOverlay {...wireUnderSymbol} />
          <EditorDraftingHandles {...draftingHandles} />
          <EditorInteractionPreviews {...interactionPreviews} />
        </g>
      </svg>
    </section>
  );
}
