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
  ExpectedElectricalEffect,
  RoutingOperationIntent,
} from "@icm/edit-engine";
import type { CircuitProject, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import type { InteractionMode } from "../interaction/interaction-state";

interface TransactionOptions {
  completesWireSession?: boolean;
  preserveInteraction?: boolean;
}

interface ConnectivityTransactionOptions extends TransactionOptions {
  expectedElectricalEffect?: ExpectedElectricalEffect;
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
/**
 * Restate an electrical-invariant refusal in the words of the drawing.
 *
 * The routing gate names the invariant it defends ("outside a preserve
 * effect"), which is the right vocabulary for a planner and the wrong one for
 * the person holding the mouse. Unknown refusals pass through unchanged: an
 * honest technical sentence beats a vague friendly one.
 */
export function plainRoutingRefusal(message: string): string {
  if (message.includes("outside a preserve effect")) {
    return "That edit would have changed which Nets these objects belong to, so it was not applied. Connect them explicitly — end a wire on the conductor, or give both the same Net Label.";
  }
  if (message.includes("Routing merge did not join")) {
    return "The objects this edit should have connected did not end up on one Net, so it was not applied.";
  }
  if (message.includes("Routing partition retained")) {
    return "The conductor this edit should have cut is still whole, so it was not applied.";
  }
  if (message.includes("Routing removal retained")) {
    return "Something this edit should have removed is still connected, so it was not applied.";
  }
  return message;
}

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
    options: ConnectivityTransactionOptions = {},
  ): EditTransactionResult | null => {
    const proposal = createRoutingOperationPlan(document, {
      intent,
      edits,
      diagnostics: [],
      ...(options.expectedElectricalEffect
        ? { expectedElectricalEffect: options.expectedElectricalEffect }
        : {}),
    });
    const gate = gateRoutingOperationPlan(document, proposal, {
      ...(resolver ? { symbolResolver: resolver } : {}),
    });
    if (!gate.ok) {
      // Say which rule refused, the way applyResult does for direct edits:
      // the headline alone ("Transaction result failed Document validation")
      // names no field and leaves nothing to report or fix. The electrical
      // invariants speak in their own vocabulary, though, and a person who
      // just drew a wire cannot act on "outside a preserve effect" — those
      // are restated as what the editor refused to do to their circuit.
      const detail = gate.diagnostics[0]?.message;
      const raw =
        detail && detail !== gate.message
          ? `${gate.message} — ${detail}`
          : gate.message;
      setStatus(plainRoutingRefusal(raw));
      return null;
    }
    return transact([...gate.edits], options);
  };

  return { commitStructure, transact, transactConnectivity };
}
