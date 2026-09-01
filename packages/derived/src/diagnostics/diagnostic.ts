import type { ProjectConnectivityIndex } from "../connectivity-index.js";
import { buildProjectConnectivityIndex } from "../connectivity-index.js";
import { directObjectLocator, type ObjectLocator } from "../object-locator.js";
import type { VisualDiagnostic } from "../visual.js";
import { diagnoseVisualQuality } from "../visual.js";
import type { CircuitProject } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { runErcChecks } from "./erc.js";

/**
 * Unified diagnostic envelope and aggregation (ADR 0015 / roadmap §5.6, WP-R9
 * data layer). Distinct producer domains — schema, spice, erc, routing, visual —
 * share one envelope so the diagnostic UI can group, filter, and navigate them
 * uniformly. Visual observations and electrical ERC never collapse into one
 * "error count": a visual observation is never proof of electrical correctness.
 */

export type DiagnosticDomain =
  "schema" | "spice" | "erc" | "routing" | "visual";

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface Diagnostic {
  id: string;
  domain: DiagnosticDomain;
  code: string;
  severity: DiagnosticSeverity;
  confidence: "high" | "medium" | "low";
  gateEligible: boolean;
  message: string;
  primary: ObjectLocator;
  related: readonly ObjectLocator[];
  parameters: Readonly<Record<string, string | number | boolean>>;
}

export interface DiagnosticDocumentRevision {
  documentId: string;
  revision: number;
}

/**
 * Ephemeral evidence for the current Project only. The stamp lets every
 * consumer prove which Document revisions were evaluated without persisting
 * diagnostics or confusing them with an import/operation report.
 */
export interface LiveDiagnosticSnapshot {
  source: "live";
  projectId: string;
  documentRevisions: readonly DiagnosticDocumentRevision[];
  diagnostics: readonly Diagnostic[];
}

export type DiagnosticPresentationGroup = "actionable" | "observation";

/**
 * Electrical findings and structural gate failures are actionable by default.
 * Non-gating routing/visual heuristics remain available as observations, but
 * must not look like unresolved electrical failures in the default UI.
 */
export function diagnosticPresentationGroup(
  diagnostic: Diagnostic,
): DiagnosticPresentationGroup {
  return (diagnostic.domain === "routing" || diagnostic.domain === "visual") &&
    !diagnostic.gateEligible
    ? "observation"
    : "actionable";
}

const SEVERITY_RANK: Record<DiagnosticSeverity, number> = {
  error: 0,
  warning: 1,
  info: 2,
};

const DOMAIN_ORDER: readonly DiagnosticDomain[] = [
  "schema",
  "spice",
  "erc",
  "routing",
  "visual",
];

const ROUTING_VISUAL_CODES = new Set([
  "VISUAL_WIRE_THROUGH_SYMBOL",
  "VISUAL_ROUTE_OVERLAP",
  "VISUAL_TERMINAL_DEPARTURE",
  "VISUAL_SHORT_SEGMENT",
  "VISUAL_AMBIGUOUS_JUNCTION",
]);

function locatorFromIndex(
  index: ProjectConnectivityIndex,
  documentId: string,
  objectId: string,
): ObjectLocator {
  return (
    index.objectIndex.resolve(documentId, objectId) ?? {
      ...directObjectLocator(documentId, "document", documentId),
    }
  );
}

function visualDiagnosticIdentity(visual: VisualDiagnostic): string {
  return JSON.stringify({
    objectIds: visual.objectIds,
    parameters: Object.entries(visual.parameters ?? {}).sort(
      ([left], [right]) => left.localeCompare(right, "en"),
    ),
    point: visual.point ?? null,
    bounds: visual.bounds ?? null,
  });
}

/**
 * Adapt a `VisualDiagnostic` (current document-scoped observation) into the
 * unified envelope as `domain: "visual"`. Its `objectIds` are resolved to
 * `primary`/`related` locators via the project object index.
 */
