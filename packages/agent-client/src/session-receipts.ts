/**
 * What an action list or transaction reports back (its receipt), and the
 * pure helpers that fill one in.
 */
import type { AgentTransactSuccessResponseSchema } from "@icm/agent-adapter";
import type { ActionCall } from "@icm/agent-adapter/authoring";
import type { z } from "zod";

type AgentTransactResponse = z.infer<typeof AgentTransactSuccessResponseSchema>;

export interface ApplyActionsReport {
  projectId?: string;
  workspaceId?: string | null;
  documentId?: string;
  requestId?: string;
  applied?: boolean;
  proposedRevision?: number;
  editKinds?: string[];
  diagnostics?: AgentTransactResponse["diagnostics"];
  diagnosticDelta?: AgentTransactResponse["diagnosticDelta"];
  projectStructure?: AgentTransactResponse["projectStructure"];
  semantic?: AgentTransactResponse["semantic"];
  resolvedRoutes?: AgentTransactResponse["resolvedRoutes"];
  terminalConnectivityChanged?: boolean;
  ok: boolean;
  stage: "compile" | "commit" | "done";
  /** Machine code for a failure (`STATE_CHANGED`, engine code, ...). */
  code?: string;
  message?: string;
  actionIndex?: number;
  actionKind?: string;
  revision?: number;
  transactions?: number;
  /** ACTION_BATCH_NOT_ATOMIC: the calls to send instead, in order. */
  calls?: ActionCall[];
  changedObjectIds?: string[];
  /**
   * The parts the list's place-component actions placed, in order, with
   * the ID each got and its Reference (or Cell Pin name), so wiring needs
   * no read to learn them (#1525). A ground has no name.
   */
  placed?: PlacedPart[];
  errors?: number;
  /** How many of `errors` are pins not wired yet (MISSING_PIN_NET). */
  unwiredPins?: number;
  warnings?: number;
  dryRun?: boolean;
}

export interface PlacedPart {
  id: string;
  reference?: string;
  symbol: string;
}

/**
 * Give each place-component action that names no ID one of its own, as
 * the editor would (`instance-<uuid>`), so the receipt knows which part
 * each action made. An ID the caller chose is kept.
 */
export function withPlacementIds(actions: readonly unknown[]): {
  actions: unknown[];
  placed: PlacedPart[];
} {
  const placed: PlacedPart[] = [];
  const sent = actions.map((action) => {
    const place = action as {
      kind?: unknown;
      id?: unknown;
      symbol?: unknown;
      reference?: unknown;
    } | null;
    if (place?.kind !== "place-component" || typeof place.symbol !== "string")
      return action;
    const id =
      typeof place.id === "string"
        ? place.id
        : `instance-${crypto.randomUUID()}`;
    placed.push({
      id,
      ...(typeof place.reference === "string"
        ? { reference: place.reference }
        : {}),
      symbol: place.symbol,
    });
    return place.id === undefined ? { ...place, id } : action;
  });
  return { actions: sent, placed };
}

/** The action an editor's refusal of an action list names, if it does. */
export function refusedAction(error: {
  actionIndex?: number | undefined;
  actionKind?: string | undefined;
}): { actionIndex?: number; actionKind?: string } {
  return error.actionIndex === undefined
    ? {}
    : {
        actionIndex: error.actionIndex,
        ...(error.actionKind ? { actionKind: error.actionKind } : {}),
      };
}

/**
 * A refused report that names the action it refused, by index and kind
 * (#1231), when `indexOf` can tell which one it was.
 */
/** A schema refusal that names the field, as `structureEdits[0].edits[1].kind: …`. */
export function schemaIssueText(issue: z.core.$ZodIssue | undefined): string {
  if (!issue) return "Invalid transaction";
  const path = issue.path
    .map((part, index) =>
      typeof part === "number"
        ? `[${part}]`
        : `${index === 0 ? "" : "."}${String(part)}`,
    )
    .join("");
  return path ? `${path}: ${issue.message}` : issue.message;
}
