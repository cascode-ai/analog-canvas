import { diagnoseProject, diagnoseVisualQuality } from "@icm/derived";
import type { Diagnostic, ObjectLocator } from "@icm/derived";
import type { CircuitProject, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import type { AgentDiagnostic } from "./schema.js";

function locatorWithoutSource({
  sourceRef: _sourceRef,
  ...locator
}: ObjectLocator) {
  return {
    ...locator,
    hierarchyPath: locator.hierarchyPath.map((frame) => ({ ...frame })),
  };
}

function diagnosticObjectIds(diagnostic: Diagnostic): string[] {
  return [diagnostic.primary, ...diagnostic.related]
    .map((locator) => locator.objectId)
    .filter((id, index, ids) => ids.indexOf(id) === index);
}

export function agentVisualDiagnostics(
  document: SchematicDocument,
  resolver: SymbolResolver,
): AgentDiagnostic[] {
  return diagnoseVisualQuality(document, resolver).map((item) => ({
    code: item.code,
    severity: item.severity,
    category: item.category,
    confidence: item.confidence,
    gateEligible: item.gateEligible,
    message: item.message,
    objectIds: [...item.objectIds],
    revision: document.revision,
    ...(item.bounds ? { bounds: item.bounds } : {}),
    ...(item.point ? { point: item.point } : {}),
    ...(item.parameters ? { parameters: { ...item.parameters } } : {}),
  }));
}

export function agentProjectDiagnostics(
  project: CircuitProject,
  resolver: SymbolResolver,
  documentId: string,
  revision: number,
): AgentDiagnostic[] {
  return diagnoseProject(project, resolver)
    .filter((diagnostic) => diagnostic.primary.documentId === documentId)
    .map((diagnostic) => ({
      code: diagnostic.code,
      domain: diagnostic.domain,
      severity: diagnostic.severity,
      confidence: diagnostic.confidence,
      gateEligible: diagnostic.gateEligible,
      message: diagnostic.message,
      objectIds: diagnosticObjectIds(diagnostic),
      primary: locatorWithoutSource(diagnostic.primary),
      related: diagnostic.related.map(locatorWithoutSource),
      revision,
      parameters: { ...diagnostic.parameters },
    }));
}

export function agentDiagnosticIdentity(diagnostic: AgentDiagnostic): string {
  return JSON.stringify({
    domain: diagnostic.domain ?? null,
    code: diagnostic.code,
    objectIds: diagnostic.objectIds ?? [],
    parameters: diagnostic.parameters ?? {},
  });
}
