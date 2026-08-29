import {
  createRoutingOperationPlan,
  gateRoutingOperationPlan,
} from "@icm/edit-engine";
import type {
  EditTransactionResult,
  ProjectStructureEdit,
  ProjectTransaction,
  ProjectTransactionResult,
  SchematicEdit,
  RoutingOperationIntent,
} from "@icm/edit-engine";
import type { CircuitProject, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import type { InteractionMode } from "../interaction/interaction-state";

interface TransactionOptions {
  completesWireSession?: boolean;
  preserveInteraction?: boolean;
}

export interface EditorTransactionCommandDependencies {
  project: CircuitProject;
  document: SchematicDocument;
  resolver?: SymbolResolver;
  dispatchProjectTransaction: (
    request: ProjectTransaction,
    activeDocumentId?: string,
  ) => ProjectTransactionResult;
  transactDocument: (edits: readonly SchematicEdit[]) => EditTransactionResult;
  getCurrentInteractionKind: () => InteractionMode;
  cancelAllTransientInteraction: () => void;
  setStatus: (status: string) => void;
}

/**
 * Projects the editor's validated Document/Project controller into UI command
 * semantics. Model history remains owned by EditorDocumentController; this
 * boundary owns only transaction envelopes, status messages, connectivity
 * gating, and the rule that an unrelated commit cancels a transient tool.
 */
export function createEditorTransactionCommands({
  project,
  document,
  resolver,
  dispatchProjectTransaction,
  transactDocument,
  getCurrentInteractionKind,
  cancelAllTransientInteraction,
  setStatus,
}: EditorTransactionCommandDependencies) {
  const commitStructure = (
    transactionId: string,
    edits: ProjectStructureEdit[],
    activeDocumentId = document.id,
  ): boolean => {
    const result = dispatchProjectTransaction(
      {
        transactionId,
        projectId: project.id,
        expectedStructureRevision: project.structureRevision,
        actor: { kind: "human", id: "human-local" },
        edits,
      },
      activeDocumentId,
    );
    if (result.ok && result.applied) return true;
    const message = result.ok
      ? "The structural transaction made no change"
      : (result.diagnostics[0]?.message ?? result.error.message);
    setStatus(`Could not update Cell structure: ${message}`);
    return false;
  };

  const applyResult = (result: EditTransactionResult): void => {
    if (!result.ok) {
      const detail = result.diagnostics[0]?.message;
      setStatus(
        detail && detail !== result.error.message
          ? `${result.error.code}: ${result.error.message} — ${detail}`
          : `${result.error.code}: ${result.error.message}`,
      );
      return;
    }
    setStatus(
      result.applied
        ? `Committed revision ${result.revision}`
        : `Dry run for revision ${result.proposedRevision}`,
    );
  };

  const transact = (
    edits: SchematicEdit[],
    options: TransactionOptions = {},
  ): EditTransactionResult => {
    let result: EditTransactionResult;
    try {
      result = transactDocument(edits);
    } catch (error) {
      cancelAllTransientInteraction();
      const message =
        error instanceof Error ? error.message : "unexpected failure";
      setStatus(
        `INTERNAL_ERROR: ${message} — operation cancelled; circuit unchanged`,
      );
      return {
        ok: false,
        applied: false,
        revision: document.revision,
        document,
        error: { code: "INTERNAL_ERROR", message },
        diagnostics: [],
      };
    }
    applyResult(result);
    if (!result.ok && result.error.code === "INTERNAL_ERROR") {
      cancelAllTransientInteraction();
    }
    const interactionKind = getCurrentInteractionKind();
    const preservesCurrentInteraction =
      options.preserveInteraction ||
      (interactionKind === "wire" && options.completesWireSession);
    if (
      result.ok &&
      interactionKind !== "idle" &&
      !preservesCurrentInteraction
    ) {
      cancelAllTransientInteraction();
      setStatus(
        interactionKind === "wire"
          ? `Committed revision ${result.revision}; Wire cancelled because the circuit changed`
          : `Committed revision ${result.revision}; active tool cancelled because the circuit changed`,
      );
    }
    return result;
  };

  const transactConnectivity = (
    intent: RoutingOperationIntent,
    edits: readonly SchematicEdit[],
    options: TransactionOptions = {},
  ): EditTransactionResult | null => {
    const proposal = createRoutingOperationPlan(document, {
      intent,
      edits,
      diagnostics: [],
    });
    const gate = gateRoutingOperationPlan(document, proposal, {
      ...(resolver ? { symbolResolver: resolver } : {}),
    });
    if (!gate.ok) {
      // Say which rule refused, the way applyResult does for direct edits:
      // the headline alone ("Transaction result failed Document validation")
      // names no field and leaves nothing to report or fix.
      const detail = gate.diagnostics[0]?.message;
      setStatus(
        detail && detail !== gate.message
          ? `${gate.message} — ${detail}`
          : gate.message,
      );
      return null;
    }
    return transact([...gate.edits], options);
  };

  return { commitStructure, transact, transactConnectivity };
}
