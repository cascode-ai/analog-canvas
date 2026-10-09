/**
 * Writes over the session's reads: action lists for the editor to plan,
 * transactions with the revisions the helper supplies, and the receipts
 * they leave.
 */
import {
  AgentTransactionPayloadSchema,
  type AgentCircuitRequest,
} from "@icm/agent-adapter";
import { AgentSessionError } from "./errors.js";
import type { AgentRelayOperation } from "./http-client.js";
import { changedObjectIds, type CachedSnapshot } from "./snapshot-cache.js";
import { baseRequest, type KnownRevision } from "./session-transport.js";
import { AgentSessionResources } from "./session-resources.js";
import {
  refusedAction,
  schemaIssueText,
  withPlacementIds,
  type ApplyActionsReport,
  type PlacedPart,
} from "./session-receipts.js";

export abstract class AgentSessionTransactions extends AgentSessionResources {
  /**
   * Send high-level actions for the editor to plan and commit as one atomic
   * transaction, in a single request. The editor plans them against the
   * Document it holds. Target-resolving actions plan on its current state;
   * raw transactions, pass-through actions and undo/redo retain their revision
   * guards. A human edit does not universally imply STATE_CHANGED. A page too old to
   * plan them is asked to reload; nothing is sent.
   */
  async applyActions(
    actions: readonly unknown[],
    options: {
      documentId?: string;
      dryRunOnly?: boolean;
      diagnosticDeltaDetail?: "full" | "compact";
    } = {},
  ): Promise<ApplyActionsReport> {
    // A page that could not plan them may have been reloaded since: ask again.
    const plansActions = async (force: boolean) =>
      (
        await this.capabilities({ force })
      ).capabilities.transactionForms?.includes("actions") ?? false;
    if (!(await plansActions(false)) && !(await plansActions(true)))
      return {
        ok: false,
        stage: "compile",
        code: "EDITOR_OUTDATED",
        message:
          "The open editor page runs an older version that cannot plan action lists. Reload the editor page, then retry.",
      };
    const sent = withPlacementIds(actions);
    const report = await this.submitTransaction(
      await this.revisionFor(options.documentId),
      { actions: sent.actions },
      {
        dryRun: options.dryRunOnly ?? false,
        diagnosticDeltaDetail: options.diagnosticDeltaDetail ?? "full",
      },
    );
    if (report.ok && report.applied && !report.dryRun && sent.placed.length)
      report.placed = await this.namePlaced(sent.placed, report.documentId);
    return report;
  }

  /**
   * The names the editor gave parts placed without one, read back by ID in
   * one pins read per 64; a read that fails leaves them unnamed. A ground
   * never has a name, so it is not asked about.
   */
  private async namePlaced(
    placed: readonly PlacedPart[],
    documentId?: string,
  ): Promise<PlacedPart[]> {
    const unnamed = placed
      .filter(
        (part) => part.reference === undefined && part.symbol !== "ground",
      )
      .map((part) => part.id);
    const names = new Map<string, string>();
    for (let start = 0; start < unnamed.length; start += 64) {
      try {
        const read = await this.pinsSnapshot(
          unnamed.slice(start, start + 64),
          documentId,
        );
        for (const instance of read.instances) {
          const name = instance.reference ?? instance.cellTerminal?.name;
          if (name) names.set(instance.id, name);
        }
      } catch {
        break;
      }
    }
    return placed.map((part) => {
      const reference = part.reference ?? names.get(part.id);
      return reference === undefined ? { ...part } : { ...part, reference };
    });
  }

  /** Same four-operation API; the helper only supplies identity and revisions. */
  async advancedTransact(
    payload: unknown,
    options: {
      documentId?: string;
      dryRun?: boolean;
      expectedStructureRevision?: number;
      diagnosticDeltaDetail?: "full" | "compact";
      /** Reuse the snapshot read by this composed operation; commit still checks revisions. */
      snapshot?: CachedSnapshot;
    } = {},
  ): Promise<ApplyActionsReport> {
    const normalized = Array.isArray(payload) ? { edits: payload } : payload;
    const parsed = AgentTransactionPayloadSchema.safeParse(
      await this.withNestedRevisions(normalized),
    );
    if (!parsed.success)
      return {
        ok: false,
        stage: "compile",
        code: "EDIT_SCHEMA_INVALID",
        message: schemaIssueText(parsed.error.issues[0]),
      };
    const entry = options.snapshot
      ? this.revisionFromSnapshot(options.snapshot)
      : await this.revisionFor(options.documentId);
    if (
      options.snapshot &&
      (options.snapshot.dirty || entry.projectId !== this.session?.projectId)
    )
      return this.stateChangedReport(
        entry,
        "Snapshot is stale or belongs to another Project",
      );
    if (options.documentId && entry.documentId !== options.documentId)
      return this.stateChangedReport(
        entry,
        "Snapshot belongs to another Document",
      );
    if (
      options.expectedStructureRevision !== undefined &&
      entry.structureRevision !== options.expectedStructureRevision
    )
      return this.stateChangedReport(
        entry,
        "The Project changed after this edit was authored; read it and apply the edit again",
      );
    return this.submitTransaction(entry, parsed.data, options);
  }

