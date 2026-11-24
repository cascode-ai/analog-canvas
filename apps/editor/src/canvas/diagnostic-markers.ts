import {
  adaptVisualDiagnostic,
  diagnosticPresentationGroup,
  resolveEndpointPoint,
} from "@icm/derived";
import type {
  Diagnostic,
  ProjectConnectivityIndex,
  VisualDiagnostic,
} from "@icm/derived";
import type { Point, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

export const DIAGNOSTIC_MARKER_HIT_RADIUS = 8.5;

export interface DiagnosticMarker {
  key: string;
  point: Point;
  severity: "error" | "warning";
  /** Findings sharing this point; the ring shows a numeral above one. */
  count: number;
  /** The highest-severity finding here — the click's navigation payload. */
  diagnostic: Diagnostic;
}

/**
 * Place actionable findings on the canvas. Errors always earn a marker;
 * warnings appear only while the issues review is open, and observations
 * never render — the same presentation grouping the badge and workbench use.
 * Findings without a resolvable point on this document simply stay off the
 * map; the workbench remains the complete list.
 */
export function buildDiagnosticMarkers(input: {
  document: SchematicDocument;
  resolver: SymbolResolver;
  connectivityIndex: ProjectConnectivityIndex;
  electricalDiagnostics: readonly Diagnostic[];
  visualDiagnostics: readonly VisualDiagnostic[];
  reviewOpen: boolean;
}): DiagnosticMarker[] {
  const byPoint = new Map<string, DiagnosticMarker>();
  const lookup = input.connectivityIndex.documents.get(input.document.id);
  function add(
    point: Point,
    severity: DiagnosticMarker["severity"],
    diagnostic: Diagnostic,
  ) {
    const key = `${point.x},${point.y}`;
    const marker = byPoint.get(key);
    if (!marker)
      byPoint.set(key, {
        key,
        point: { ...point },
        severity,
        diagnostic,
        count: 1,
      });
    else {
      marker.count++;
      if (severity === "error" && marker.severity !== "error") {
        marker.severity = severity;
        marker.diagnostic = diagnostic;
      }
    }
  }
  for (const diagnostic of input.electricalDiagnostics) {
    if (diagnostic.primary.documentId !== input.document.id) continue;
    if (diagnostic.severity !== "error" && diagnostic.severity !== "warning") {
      continue;
    }
    if (diagnosticPresentationGroup(diagnostic) !== "actionable") continue;
    if (diagnostic.severity === "warning" && !input.reviewOpen) continue;
    const endpoint = diagnostic.primary.endpoint;
    if (!endpoint) continue;
    const point = resolveEndpointPoint(
      input.document,
      input.resolver,
      endpoint,
      lookup,
    );
    if (!point) continue;
    add(point, diagnostic.severity, diagnostic);
  }
  for (const visual of input.visualDiagnostics) {
    if (!visual.point) continue;
    if (visual.severity !== "error" && visual.severity !== "warning") continue;
    if (visual.severity === "warning" && !input.reviewOpen) continue;
    const diagnostic = adaptVisualDiagnostic(
      visual,
      input.document.id,
      input.connectivityIndex,
    );
    if (diagnosticPresentationGroup(diagnostic) !== "actionable") continue;
    add(visual.point, visual.severity, diagnostic);
  }
  return [...byPoint.values()].sort((left, right) =>
    left.key.localeCompare(right.key, "en"),
  );
}
