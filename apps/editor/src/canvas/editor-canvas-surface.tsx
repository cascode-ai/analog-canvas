import type { ComponentProps, SVGProps } from "react";

import {
  CanvasGridOverlay,
  CanvasInputPlanes,
  NetHighlightOverlay,
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
  grid: ComponentProps<typeof CanvasGridOverlay>;
  sceneInnerHtml: { __html: string };
  cellSymbolLayout: ComponentProps<typeof EditorCellSymbolLayoutOverlay> | null;
  netHighlight: ComponentProps<typeof NetHighlightOverlay>;
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

/** SVG scene composition; interaction semantics arrive through typed models. */
export function EditorCanvasSurface({
  empty,
  className,
  viewBox,
  eventHandlers,
  grid,
  sceneInnerHtml,
  cellSymbolLayout,
  netHighlight,
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
  return (
    <section className="canvas-panel">
      {empty ? (
        <aside
          className="canvas-shortcut-menu"
          data-testid="canvas-empty-state"
          aria-label="Quick start shortcuts"
        >
          <p className="canvas-shortcut-menu-title">Quick start</p>
          <ul className="canvas-shortcut-list">
            <li>
              <kbd>I</kbd>
              <span>Insert component</span>
            </li>
            <li>
              <kbd>W</kbd>
              <span>Draw wire</span>
            </li>
          </ul>
        </aside>
      ) : null}
      <svg
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
          <EditorDraftingHandles {...draftingHandles} />
          <EditorInteractionPreviews {...interactionPreviews} />
        </g>
      </svg>
    </section>
  );
}
