import { buildBoundsSpatialIndex } from "@icm/derived";
import { useLayoutEffect, useMemo, useState, type ComponentProps } from "react";
import { flushSync } from "react-dom";
import type { CameraRuntime } from "./camera-runtime";
import { worldViewport } from "./fit-view";
import {
  DIAGNOSTIC_MARKER_HIT_RADIUS,
  type DiagnosticMarker,
} from "./diagnostic-markers";
import { DiagnosticMarkersOverlay } from "./editor-canvas-overlays";

export function ViewportDiagnosticMarkers({
  markers,
  camera,
  onSelectMarker,
}: ComponentProps<typeof DiagnosticMarkersOverlay> & {
  camera: CameraRuntime;
}) {
  const index = useMemo(
    () =>
      buildBoundsSpatialIndex(
        markers.map((marker) => {
          // Counts sit at (+8, -6)
          // in 9-unit bold text; include the numeral and its light outline.
          const right =
            marker.count > 1
              ? 10 + 10 * String(marker.count).length
              : DIAGNOSTIC_MARKER_HIT_RADIUS;
          const above = marker.count > 1 ? 18 : DIAGNOSTIC_MARKER_HIT_RADIUS;
          return {
            value: marker,
            bounds: {
              x: marker.point.x - DIAGNOSTIC_MARKER_HIT_RADIUS,
              y: marker.point.y - above,
              width: DIAGNOSTIC_MARKER_HIT_RADIUS + right,
              height: above + DIAGNOSTIC_MARKER_HIT_RADIUS,
            },
          };
        }),
        80,
      ),
    [markers],
  );
  const [visible, setVisible] = useState<readonly DiagnosticMarker[]>([]);
  useLayoutEffect(() => {
    let previous: readonly DiagnosticMarker[] | undefined;
    return camera.observeViewport((view, surface, animationFrame) => {
      const viewport = worldViewport(view, surface);
      if (!viewport) return;
      // The halo stroke extends another 2.25 CSS pixels regardless of zoom.
      const p = 2.25 / viewport.scale;
      const { x, y, width, height } = viewport.bounds;
      const next = index.queryBounds({
        x: x - p,
        y: y - p,
        width: width + 2 * p,
        height: height + 2 * p,
      });
      if (
        previous?.length === next.length &&
        next.every((m, i) => m === previous![i])
      )
        return;
      previous = next;
      if (animationFrame) flushSync(() => setVisible(next));
      else setVisible(next);
    });
  }, [index, camera]);
  return (
    <DiagnosticMarkersOverlay
      markers={visible}
      onSelectMarker={onSelectMarker}
    />
  );
}
