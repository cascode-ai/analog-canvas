import type {
  AgentHostSemanticIntentRequest,
  AgentHostSemanticIntentResult,
  AgentHostTransactionRequest,
  AgentOperationHost,
  AgentAuthoringCommand,
  AgentCommandPlan,
} from "@icm/agent-adapter";
import {
  rejectTransaction,
  rejectProjectStructureTransaction,
  type EditTransactionResult,
  type ProjectTransaction,
  type ProjectTransactionResult,
} from "@icm/edit-engine";
import type { CircuitProject, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import type { EditorDocumentController } from "../document/document-controller";
import {
  planBrowserAgentCommand,
  type BrowserAgentPlanningContext,
} from "./browser-agent-command";

/**
 * Adapts a live {@link EditorDocumentController} to the
 * {@link AgentOperationHost} contract (Agent rationale). The Agent Circuit
 * service reads the current Project/resolver and dispatches Agent transactions
 * through the controller's single `dispatchTransaction` write path.
 *
 * `onTransactionCommitted` is invoked after a successful commit so the host
 * owner (the React hook in `App.tsx`) can synchronize UI state and stage
 * recovery — exactly as a human commit does. The commit also marks the
 * controller Agent-edited, which the Publish dialog notes beside the AI mark.
 *
 * This lets the full capabilities/snapshot/transact/render feature run
 * against the live browser document inside one process, with no network, token,
 * or Worker. The session transport is layered on top in WP-WA4/WP-WA5.
 */
export class BrowserAgentHost implements AgentOperationHost {
  planAuthoringCommand(
    documentId: string,
    command: AgentAuthoringCommand,
  ): AgentCommandPlan {
    this.assertBound();
    return planBrowserAgentCommand(
      this.controller.project,
      documentId,
      this.controller.resolver,
      command,
      this.planning,
    );
  }
  private readonly boundProjectSessionId: string;
  /** While {@link atomically} runs, commits wait for its end to be told. */
  private grouping = false;

  constructor(
    private readonly controller: EditorDocumentController,
    private readonly onTransactionCommitted?: () => void,
    private readonly onSemanticIntent?: (
      request: AgentHostSemanticIntentRequest,
    ) => AgentHostSemanticIntentResult,
    private readonly isAvailable: () => boolean = () => true,
    /** What the editor knows beyond the Project, such as its Process. */
    private readonly planning: BrowserAgentPlanningContext = {},
  ) {
    this.boundProjectSessionId = controller.projectSessionId;
  }

  getDocument(documentId: string): SchematicDocument | null {
    if (
      !this.isAvailable() ||
      this.controller.projectSessionId !== this.boundProjectSessionId
    ) {
      return null;
    }
    const document = this.controller.project.documents.find(
      (candidate) => candidate.id === documentId,
    );
    return document ?? null;
  }

  getProject(): CircuitProject {
    this.assertBound();
    return this.controller.project;
  }

  getResolver(): SymbolResolver {
    this.assertBound();
    return this.controller.resolver;
  }

  dispatchTransaction(
    request: AgentHostTransactionRequest,
  ): EditTransactionResult {
    if (
      !this.isAvailable() ||
      this.controller.projectSessionId !== this.boundProjectSessionId
    ) {
      return rejectTransaction(
        this.controller.document,
        "DOCUMENT_MISMATCH",
        "The Agent session is bound to a Project that has been replaced",
      );
    }
    const result = this.controller.dispatchTransaction(request);
    if (result.ok && result.applied) this.committed();
    return result;
  }

  /**
   * One Agent call's several transactions as one Undo step, or none of
   * them. The UI and recovery learn of the outcome once, at the end: a
   * rolled-back step was never seen.
   */
  atomically<T>(run: () => T, keep: (result: T) => boolean): T {
    this.assertBound();
    if (this.grouping) throw new Error("Agent history groups do not nest");
    const group = this.controller.beginHistoryGroup();
    this.grouping = true;
    let kept = false;
    try {
      const result = run();
      kept = keep(result);
      return result;
    } finally {
      this.grouping = false;
      if (this.controller.endHistoryGroup(group, kept)) this.committed();
    }
  }

  private committed(): void {
    if (this.grouping) return;
    this.controller.noteAgentEdit();
    this.onTransactionCommitted?.();
  }

  dispatchProjectTransaction(
    request: ProjectTransaction,
    documentId?: string,
  ): ProjectTransactionResult {
    if (
      !this.isAvailable() ||
      this.controller.projectSessionId !== this.boundProjectSessionId
    ) {
      return rejectProjectStructureTransaction(
        this.controller.project,
        "PROJECT_MISMATCH",
        "The Agent session is bound to a Project that has been replaced",
      );
    }
    const result = this.controller.dispatchProjectTransaction(
      request,
      undefined,
      documentId,
    );
    if (result.ok && result.applied) this.committed();
    return result;
  }

  /**
   * A whole-Project change the Agent's file and Project hosts planned and
   * validated against the current Project session, committed like a
   * transaction: one undo item, the commit callback, and the Agent mark.
   */
  commitProjectStructure(
    project: CircuitProject,
    activeDocumentId?: string,
  ): void {
    this.assertBound();
    this.controller.commitProjectStructure(project, activeDocumentId);
    this.committed();
  }

  applySemanticIntent(
    request: AgentHostSemanticIntentRequest,
  ): AgentHostSemanticIntentResult {
    if (
      !this.isAvailable() ||
      this.controller.projectSessionId !== this.boundProjectSessionId
    ) {
      return {
        ok: false,
        code: "DOCUMENT_MISMATCH",
        message:
          "The Agent session is bound to a Project that has been replaced",
      };
    }
    if (!this.getDocument(request.documentId)) {
      return {
        ok: false,
        code: "DOCUMENT_NOT_FOUND",
        message: `Document ${request.documentId} is not present in this Project`,
      };
    }
    if (!this.onSemanticIntent) {
      return {
        ok: false,
        code: "SEMANTIC_CONTROL_UNAVAILABLE",
        message: "The live editor has no semantic control adapter",
      };
    }
    return this.onSemanticIntent(request);
  }

  semanticControlAvailable(): boolean {
    return (
      this.isAvailable() &&
      this.controller.projectSessionId === this.boundProjectSessionId &&
      this.onSemanticIntent !== undefined
    );
  }

  private assertBound(): void {
    if (
      !this.isAvailable() ||
      this.controller.projectSessionId !== this.boundProjectSessionId
    ) {
      throw new Error("The Agent session Project has been replaced");
    }
  }
}
