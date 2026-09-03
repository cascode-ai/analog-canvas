import { useEffect, useLayoutEffect, useRef } from "react";
import type { ComponentProps, SVGProps } from "react";
import { schematicRoundPeriodFontFaceCss } from "@icm/derived";

import {
  CanvasGridOverlay,
  CanvasInputPlanes,
  NetHighlightOverlay,
  DiagnosticMarkersOverlay,
  OperatingPointOverlay,
  WireUnderSymbolOverlay,
  NetLabelTetherOverlay,
  type NetLabelTether,
} from "./editor-canvas-overlays";
import { EditorCanvasHitLayer } from "./editor-canvas-hit-layer";
import { EditorCellSymbolLayoutOverlay } from "./editor-cell-symbol-layout-overlay";
import { EditorRouteHandles } from "./editor-route-handles";
import { EditorSelectionHalo } from "./editor-selection-halo";
import {
  EditorDraftingHandles,
  EditorDraftingHitTargets,
} from "./editor-drafting-hit-targets";
import {
  EditorInteractionPreviews,
  EditorPlacementPreview,
} from "./editor-transient-preview-overlays";
import { EditorWiringOverlay } from "./editor-wiring-overlay";
import type { CameraRuntime } from "./camera-runtime";

export interface EditorCanvasSurfaceProps {
  empty: boolean;
  className: string;
  viewBox: string;
  cameraRuntime: CameraRuntime;
  eventHandlers: SVGProps<SVGSVGElement>;
  /**
   * Native wheel handler, attached non-passively. React's onWheel rides the
   * passive root listener, where preventDefault cannot stop browser page
   * zoom (pinch) or history-swipe navigation (horizontal scroll).
   */
  onWheel: (event: WheelEvent, element: SVGSVGElement) => void;
  /**
   * Cursor-anchored zoom for Safari's proprietary trackpad gesture events
   * (gesturestart/gesturechange), which Safari fires INSTEAD of ctrl+wheel
   * for pinches. factor < 1 zooms in.
   */
  onPinch: (
    factor: number,
    clientX: number,
    clientY: number,
    element: SVGSVGElement,
  ) => void;
  grid: ComponentProps<typeof CanvasGridOverlay>;
  sceneInnerHtml: { __html: string };
  selectionHalo: ComponentProps<typeof EditorSelectionHalo>;
  cellSymbolLayout: ComponentProps<typeof EditorCellSymbolLayoutOverlay> | null;
  netHighlight: ComponentProps<typeof NetHighlightOverlay>;
  wireUnderSymbol: ComponentProps<typeof WireUnderSymbolOverlay>;
  diagnosticMarkers: ComponentProps<typeof DiagnosticMarkersOverlay>;
  operatingPoint: ComponentProps<typeof OperatingPointOverlay>;
  netLabelTether: NetLabelTether | null;
  copyPreviewInnerHtml: { __html: string } | null;
  copyPreviewTransform: string | undefined;
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
  { keys: ["Shift", "M"], action: "Move without wires" },
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
  cameraRuntime,
  eventHandlers,
  onWheel,
  onPinch,
  grid,
  sceneInnerHtml,
  selectionHalo,
  cellSymbolLayout,
  netHighlight,
  wireUnderSymbol,
  diagnosticMarkers,
  operatingPoint,
  netLabelTether,
  copyPreviewInnerHtml,
  copyPreviewTransform,
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
  const onPinchRef = useRef(onPinch);
  useEffect(() => {
    onWheelRef.current = onWheel;
    onPinchRef.current = onPinch;
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
    // Safari delivers trackpad pinches through its own gesture events (no
    // ctrl+wheel); track the running scale and hand ratios to the shared
    // cursor-anchored zoom. Other browsers simply never fire these.
    type SafariGestureEvent = Event & {
      scale?: number;
      clientX: number;
      clientY: number;
    };
    let lastScale = 1;
    const gestureStart = (event: Event) => {
      event.preventDefault();
      lastScale = (event as SafariGestureEvent).scale ?? 1;
    };
    const gestureChange = (event: Event) => {
      event.preventDefault();
      const gesture = event as SafariGestureEvent;
      if (!gesture.scale || gesture.scale <= 0 || lastScale <= 0) return;
      const factor = lastScale / gesture.scale;
      lastScale = gesture.scale;
      onPinchRef.current(factor, gesture.clientX, gesture.clientY, svg);
    };
    const gestureEnd = (event: Event) => event.preventDefault();
    svg.addEventListener("gesturestart", gestureStart, { passive: false });
    svg.addEventListener("gesturechange", gestureChange, { passive: false });
    svg.addEventListener("gestureend", gestureEnd, { passive: false });
    return () => {
      svg.removeEventListener("wheel", listener);
      svg.removeEventListener("gesturestart", gestureStart);
      svg.removeEventListener("gesturechange", gestureChange);
      svg.removeEventListener("gestureend", gestureEnd);
    };
  }, []);
  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    cameraRuntime.attach(svg);
    return () => cameraRuntime.detach(svg);
  }, [cameraRuntime]);
  useLayoutEffect(() => {
    cameraRuntime.refreshSurface();
  }, [
    cameraRuntime,
    grid.visible,
    inputPlanes.componentPlacementActive,
    inputPlanes.copyPlacementActive,
    inputPlanes.tool,
  ]);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const invalidate = () => cameraRuntime.invalidateSurfaceBounds();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(invalidate);
    observer?.observe(svg);
    window.addEventListener("resize", invalidate);
    window.addEventListener("scroll", invalidate, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", invalidate);
      window.removeEventListener("scroll", invalidate, true);
    };
  }, [cameraRuntime]);
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
        aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"
        tabIndex={-1}
        viewBox={viewBox}
        {...eventHandlers}
      >
        <style>{schematicRoundPeriodFontFaceCss}</style>
        <CanvasGridOverlay {...grid} />
        <EditorSelectionHalo {...selectionHalo} />
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
            transform={copyPreviewTransform}
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
          <DiagnosticMarkersOverlay {...diagnosticMarkers} />
          {/* Above the diagnostics so a voltage is never hidden by a marker,
              and below the handles so it never covers something grabbable. */}
          <OperatingPointOverlay {...operatingPoint} />
          <EditorDraftingHandles {...draftingHandles} />
          <EditorInteractionPreviews {...interactionPreviews} />
        </g>
      </svg>
    </section>
  );
}
