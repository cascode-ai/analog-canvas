export interface EditorTestTelemetrySnapshot {
  diagnosticCheckStatus: import("../../app/project-check").ProjectCheckStatus;
  selectedInternalRouteCount: number;
  revision: number;
  sourceStatus: string;
  documentCount: number;
  activeDocumentId: string;
  activeInstanceCount: number;
  instanceCount: number;
  netCount: number;
  activeTool: string;
  flightlineCount: number;
  displayedFlightlineCount: number;
  crossingCount: number;
  annotationCount: number;
  structuralDiagnosticCount: number;
  visualDiagnosticCount: number;
  blockingDiagnosticCount: number;
}

const telemetryFields: readonly [keyof EditorTestTelemetrySnapshot, string][] =
  [
    ["diagnosticCheckStatus", "diagnostic-check-status"],
    ["selectedInternalRouteCount", "selected-internal-route-count"],
    ["revision", "revision"],
    ["sourceStatus", "source-status"],
    ["documentCount", "document-count"],
    ["activeDocumentId", "active-document-id"],
    ["activeInstanceCount", "active-instance-count"],
    ["instanceCount", "instance-count"],
    ["netCount", "net-count"],
    ["activeTool", "active-tool"],
    ["flightlineCount", "flightline-count"],
    ["displayedFlightlineCount", "displayed-flightline-count"],
    ["crossingCount", "crossing-count"],
    ["annotationCount", "annotation-count"],
    ["structuralDiagnosticCount", "structural-diagnostic-count"],
    ["visualDiagnosticCount", "visual-diagnostic-count"],
    ["blockingDiagnosticCount", "blocking-diagnostic-count"],
  ];

export function EditorTestTelemetry({
  snapshot,
}: {
  snapshot: EditorTestTelemetrySnapshot;
}) {
  return (
    <div data-testid="editor-test-telemetry" hidden>
      {telemetryFields.map(([field, testId]) => (
        <output key={field} data-testid={testId}>
          {snapshot[field]}
        </output>
      ))}
    </div>
  );
}
