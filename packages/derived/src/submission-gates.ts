import type { CircuitProject, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import { resolveAnnotationName } from "./annotation-text.js";
import { buildCommittedProjectConnectivityIndex } from "./connectivity-index.js";
import { runErcChecks } from "./diagnostics/erc.js";
import { diagnoseLabelClearance } from "./label-clearance.js";
import { diagnoseVisualQuality, type VisualDiagnostic } from "./visual.js";

/**
 * Gallery submission quality advice (informational only; publishing stays
 * open). Surfaces:
 *
 * - ERC errors;
 * - ERC warnings not already grouped under floating endpoints;
 * - floating endpoints — every visible pin is wired into a net with other
 *   members or carries a sanctioned intent (formal boundary, global supply,
 *   implicit pin, or explicit NoConnect) already classified by ERC;
 * - near-empty submissions — fewer than 2 instances and fewer than 3
 *   drafting objects including a text (pure block diagrams stay clean);
 * - stale simulation folders — any folder whose circuit binding references a
 *   missing Cell, or spec-less scratch folders left alongside folders that
 *   declare `@spec` checks (#2617).
 * - labels drawn over wires, parts or other labels: every label visual
 *   finding above info (`isLabelClearanceAdvice`), so a new label code
 *   joins by its severity.
 */

export type SubmissionGateCode =
  | "erc-errors"
  | "erc-warnings"
  | "floating-endpoints"
  | "empty-project"
  | "stale-simulation-folders"
  | "label-clearance";

/** One finding behind a failure, where the drawing has it. */
export interface SubmissionGateFinding {
  code: string;
  message: string;
  documentId: string;
  /** For a label finding, the labels first, then what they are drawn over. */
  objectIds: readonly string[];
  /** For a label finding, the part its first label names ("M1"). */
  subject?: string;
}

export interface SubmissionGateFailure {
  code: SubmissionGateCode;
  message: string;
  count: number;
  /** Up to five human-readable example labels ("M1.g", "ERC_…"). */
  examples: readonly string[];
  /** ERC warnings and label findings, up to FINDING_LIMIT of them. */
  findings?: readonly SubmissionGateFinding[];
}

export interface SubmissionGateReport {
  ok: boolean;
  failures: readonly SubmissionGateFailure[];
}

const FLOATING_CODES = new Set([
  "ERC_UNCONNECTED_PIN",
  "ERC_FLOATING_GATE",
  "ERC_BULK_UNRESOLVED",
]);

const EXAMPLE_LIMIT = 5;
const FINDING_LIMIT = 50;

/**
 * A label finding Publish advises on: any `VISUAL_LABEL_*` code above info
 * (VISUAL_LABEL_CLEARANCE, VISUAL_LABEL_OVERLAP), so a new label code is
 * advised by its severity alone. Info notes (a label far from its owner, two
 * names reading as one) stay out.
 */
export function isLabelClearanceAdvice(diagnostic: {
  code: string;
  severity: string;
}): boolean {
  return (
    diagnostic.code.startsWith("VISUAL_LABEL_") &&
    diagnostic.severity !== "info"
  );
}

function terminalLabel(parameters: Record<string, unknown>): string {
  const instanceId = parameters.instanceId;
  const pinName = parameters.pinName;
  return typeof instanceId === "string" && typeof pinName === "string"
    ? `${instanceId}.${pinName}`
    : "(terminal)";
}

function formatDiagnosticExamples(
  diagnostics: readonly {
    code: string;
    primary: { objectId: string };
  }[],
): string[] {
  return diagnostics
    .slice(0, EXAMPLE_LIMIT)
    .map((diagnostic) => `${diagnostic.code}: ${diagnostic.primary.objectId}`);
}

const SIMULATION_SPEC_LINE = /^\s*(?:\*|\/\/)\s*@spec\b/imu;

function folderHasSpecDeclaration(
  folder: NonNullable<CircuitProject["simulationFolders"]>[number],
): boolean {
  const configPath = folder.input.configPath;
  return folder.input.files.some(
    (file) => file.path !== configPath && SIMULATION_SPEC_LINE.test(file.text),
  );
}

function staleSimulationFolderExamples(project: CircuitProject): string[] {
  const folders = project.simulationFolders ?? [];
  if (folders.length === 0) return [];
  const documentIds = new Set(project.documents.map((doc) => doc.id));
  const issues: string[] = [];
  const specPresence = folders.map((folder) => ({
    folder,
    hasSpec: folderHasSpecDeclaration(folder),
  }));
  const hasAnySpec = specPresence.some((entry) => entry.hasSpec);
  for (const { folder, hasSpec } of specPresence) {
    const missingBinding = folder.input.circuitBindings.find(
      (binding) => !documentIds.has(binding.documentId),
    );
    if (missingBinding) {
      issues.push(`${folder.name} (missing Cell ${missingBinding.documentId})`);
      continue;
    }
    if (folders.length > 1 && hasAnySpec && !hasSpec) {
      issues.push(`${folder.name} (no @spec)`);
    }
  }
  return issues;
}

function ercFindings(
  diagnostics: readonly {
    code: string;
    message: string;
    primary: { documentId: string; objectId: string };
    related: readonly { objectId: string }[];
  }[],
): SubmissionGateFinding[] {
  return diagnostics.slice(0, FINDING_LIMIT).map((diagnostic) => ({
    code: diagnostic.code,
    message: diagnostic.message,
    documentId: diagnostic.primary.documentId,
    objectIds: [
      ...new Set([
        diagnostic.primary.objectId,
        ...diagnostic.related.map((locator) => locator.objectId),
      ]),
    ],
  }));
}

/** The part a label names, else what the label reads (a Net's name). */
function labelExample(document: SchematicDocument, labelId: string): string {
  const label = document.annotations.find((item) => item.id === labelId);
  if (!label) return labelId;
  const anchor = label.anchor;
  const owner =
    anchor.kind === "object"
      ? document.instances.find((item) => item.id === anchor.objectId)
      : undefined;
  return (
    owner?.reference ??
    owner?.id ??
    (resolveAnnotationName(document, label) || labelId)
  );
}

function labelFindings(
  project: CircuitProject,
  resolver: SymbolResolver,
): { findings: SubmissionGateFinding[]; examples: string[] } {
  const findings: SubmissionGateFinding[] = [];
  const examples = new Set<string>();
  for (const document of project.documents) {
    const seen = new Set<string>();
    let diagnostics: readonly VisualDiagnostic[];
    try {
      diagnostics = [
        ...diagnoseVisualQuality(document, resolver),
        ...diagnoseLabelClearance(document, resolver),
      ];
    } catch {
      // Advice never stands in Publish's way: a drawing the label checks
      // cannot read is published without their word.
      continue;
    }
    for (const diagnostic of diagnostics) {
      if (!isLabelClearanceAdvice(diagnostic)) continue;
      const key = `${diagnostic.code}:${diagnostic.objectIds.join(",")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const first = diagnostic.objectIds[0];
      const subject =
        first === undefined ? undefined : labelExample(document, first);
      findings.push({
        code: diagnostic.code,
        message: diagnostic.message,
        documentId: document.id,
        objectIds: [...diagnostic.objectIds],
        ...(subject === undefined ? {} : { subject }),
      });
      if (subject !== undefined) examples.add(subject);
    }
  }
  return { findings, examples: [...examples].slice(0, EXAMPLE_LIMIT) };
}

export function evaluateSubmissionGates(
  project: CircuitProject,
  resolver: SymbolResolver,
): SubmissionGateReport {
  const failures: SubmissionGateFailure[] = [];
  const diagnostics = runErcChecks(
    project,
    buildCommittedProjectConnectivityIndex(project, resolver),
    resolver,
  );

  const errors = diagnostics.filter(
    (diagnostic) => diagnostic.severity === "error",
  );
  if (errors.length > 0) {
    failures.push({
      code: "erc-errors",
      message: "The schematic has electrical rule errors",
      count: errors.length,
      examples: formatDiagnosticExamples(errors),
    });
  }

  const warnings = diagnostics.filter(
    (diagnostic) =>
      diagnostic.severity === "warning" && !FLOATING_CODES.has(diagnostic.code),
  );
  if (warnings.length > 0) {
    failures.push({
      code: "erc-warnings",
      message: "The schematic has electrical rule warnings",
      count: warnings.length,
      examples: formatDiagnosticExamples(warnings),
      findings: ercFindings(warnings),
    });
  }

  const floating = diagnostics.filter((diagnostic) =>
    FLOATING_CODES.has(diagnostic.code),
  );
  if (floating.length > 0) {
    failures.push({
      code: "floating-endpoints",
      message:
        "Floating endpoints: wire each pin, declare a formal/global boundary, or mark it NoConnect",
      count: floating.length,
      examples: floating
        .slice(0, EXAMPLE_LIMIT)
        .map((diagnostic) => terminalLabel(diagnostic.parameters)),
    });
  }

  const instanceCount = project.documents.reduce(
    (total, document) => total + document.instances.length,
    0,
  );
  const draftingObjects = project.documents.flatMap(
    (document) => document.drafting?.objects ?? [],
  );
  const drawingSubstantial =
    draftingObjects.length >= 3 &&
    draftingObjects.some((object) => object.kind === "text");
  if (instanceCount < 2 && !drawingSubstantial) {
    failures.push({
      code: "empty-project",
      message:
        "Too little content: place at least 2 components, or a drawing with 3+ objects including text",
      count: 1,
      examples: [],
    });
  }

  const staleFolders = staleSimulationFolderExamples(project);
  if (staleFolders.length > 0) {
    failures.push({
      code: "stale-simulation-folders",
      message:
        "Remove or update stale simulation folders that lack @spec checks or bind missing Cells",
      count: staleFolders.length,
      examples: staleFolders.slice(0, EXAMPLE_LIMIT),
    });
  }

  const labels = labelFindings(project, resolver);
  if (labels.findings.length > 0) {
    failures.push({
      code: "label-clearance",
      message: "Labels are drawn over wires, parts or other labels",
      count: labels.findings.length,
      examples: labels.examples,
      findings: labels.findings.slice(0, FINDING_LIMIT),
    });
  }

  return { ok: failures.length === 0, failures };
}