  recentTransactions(): readonly ApplyActionsReport[] {
    return this.receipts.map((item) => structuredClone(item));
  }

  /**
   * The session's last answered requests from the relay, whichever process
   * made them (#1227): one CLI process per call never saw the others.
   */
  async relayActivity(): Promise<AgentRelayOperation[]> {
    const session = await this.ensureSession();
    return this.http.activity(session.sessionId, session.agentToken);
  }

  /**
   * A nested `transact_document` left without `expectedRevision` takes its
   * Document's current revision, as the top-level transaction does: the
   * helper supplies revisions, and the MCP schema does not describe nested
   * entries, so leaving it out used to fail with no field named.
   */
  private async withNestedRevisions(payload: unknown): Promise<unknown> {
    if (!payload || typeof payload !== "object") return payload;
    const structureEdits = (payload as { structureEdits?: unknown })
      .structureEdits;
    if (!Array.isArray(structureEdits)) return payload;
    const filled: unknown[] = [];
    for (const edit of structureEdits) {
      const entry = edit as {
        kind?: unknown;
        documentId?: unknown;
        expectedRevision?: unknown;
      } | null;
      filled.push(
        entry?.kind === "transact_document" &&
          entry.expectedRevision === undefined &&
          typeof entry.documentId === "string"
          ? {
              ...entry,
              expectedRevision: (await this.revisionFor(entry.documentId))
                .revision,
            }
          : edit,
      );
    }
    return { ...payload, structureEdits: filled };
  }

  private async revisionFor(documentId?: string): Promise<KnownRevision> {
    const target = await this.resolveDocumentId(documentId);
    const known = this.knownRevisions.get(target);
    if (
      known &&
      known.sessionId === this.session?.sessionId &&
      known.projectId === this.session.projectId &&
      known.contextRevision === this.http.contextRevision
    )
      return known;
    await this.bootstrapSnapshot(target);
    const refreshed = this.knownRevisions.get(target);
    if (!refreshed) {
      throw new AgentSessionError(
        "INVALID_RESPONSE",
        "bootstrap did not establish the selected Document revision",
        "request-rejected",
      );
    }
    return refreshed;
  }

  private revisionFromSnapshot(entry: CachedSnapshot): KnownRevision {
    return {
      documentId: entry.documentId,
      revision: entry.revision,
      structureRevision: entry.snapshot.project.structureRevision,
      projectId: entry.snapshot.project.id,
      sessionId: this.session?.sessionId ?? "",
      contextRevision: this.http.contextRevision,
    };
  }

