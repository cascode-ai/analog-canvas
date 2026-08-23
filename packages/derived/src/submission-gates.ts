import type { CircuitProject } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import { buildProjectConnectivityIndex } from "./connectivity-index.js";
import { runErcChecks } from "./diagnostics/erc.js";

/**
 * Gallery submission quality gates (roadmap phase G3). One deterministic
 * evaluator runs in the publish dialog (live feedback) and in the worker
 * (authoritative enforcement), so the API can never accept what the UI
 * would refuse. Policy set by the owner:
 *
 * - no ERC errors;
 * - no floating endpoints — every visible pin is wired into a net with
 *   other members or carries a sanctioned intent (formal boundary, global
 *   supply, implicit pin, or explicit NoConnect) already classified by ERC;
 * - no near-empty submissions — at least 2 instances, or a drawing with
 *   at least 3 drafting objects including a text (pure block diagrams
 *   stay submittable).
 */

export type SubmissionGateCode =
  "erc-errors" | "floating-endpoints" | "empty-project";

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

export function evaluateSubmissionGates(
  project: CircuitProject,
  resolver: SymbolResolver,
): SubmissionGateReport {
  const failures: SubmissionGateFailure[] = [];
  const diagnostics = runErcChecks(
    project,
    buildProjectConnectivityIndex(project, resolver),
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
      examples: errors
        .slice(0, EXAMPLE_LIMIT)
        .map(
          (diagnostic) => `${diagnostic.code}: ${diagnostic.primary.objectId}`,
        ),
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

  return { ok: failures.length === 0, failures };
}
