/**
 * The session client: pairing (claim, resume, disconnect) over its layers,
 * session-transactions.ts, session-resources.ts and session-transport.ts.
 */
import { AgentSessionError } from "./errors.js";
import type { ClaimSuccess } from "./http-client.js";
import { bootstrapSummary, type BootstrapSummary } from "./snapshot-cache.js";
import { AgentSessionTransactions } from "./session-transactions.js";

export interface ConnectReport {
  mode: "claimed" | "resumed";
  projectId: string;
  documentIds: string[];
  tokenExpiresAt: number;
  capabilities: {
    operations: string[];
    editKinds: string[];
    permissions: Record<string, unknown>;
    limits: Record<string, number>;
  };
  context: BootstrapSummary | null;
  timing: {
    credentialMs: number;
    capabilitiesMs: number;
    bootstrapSnapshotMs: number;
    totalMs: number;
  };
}

/**
 * Unified Agent-side Helper (Agent rationale). Owns claim/resume, token and session
 * state, capabilities/revision caches, exact-payload request-ID retry, the
 * Snapshot cache, and sending high-level actions for the editor to plan.
 * Bearer tokens remain process-local and are sent only in Authorization
 * headers. A revocable connector credential may be persisted by M4 so a new
 * MCP process can resume without another claim-code hand-off.
 */
export class AgentSessionClient extends AgentSessionTransactions {
  /**
   * Pair or re-check the current session. With a claim code, redeem it and
   * replace prior local state. Without one, reuse the in-memory bearer or
   * resume the persisted connector.
   */
  async connect(claimCode?: string): Promise<ConnectReport> {
    const startedAt = this.now();
    if (claimCode === undefined || claimCode.trim() === "") {
      const resumed = await this.tryResume(startedAt);
      if (resumed === null) {
        const holder = this.connectorStore?.heldBy;
        throw new AgentSessionError(
          "CLAIM_REQUIRED",
          holder
            ? `another running MCP process (pid ${holder}) holds this origin's saved connector, so this one does not share its page; pass a claim code for a page of its own, or set ANALOG_CANVAS_MCP_CONNECTOR to one file to share a connector deliberately`
            : "no valid saved connector; pass a claim code from the editor's connect panel",
          "unrecoverable-credential",
        );
      }
      return resumed;
    }
    this.connection.apply("claim-started");
    try {
      const claim: ClaimSuccess = await this.http.claim(claimCode.trim());
      await this.workspaceBindingStore?.clear();
      this.http.workspaceId = undefined;
      this.boundWorkspace = null;
      this.cache.clear();
      this.knownRevisions.clear();
      this.receipts.length = 0;
      this.capabilitiesCache = null;
      this.simulationMetadata.clear();
      this.observation = null;
      this.session = this.activeSession(claim);
      await this.persistConnector(claim);
      return await this.establishContext(
        "claimed",
        startedAt,
        this.elapsedSince(startedAt),
      );
    } catch (error) {
      if (!this.session) this.connection.apply("reset");
      throw error;
    }
  }

  private async tryResume(startedAt: number): Promise<ConnectReport | null> {
    let stored = this.session;
    if (!stored || !this.tokenValid(stored)) {
      stored = await this.resumeConnector();
    }
    if (!stored) return null;
    this.connection.apply("resume-started");
    try {
      await this.status({ refresh: true });
      return await this.establishContext(
        "resumed",
        startedAt,
        this.elapsedSince(startedAt),
      );
    } catch (error) {
      if (
        error instanceof AgentSessionError &&
        error.category === "unrecoverable-credential"
      ) {
        await this.discardCredential(error.code);
      }
      throw error;
    }
  }

  private async establishContext(
    mode: "claimed" | "resumed",
    startedAt: number,
    credentialMs: number,
  ): Promise<ConnectReport> {
    const documentId = this.session?.documentIds[0];
    let capabilitiesMs = 0;
    let bootstrapSnapshotMs = 0;
    const capabilitiesTask = (async () => {
      const stageStartedAt = this.now();
      try {
        // A same-process resume can reuse the version-bound capability result.
        return await this.capabilities();
      } finally {
        capabilitiesMs = this.elapsedSince(stageStartedAt);
      }
    })();
    const contextTask = (async (): Promise<{
      context: BootstrapSummary | null;
      editorOffline: boolean;
    }> => {
      if (!documentId) return { context: null, editorOffline: false };
      const stageStartedAt = this.now();
      try {
        return {
          context: bootstrapSummary(await this.bootstrapSnapshot(documentId)),
          editorOffline: false,
        };
      } catch (error) {
        // An offline editor still leaves a paired, resumable session; the
        // host will see editor-offline through connection_status.
        if (
          error instanceof AgentSessionError &&
          (error.category === "editor-offline" || error.category === "network")
        ) {
          return { context: null, editorOffline: true };
        }
        throw error;
      } finally {
        bootstrapSnapshotMs = this.elapsedSince(stageStartedAt);
      }
    })();
    const [capabilities, contextResult] = await Promise.all([
      capabilitiesTask,
      contextTask,
    ]);
    const { context, editorOffline } = contextResult;
    if (!editorOffline) {
      this.connection.apply("request-succeeded");
    }
    return {
      mode,
      projectId: this.session?.projectId ?? "",
      documentIds: [...(this.session?.documentIds ?? [])],
      tokenExpiresAt: this.session?.tokenExpiresAt ?? 0,
      capabilities: {
        operations: [...capabilities.capabilities.operations],
        editKinds: [...capabilities.capabilities.editKinds],
        permissions: capabilities.capabilities.permissions as unknown as Record<
          string,
          unknown
        >,
        limits: capabilities.capabilities.limits as unknown as Record<
          string,
          number
        >,
      },
      context,
      timing: {
        credentialMs,
        capabilitiesMs,
        bootstrapSnapshotMs,
        totalMs: this.elapsedSince(startedAt),
      },
    };
  }

  private elapsedSince(startedAt: number): number {
    return Math.max(0, this.now() - startedAt);
  }

  /** Revoke the server session and forget the durable connector locally. */
  async disconnect(): Promise<void> {
    try {
      const session = await this.ensureSession();
      await this.http.disconnect(session.sessionId, session.agentToken);
    } finally {
      await this.discardCredential("DISCONNECTED");
      await this.workspaceBindingStore?.clear();
    }
  }
}