export function adaptVisualDiagnostic(
  visual: VisualDiagnostic,
  documentId: string,
  index: ProjectConnectivityIndex,
): Diagnostic {
  const [primaryId, ...relatedIds] = visual.objectIds;
  const primary = primaryId
    ? locatorFromIndex(index, documentId, primaryId)
    : directObjectLocator(documentId, "document", documentId);
  const related = relatedIds
    .map((objectId) => locatorFromIndex(index, documentId, objectId))
    .filter(
      (locator): locator is ObjectLocator & { objectId: string } =>
        locator.objectId !== documentId || locator.kind !== "document",
    );
  return {
    id: `visual:${documentId}:${visual.code}:${visualDiagnosticIdentity(visual)}`,
    domain: ROUTING_VISUAL_CODES.has(visual.code) ? "routing" : "visual",
    code: visual.code,
    severity: visual.severity,
    confidence: visual.confidence,
    gateEligible: visual.gateEligible,
    message: visual.message,
    primary,
    related,
    parameters: visual.parameters ?? {},
  };
}

/** Merge diagnostic groups from distinct producers into one deterministically sorted list. */
export function mergeDiagnostics(
  ...groups: readonly (readonly Diagnostic[])[]
): readonly Diagnostic[] {
  return groups
    .flat()
    .sort(
      (left, right) =>
        DOMAIN_ORDER.indexOf(left.domain) -
          DOMAIN_ORDER.indexOf(right.domain) ||
        SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity] ||
        left.primary.documentId.localeCompare(right.primary.documentId, "en") ||
        left.code.localeCompare(right.code, "en") ||
        left.primary.objectId.localeCompare(right.primary.objectId, "en"),
    );
}

/** Canonical Project diagnostic evidence consumed by the GUI and Agent API. */
/**
 * Which families of evidence to gather.
 *
 * Electrical rules answer a question about a FINISHED circuit — is this gate
 * driven, is this bulk tied — and a circuit halfway through being drawn
 * honestly fails them. Reported while drawing they are noise that buries the
 * one finding worth reading, so a caller that runs continuously asks for
 * `visual` alone, and the moments that need an electrical verdict — export,
 * publication, an explicit check — ask for everything.
 */
export interface DiagnosticDomainOptions {
  domains?: readonly ("erc" | "visual")[];
}

export function diagnoseProject(
  project: CircuitProject,
  resolver: SymbolResolver,
  index = buildProjectConnectivityIndex(project, resolver),
  options: DiagnosticDomainOptions = {},
): readonly Diagnostic[] {
  const wanted = options.domains ?? (["erc", "visual"] as const);
  const visual = project.documents.flatMap((document) => {
    const documentIndex = index.documents.get(document.id);
    return diagnoseVisualQuality(document, resolver, {
      ...(documentIndex
        ? {
            routingGeometry: documentIndex.routingGeometry,
            contactEvidence: documentIndex.contactEvidence,
          }
        : {}),
    }).map((diagnostic) =>
      adaptVisualDiagnostic(diagnostic, document.id, index),
    );
  });
  return mergeDiagnostics(
    wanted.includes("erc") ? runErcChecks(project, index, resolver) : [],
    wanted.includes("visual") ? visual : [],
  );
}

/** Build one revision-stamped, non-persisted snapshot of current evidence. */
export function diagnoseProjectSnapshot(
  project: CircuitProject,
  resolver: SymbolResolver,
  index = buildProjectConnectivityIndex(project, resolver),
  options: DiagnosticDomainOptions = {},
): LiveDiagnosticSnapshot {
  return {
    source: "live",
    projectId: project.id,
    documentRevisions: project.documents
      .map((document) => ({
        documentId: document.id,
        revision: document.revision,
      }))
      .sort((left, right) =>
        left.documentId.localeCompare(right.documentId, "en"),
      ),
    diagnostics: diagnoseProject(project, resolver, index, options),
  };
}