  private async submitTransaction(
    entry: KnownRevision,
    payload: unknown,
    options: { dryRun?: boolean; diagnosticDeltaDetail?: "full" | "compact" },
  ): Promise<ApplyActionsReport> {
    const parsed = AgentTransactionPayloadSchema.safeParse(payload);
    if (!parsed.success)
      return {
        ok: false,
        stage: "compile",
        code: "EDIT_SCHEMA_INVALID",
        message: schemaIssueText(parsed.error.issues[0]),
      };
    const request = (dryRun: boolean): AgentCircuitRequest => ({
      ...baseRequest(this.newRequestId()),
      operation: "transact",
      documentId: entry.documentId,
      transactionId: `txn-${crypto.randomUUID()}`,
      expectedRevision: entry.revision,
      expectedStructureRevision: entry.structureRevision,
      dryRun,
      ...(options.diagnosticDeltaDetail === "compact"
        ? { diagnosticDeltaDetail: "compact" as const }
        : {}),
      ...parsed.data,
    });
    // One request, no client-side dry-run pass: the commit validates the
    // whole transaction atomically and returns the same diagnostics a
    // dry-run would, without the extra relayed round trip per edit.
    const submit = async (value: AgentCircuitRequest) => {
      try {
        return await this.send(value);
      } catch (error) {
        if (!options.dryRun) {
          // No authoritative receipt: the write may already be committed.
          // Retain the pairing and exact in-flight retry identity, but never
          // let the next operation reuse pre-write revisions. A command may
          // also have changed shared definitions/Project structure.
          this.cache.clear();
          this.knownRevisions.clear();
        }
        throw error;
      }
    };
    let response = await submit(request(options.dryRun ?? false));
    if (!response.ok) {
      if (
        response.error.code === "STALE_REVISION" ||
        response.error.code === "STALE_STRUCTURE_REVISION"
      )
        return {
          ...(await this.stateChangedReport(entry, response.error.message)),
          ...refusedAction(response.error),
        };
      if (
        response.error.code === "ACTION_COMPILE_FAILED" ||
        response.error.code === "ACTION_BATCH_NOT_ATOMIC"
      )
        // The editor refused the list while planning it: reported as when
        // the client compiles the list itself.
        return {
          ok: false,
          stage: "compile",
          code: response.error.code,
          message: response.error.message,
          ...refusedAction(response.error),
          ...(response.revision !== undefined
            ? { revision: response.revision }
            : {}),
          ...(response.error.transactions !== undefined
            ? { transactions: response.error.transactions }
            : {}),
          ...(response.error.calls ? { calls: response.error.calls } : {}),
        };
      return {
        ok: false,
        stage: "commit",
        code: response.error.code,
        message: response.error.message,
        diagnostics: response.diagnostics,
        ...(() => {
          // The editor names the refused action of a list it planned.
          if (response.error.actionIndex !== undefined)
            return refusedAction(response.error);
          const actionIndex = response.diagnostics.find(
            (item) => typeof item.parameters?.actionIndex === "number",
          )?.parameters?.actionIndex;
          return typeof actionIndex === "number" ? { actionIndex } : {};
        })(),
        revision: entry.revision,
        requestId: response.requestId,
      };
    }
    if (response.operation !== "transact")
      return {
        ok: false,
        stage: "commit",
        code: "INVALID_RESPONSE",
        message: "Expected a transact response",
      };
    if (response.applied) {
      if (response.projectStructure?.documentIds)
        this.updateDocumentRoster(
          response.projectStructure.documentIds,
          response.projectStructure.topDocumentId,
        );
      if (response.projectStructure) {
        this.cache.clear();
        this.knownRevisions.clear();
      } else {
        this.cache.markDirty(entry.documentId, response.revision);
        if (
          entry.sessionId === this.session?.sessionId &&
          entry.contextRevision === this.http.contextRevision
        ) {
          this.rememberRevision({
            documentId: entry.documentId,
            revision: response.revision,
            structureRevision: entry.structureRevision,
            projectId: entry.projectId,
          });
        }
      }
    }
    // Mid-drawing, nearly every error is a pin not wired yet (#1301): say how
    // many, so the errors that are something else stand out.
    const unwiredPins = response.diagnostics.filter(
      (item) => item.code === "MISSING_PIN_NET",
    ).length;
    // A change to the Project's structure alone, such as a new Cell, leaves
    // the open Cell as it was: its findings are not this change's. A new
    // Cell's receipt read as three errors of an unrelated Cell. A Project
    // transaction that edits a Cell (placing a Cell Pin) keeps them.
    const structureOnly =
      response.diff.editKinds.length > 0 &&
      response.diff.editKinds.every(
        (kind) =>
          kind.startsWith("project:") && kind !== "project:transact_document",
      );
    const report: ApplyActionsReport = {
      ok: true,
      stage: "done",
      projectId: entry.projectId,
      workspaceId: this.workspaceId,
      documentId: response.diff.documentId,
      transactions: 1,
      revision: response.revision,
      applied: response.applied,
      requestId: response.requestId,
      proposedRevision: response.proposedRevision,
      dryRun: options.dryRun ?? false,
      changedObjectIds: response.diff.changedObjectIds,
      ...(response.terminalConnectivityChanged !== undefined
        ? { terminalConnectivityChanged: response.terminalConnectivityChanged }
        : {}),
      editKinds: response.diff.editKinds,
      ...(structureOnly
        ? {}
        : {
            diagnostics: response.diagnostics,
            errors: response.diagnostics.filter(
              (item) => item.severity === "error",
            ).length,
            ...(unwiredPins ? { unwiredPins } : {}),
            warnings: response.diagnostics.filter(
              (item) => item.severity === "warning",
            ).length,
          }),
      ...(response.diagnosticDelta
        ? { diagnosticDelta: response.diagnosticDelta }
        : {}),
      ...(response.projectStructure
        ? { projectStructure: response.projectStructure }
        : {}),
      ...(response.semantic ? { semantic: response.semantic } : {}),
      ...(response.resolvedRoutes
        ? { resolvedRoutes: response.resolvedRoutes }
        : {}),
    };
    if (!options.dryRun) {
      this.receipts.push(report);
      if (this.receipts.length > 32) this.receipts.shift();
    }
    return report;
  }
  private async stateChangedReport(
    entry: KnownRevision,
    message: string,
  ): Promise<ApplyActionsReport> {
    const before = this.cache.get(entry.documentId);
    const fresh = await this.refreshSnapshot(entry.documentId);
    return {
      ok: false,
      stage: "commit",
      code: "STATE_CHANGED",
      message:
        message ??
        "the document revision changed; re-inspect the affected objects and retry",
      revision: fresh.revision,
      changedObjectIds:
        before && !before.dirty && before.revision === entry.revision
          ? changedObjectIds(before.snapshot, fresh.snapshot)
          : [],
    };
  }
}
