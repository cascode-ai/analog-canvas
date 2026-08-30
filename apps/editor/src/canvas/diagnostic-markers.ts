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

export interface DiagnosticMarker {
  key: string;
  point: Point;
  severity: "error" | "warning";
  /** Findings sharing this point; the ring shows a numeral above one. */
  count: number;
  /** The highest-severity finding here — the click's navigation payload. */
  diagnostic: Diagnostic;
}

interface MarkerEntry {
  point: Point;
  severity: "error" | "warning";
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
  const entries: MarkerEntry[] = [];
  for (const diagnostic of input.electricalDiagnostics) {
    if (diagnostic.primary.documentId !== input.document.id) continue;
    if (diagnostic.severity !== "error" && diagnostic.severity !== "warning") {
      continue;
    }
    if (diagnosticPresentationGroup(diagnostic) !== "actionable") continue;
    const endpoint = diagnostic.primary.endpoint;
    if (!endpoint) continue;
    const point = resolveEndpointPoint(
      input.document,
      input.resolver,
      endpoint,
    );
    if (!point) continue;
    entries.push({ point, severity: diagnostic.severity, diagnostic });
  }
  for (const visual of input.visualDiagnostics) {
    if (!visual.point) continue;
    if (visual.severity !== "error" && visual.severity !== "warning") continue;
    const diagnostic = adaptVisualDiagnostic(
      visual,
      input.document.id,
      input.connectivityIndex,
    );
    if (diagnosticPresentationGroup(diagnostic) !== "actionable") continue;
    entries.push({
      point: { ...visual.point },
      severity: visual.severity,
      diagnostic,
    });
  }
  const visible = entries.filter(
    (entry) => entry.severity === "error" || input.reviewOpen,
  );
  const byPoint = new Map<string, MarkerEntry[]>();
  for (const entry of visible) {
    const key = `${entry.point.x},${entry.point.y}`;
    byPoint.set(key, [...(byPoint.get(key) ?? []), entry]);
  }
  return [...byPoint.entries()]
    .map(([key, group]) => {
      const severity = group.some((entry) => entry.severity === "error")
        ? ("error" as const)
        : ("warning" as const);
      const primary = group.find((entry) => entry.severity === severity)!;
      return {
        key,
        point: { ...primary.point },
        severity,
        count: group.length,
        diagnostic: primary.diagnostic,
      };
    })
    .sort((left, right) => left.key.localeCompare(right.key, "en"));
}
