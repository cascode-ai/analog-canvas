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

const CADENCE_QUICK_SHORTCUTS = [
  { keys: ["I"], action: "Insert component" },
  { keys: ["W"], action: "Draw wire" },
  { keys: ["P"], action: "Place Cell Pin" },
  { keys: ["L"], action: "Edit Net Label" },
  { keys: ["M"], action: "Move selection" },
  { keys: ["C"], action: "Copy selection" },
  { keys: ["Q"], action: "Properties" },
  { keys: ["R"], action: "Rotate" },
  { keys: ["Shift", "R"], action: "Mirror left / right" },
  { keys: ["Ctrl", "R"], action: "Mirror top / bottom" },
  { keys: ["U"], action: "Undo" },
  { keys: ["Shift", "U"], action: "Redo" },
  { keys: ["F"], action: "Fit view" },
  { keys: ["Delete"], action: "Delete selection" },
  { keys: ["Esc"], action: "Cancel tool" },
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
