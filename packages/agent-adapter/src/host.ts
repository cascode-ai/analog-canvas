/**
 * Frozen Agent operation host contract (WP-WA2). The in-browser Agent Host
 * (WP-WA3) implements this against the live `EditorDocumentController`, and the
 * Agent Circuit service dispatches `transact` through `dispatchTransaction`
 * instead of invoking the Edit Engine + a private commit path independently.
 *
 * Contract source: [`docs/specs/web-agent-session.md`](../../../docs/specs/web-agent-session.md)
 * "Browser host dispatch contract".
 */

import type {
  EditTransactionResult,
  ProjectTransaction,
  ProjectTransactionResult,
  SchematicEdit,
  ProjectStructureEdit,
} from "@icm/edit-engine";
import type { CircuitProject, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import type { AgentSemanticIntent, AgentAuthoringCommand } from "./schema.js";

export type AgentCommandPlan =
  | { edits: readonly SchematicEdit[] }
  | { structureEdits: readonly ProjectStructureEdit[] };

/** An Agent transaction submitted to the host. The actor is always an Agent. */
export interface AgentHostTransactionRequest {
  transactionId: string;
  documentId: string;
  expectedRevision: number;
  actor: { kind: "agent"; id: string };
  dryRun?: boolean;
  edits: readonly SchematicEdit[];
}

/** A browser-only, non-persisting request to expose Agent reasoning in the UI. */
export interface AgentHostSemanticIntentRequest {
  documentId: string;
  intent: AgentSemanticIntent;
}

/** Evidence returned after the live editor has accepted a semantic request. */
export type AgentHostSemanticIntentResult =
  | {
      ok: true;
      documentId: string;
      kind: AgentSemanticIntent["kind"];
      objectIds: readonly string[];
      netId?: string;
    }
  | { ok: false; code: string; message: string };

/**
 * What an Agent operation host exposes to the Agent Circuit service. `getDocument`
 * resolves a Document id to the live `SchematicDocument`; `getResolver`/`getProject`
 * supply the current resolver/Project at request time, never stale
 * construction-time state. `dispatchTransaction` is the only write path.
 */
export interface AgentOperationHost {
  /** Pure GUI/shared-planner adapter. It never commits or changes selection. */
  planAuthoringCommand?(
    documentId: string,
    command: AgentAuthoringCommand,
  ): AgentCommandPlan;
  getDocument(documentId: string): SchematicDocument | null;
  getProject?(): CircuitProject;
  getResolver(): SymbolResolver;
  dispatchTransaction(
    request: AgentHostTransactionRequest,
  ): EditTransactionResult;
  dispatchProjectTransaction?(
    request: ProjectTransaction,
  ): ProjectTransactionResult;
  /** Optional because loopback/in-process hosts deliberately have no GUI. */
  applySemanticIntent?(
    request: AgentHostSemanticIntentRequest,
  ): AgentHostSemanticIntentResult;
  /** Whether this host has a live UI adapter for semantic control. */
  semanticControlAvailable?(): boolean;
}
