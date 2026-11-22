/**
 * An action list that needs several transactions, committed as one: each
 * call the compiler names, in order, planned on the Document the call before
 * it left, inside one host history group. One Undo takes the whole list
 * back; a refused call puts the Project back as it was, so nothing changes.
 */
import type { CircuitProject, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import type { ActionCall } from "./authoring-helper.js";
import { agentDiagnosticIdentity } from "./diagnostics.js";
import type { AgentOperationHost } from "./host.js";
import type {
  AgentCircuitRequest,
  AgentCircuitResponse,
  AgentDiagnostic,
} from "./schema.js";
import { terminalConnectivity } from "./terminal-connectivity.js";

type TransactRequest = Extract<AgentCircuitRequest, { operation: "transact" }>;
type TransactAnswer = Extract<
  AgentCircuitResponse,
  { operation: "transact"; ok: true }
>;
type Failure = Extract<AgentCircuitResponse, { ok: false }>;

type DiagnosticsFor = (
  project: CircuitProject | undefined,
  document: SchematicDocument,
  resolver: SymbolResolver,
) => AgentDiagnostic[];

/** Added and removed findings between two states, as a receipt carries them. */
export function diagnosticDeltaOf(
  before: readonly AgentDiagnostic[],
  after: readonly AgentDiagnostic[],
  notes: readonly AgentDiagnostic[],
  detail: "full" | "compact" | undefined,
) {
  const beforeIds = new Set(before.map(agentDiagnosticIdentity));
  const afterIds = new Set(after.map(agentDiagnosticIdentity));
  const removed = before.filter(
    (diagnostic) => !afterIds.has(agentDiagnosticIdentity(diagnostic)),
  );
  return {
    added: [
      ...notes,
      ...after.filter(
        (diagnostic) => !beforeIds.has(agentDiagnosticIdentity(diagnostic)),
      ),
    ],
    removed: detail === "compact" ? [] : removed,
    ...(detail === "compact"
      ? { removedIds: removed.map(agentDiagnosticIdentity) }
      : {}),
  };
}

export interface ActionCallsContext {
  request: TransactRequest & { actions: unknown[] };
  calls: readonly ActionCall[];
  host: AgentOperationHost;
  /** The host's history group, which this needs. */
  atomically: NonNullable<AgentOperationHost["atomically"]>;
  /** The service itself: each call is planned and committed as one. */
  handle(input: unknown): AgentCircuitResponse;
  diagnosticsFor: DiagnosticsFor;
  before: {
    project: CircuitProject | undefined;
    document: SchematicDocument;
    resolver: SymbolResolver;
  };
}

/** Renumber `actions[i]` in a call's text to the list's own indexes. */
function renumber(text: string, indices: readonly number[]): string {
  return text.replace(/actions\[(\d+)\]/gu, (whole, index: string) =>
    indices[Number(index)] === undefined
      ? whole
      : `actions[${indices[Number(index)]}]`,
  );
}

/** A call's refusal, named in the list's terms, with nothing changed. */
function listFailure(
  failure: Failure,
  indices: readonly number[],
  part: number,
  parts: number,
  revision: number,
): Failure {
  const at = (index: number | undefined) =>
    index === undefined ? undefined : (indices[index] ?? index);
  const { error } = failure;
  const message = renumber(error.message, indices);
  return {
    ...failure,
    revision,
    error: {
      ...error,
      message:
        part > 1
          ? `${message}${/[.!?]$/u.test(message) ? "" : "."} This list needed ${parts} transactions; transaction ${part} failed, so the ${part - 1} before it were taken back and nothing changed.`
          : message,
      ...(error.actionIndex === undefined
        ? {}
        : { actionIndex: at(error.actionIndex)! }),
      ...(error.issues
        ? {
            issues: error.issues.map((issue) => ({
              ...issue,
              actionIndex: at(issue.actionIndex)!,
              message: renumber(issue.message, indices),
              ...(issue.dependsOn === undefined
                ? {}
                : { dependsOn: at(issue.dependsOn)! }),
            })),
          }
        : {}),
    },
    diagnostics: failure.diagnostics.map((diagnostic) => {
      const actionIndex = diagnostic.parameters?.["actionIndex"];
      return typeof actionIndex === "number"
        ? {
            ...diagnostic,
            message: renumber(diagnostic.message, indices),
            parameters: {
              ...diagnostic.parameters,
              actionIndex: at(actionIndex)!,
            },
          }
        : diagnostic;
    }),
  };
}

/**
 * Run the calls as one history step and answer for the whole list: one
 * receipt from the state before to the state after, or the first refusal
 * with the Project as it was. A dry run runs them too, then takes them back.
 */
export function runActionCalls(
  context: ActionCallsContext,
): AgentCircuitResponse {
  const { request, host, before } = context;
  const { actions, ...base } = request;
  const isFocus = (index: number) =>
    (actions[index] as { kind?: unknown } | null)?.kind === "focus";
  // A focus changes only the view: it follows the commit (#1517).
  const parts = context.calls
    .map((call) => call.actionIndices.filter((index) => !isFocus(index)))
    .filter((indices) => indices.length > 0);
  const focus = actions.flatMap((_, index) => (isFocus(index) ? [index] : []));
  const documentId = before.document.id;
  const current = () => ({
    project: host.getProject?.(),
    document: host.getDocument(documentId),
    resolver: host.getResolver(),
  });
  const send = (indices: readonly number[], suffix: string) => {
    const { project, document } = current();
    return context.handle({
      ...base,
      transactionId: `${request.transactionId}-${suffix}`.slice(0, 256),
      dryRun: false,
      expectedRevision: document?.revision ?? before.document.revision,
      ...(project && base.expectedStructureRevision !== undefined
        ? { expectedStructureRevision: project.structureRevision }
        : {}),
      actions: indices.map((index) => actions[index]),
    });
  };

  type Outcome =
    | { failure: Failure; indices: readonly number[]; part: number }
    | { answer: TransactAnswer };
  const notes = new Map<string, AgentDiagnostic>();
  const answers: TransactAnswer[] = [];
  const outcome = context.atomically(
    (): Outcome => {
      for (const [index, indices] of parts.entries()) {
        const answer = send(indices, `${index + 1}`);
        if (!answer.ok) return { failure: answer, indices, part: index + 1 };
        if (answer.operation !== "transact")
          throw new Error("A planned call answered with no transaction");
        answers.push(answer);
        const after = current();
        if (!after.document)
          return {
            failure: {
              apiVersion: request.apiVersion,
              requestId: request.requestId,
              operation: "transact",
              ok: false,
              error: {
                code: "DOCUMENT_NOT_FOUND",
                message: `Transaction ${index + 1} of this list removed Document ${documentId}, which the rest of it edits.`,
              },
              diagnostics: [],
            },
            indices,
            part: index + 1,
          };
        // What the call said beside the drawing's findings, such as the
        // markers a move carried along.
        const standing = new Set(
          context
            .diagnosticsFor(after.project, after.document, after.resolver)
            .map(agentDiagnosticIdentity),
        );
        for (const diagnostic of answer.diagnostics) {
          const identity = agentDiagnosticIdentity(diagnostic);
          if (diagnostic.severity === "info" && !standing.has(identity))
            notes.set(identity, diagnostic);
        }
      }
      return { answer: summary() };
    },
    (result) => "answer" in result && !request.dryRun,
  );
  if ("failure" in outcome)
    return listFailure(
      outcome.failure,
      outcome.indices,
      outcome.part,
      parts.length,
      before.document.revision,
    );
  if (request.dryRun)
    return {
      ...outcome.answer,
      applied: false,
      revision: before.document.revision,
    };
  if (!focus.length) return outcome.answer;
  const shown = send(focus, "focus");
  if (shown.ok && shown.operation === "transact")
    return {
      ...outcome.answer,
      ...(shown.semantic ? { semantic: shown.semantic } : {}),
    };
  // The edit stands; only the view did not follow it.
  const unshown: AgentDiagnostic = {
    code: shown.ok ? "VIEW_STEP_SKIPPED" : shown.error.code,
    severity: "warning",
    message: `The edit committed; its focus was not shown${shown.ok ? "" : `: ${shown.error.message}`}`,
  };
  return {
    ...outcome.answer,
    diagnostics: [...outcome.answer.diagnostics, unshown],
    diagnosticDelta: {
      ...outcome.answer.diagnosticDelta!,
      added: [...outcome.answer.diagnosticDelta!.added, unshown],
    },
  };

  /** The whole list's receipt, read in the state its last call left. */
  function summary(): TransactAnswer {
    const after = current();
    const document = after.document!;
    const diagnostics = context.diagnosticsFor(
      after.project,
      document,
      after.resolver,
    );
    const together: AgentDiagnostic = {
      code: "ACTIONS_COMMITTED_TOGETHER",
      severity: "info",
      message: request.dryRun
        ? `These actions need ${parts.length} transactions; they would commit together as one Undo step.`
        : `These actions needed ${parts.length} transactions; they committed together as one Undo step.`,
      parameters: { transactions: parts.length },
    };
    const added = [together, ...notes.values()];
    // A Route later calls redrew answers with its last geometry.
    const routes = new Map<
      string,
      NonNullable<TransactAnswer["resolvedRoutes"]>[number]
    >();
    const kept = new Set(document.routes.map((route) => route.id));
    for (const answer of answers)
      for (const route of answer.resolvedRoutes ?? [])
        if (kept.has(route.routeId)) routes.set(route.routeId, route);
    const structure =
      after.project &&
      before.project &&
      after.project.structureRevision !== before.project.structureRevision
        ? {
            projectStructure: {
              fromRevision: before.project.structureRevision,
              toRevision: after.project.structureRevision,
              changedDocumentIds: [
                ...new Set(
                  answers.flatMap(
                    (answer) =>
                      answer.projectStructure?.changedDocumentIds ?? [],
                  ),
                ),
              ],
              documentIds: after.project.documents.map((item) => item.id),
              topDocumentId: after.project.topDocumentId,
            },
          }
        : {};
    return {
      apiVersion: request.apiVersion,
      requestId: request.requestId,
      operation: "transact",
      ok: true,
      applied: answers.some((answer) => answer.applied),
      revision: document.revision,
      proposedRevision: document.revision,
      diff: {
        documentId,
        fromRevision: before.document.revision,
        toRevision: document.revision,
        editKinds: answers.flatMap((answer) => answer.diff.editKinds),
        changedObjectIds: [
          ...new Set(answers.flatMap((answer) => answer.diff.changedObjectIds)),
        ].sort(),
      },
      terminalConnectivityChanged:
        terminalConnectivity(before.document) !==
        terminalConnectivity(document),
      ...structure,
      diagnostics: [...added, ...diagnostics],
      diagnosticDelta: diagnosticDeltaOf(
        context.diagnosticsFor(
          before.project,
          before.document,
          before.resolver,
        ),
        diagnostics,
        added,
        request.diagnosticDeltaDetail,
      ),
      ...(routes.size ? { resolvedRoutes: [...routes.values()] } : {}),
    };
  }
}
