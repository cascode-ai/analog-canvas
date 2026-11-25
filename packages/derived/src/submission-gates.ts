import type { CircuitProject } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import { buildCommittedProjectConnectivityIndex } from "./connectivity-index.js";
import { runErcChecks } from "./diagnostics/erc.js";

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
 */

export type SubmissionGateCode =
  | "erc-errors"
  | "erc-warnings"
  | "floating-endpoints"
  | "empty-project"
  | "stale-simulation-folders";

export interface SubmissionGateFailure {
  code: SubmissionGateCode;
  message: string;
  count: number;
  /** Up to five human-readable example labels ("M1.g", "ERC_…"). */
  examples: readonly string[];
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

  return { ok: failures.length === 0, failures };
}
