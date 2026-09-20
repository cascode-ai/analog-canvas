import { prepareExecutionInput } from "./prepare-input.js";
import type { CircuitProject } from "@icm/model";
import { readSimulationExperimentConfig } from "@icm/model";
import { simulationAnalysisToCsv } from "@icm/spice-run";
import { nativeAuthoringHelp } from "@icm/netlist";
import { simulationLanguageHelp, NGSPICE_LANGUAGE_REFERENCE } from "@icm/spice";
import { profileEngine } from "./profile-engine.js";
import {
  SimulationOperationSchema,
  problem,
  type ArtifactRef,
  type Prepared,
  type SimulationBatch,
  type SimulationOperation,
} from "./contract.js";
import { SimulationFiles } from "./files.js";
import { simulationSpecReport, simulationSpecsToCsv } from "./spec-results.js";
import { vacaskMeasurementResults } from "./vacask-measurements.js";
import { ngspiceMeasurementResults } from "./ngspice-measurements.js";
import { executionArtifactEntries } from "./execution-artifacts.js";
import { resultCatalog } from "./result-catalog.js";

import {
  ExecutionFailure,
  validateExecutionOutput,
  type ExecutionInput,
  type Executor,
} from "./executor.js";
import { runReceipt } from "./run-receipt.js";
import { ProjectInputIdentity } from "./input-identity.js";
import { type Run, type SimulationReply } from "./contract.js";
type PrepareSource = Extract<
  SimulationOperation,
  { operation: "prepare" }
>["source"];
type InternalRun = {
  view: Run;
  engine: "ngspice" | "vacask";
  prepared: Prepared;
  token: string;
  done: Promise<void>;
  source: PrepareSource;
};
type StoredPrepared = {
  view: Prepared;
  input: ExecutionInput;
  source: PrepareSource;
};
type BatchPrepareItem = {
  id: string;
  folderId: string;
  label?: string;
  source: PrepareSource;
};
type InternalBatch = {
  view: SimulationBatch;
  cancelled: boolean;
  done: Promise<void>;
};
const TTL = 15 * 60_000;
/** One live session owns this service. UI visibility has no effect on execution. */
export class SimulationService {
  private prepared = new Map<string, StoredPrepared>();
  private runs = new Map<string, InternalRun>();
  private starts = new Map<string, { key: string; runId: string }>();
  private batches = new Map<string, InternalBatch>();
  private batchStarts = new Map<string, { key: string; batchId: string }>();
  private epoch = 0;
  private inputIdentity = new ProjectInputIdentity();
  constructor(
    readonly files: SimulationFiles,
    private executor: Executor,
    private getProject: () => CircuitProject,
    private now: () => number = Date.now,
  ) {}
  async clear() {
    this.epoch++;
    this.inputIdentity.clear();
    const active = [...this.runs.values()].filter(
      (r) => r.view.state === "running" || r.view.state === "cancelling",
    );
    this.prepared.clear();
    this.runs.clear();
    this.starts.clear();
    this.batches.clear();
    this.batchStarts.clear();
    // Draft/artifact teardown belongs to the File Resource owner.
    await Promise.allSettled(
      active.map((r) =>
        this.executor.cancel(r.token, r.prepared.environment.profileId),
      ),
    );
  }
  async handle(request: unknown, requestId: string): Promise<SimulationReply> {
    const parsed = SimulationOperationSchema.safeParse(request);
    if (!parsed.success)
      return problem(
        "SIMULATION_REQUEST_INVALID",
        parsed.error.issues[0]?.message ?? "Invalid request",
        "input",
      );
    const op = parsed.data;
    try {
      if (op.operation === "authoring-help") {
        let engine: "ngspice" | "vacask" = "vacask";
        if (op.profileId) {
          const caps = await this.executor.capabilities(op.profileId);
          const profile = caps.profiles.find((p) => p.id === op.profileId);
          const selected =
            profile && profileEngine(profile, caps.rawfileCollection);
          if (!selected)
            return problem(
              "SIMULATION_PROFILE_UNKNOWN",
              "Select an advertised Profile for authoring help",
              "input",
            );
          engine = selected;
        }
        const helpers =
          engine === "vacask"
            ? nativeAuthoringHelp(op)
            : simulationLanguageHelp
                .filter((h) => h.context === "deck" || h.context === "control")
                .filter(
                  (h) =>
                    (!op.name || h.name === op.name) &&
                    (!op.context ||
                      h.context ===
                        (op.context === "circuit" ? "deck" : "control")),
                )
                .map((h) => ({
                  name: h.name,
                  context:
                    h.context === "deck"
                      ? ("circuit" as const)
                      : ("control" as const),
                  signature: h.signature,
                  summary: h.summary,
                  reference: `${NGSPICE_LANGUAGE_REFERENCE}#${h.section}`,
                  source: h.signature,
                }));
        return op.name && !helpers.length
          ? problem(
              "SIMULATION_HELPER_NOT_FOUND",
              "No matching helper; omit name to list available native helpers. This catalogue is not an execution allow-list.",
              "read",
            )
          : { ok: true, helpers };
      }
      this.prune();
      if (op.operation === "history") {
        try {
          return {
            ok: true,
            ...(await this.files.history(op.limit, op.cursor)),
          };
        } catch (error) {
          const invalidCursor =
            error instanceof Error &&
            error.message === "HISTORY_CURSOR_UNAVAILABLE";
          return problem(
            invalidCursor
              ? "HISTORY_CURSOR_UNAVAILABLE"
              : "RUN_HISTORY_UNAVAILABLE",
            "Retained run directory could not be read; no simulation was started",
            "read",
            invalidCursor ? "fix-input" : "retry-after",
          );
        }
      }
      if (op.operation === "capabilities")
        return {
          ok: true,
          capabilities: {
            ...(await this.executor.capabilities()),
            inputs: ["source"],
            maxActiveRuns: 1,
            batch: {
              maxItems: 16,
              execution: "sequential",
              sweepAxes: ["corner", "temperature", "variable", "parameter"],
            },
          },
        };
      if (op.operation === "prepare") return await this.prepare(op);
      if (op.operation === "start") return this.start(op, requestId);
      if (op.operation === "prepare-batch") return await this.prepareBatch(op);
      if (op.operation === "prepare-sweep") return await this.prepareSweep(op);
      if (op.operation === "start-batch") return this.startBatch(op, requestId);
      if (op.operation === "read-batch" || op.operation === "cancel-batch")
        return await this.accessBatch(op);
      if (
        op.operation === "read" ||
        op.operation === "cancel" ||
        op.operation === "catalog"
      ) {
        const run = this.runs.get(op.runId);
        if (!run && (op.operation === "catalog" || op.operation === "read")) {
          const catalog = await this.files.catalog(op.runId);
          if (catalog) {
            if (op.operation === "catalog") return { ok: true, catalog };
            return {
              ok: true,
              run: {
                id: catalog.runId,
                preparedId: catalog.preparedId,
                inputRevision: catalog.inputRevision,
                state:
                  catalog.execution === "cancelled" ||
                  catalog.execution === "lost"
                    ? catalog.execution
                    : "finished",
                artifacts: catalog.files,
                catalog,
                ...(catalog.error ? { error: catalog.error } : {}),
                inputStatus: "unavailable",
                resultPreview: true,
              },
            };
          }
        }
        if (!run)
          return problem(
            "RUN_STATE_LOST",
            "No run with this ID remains in this session. It has not been restarted.",
            "read",
            "not-retryable",
          );
        if (op.operation === "catalog")
          return {
            ok: true,
            catalog: structuredClone(
              run.view.catalog ??
                resultCatalog(run.view, "pending", run.prepared.signalTargets),
            ),
          };
        if (
          op.operation === "cancel" &&
          ["running", "cancelling", "lost"].includes(run.view.state)
        ) {
          if (run.view.state !== "lost") run.view.state = "cancelling";
          await this.executor.cancel(
            run.token,
            run.prepared.environment.profileId,
          );
          // Executor acknowledgement means termination requested; only completion confirms cleanup.
        }
        if (op.operation === "read") {
          if (run.source.kind === "workspace") {
            const snapshot = this.files.snapshot(
              run.source.workspaceId,
              run.source.expectedRevision,
            );
            run.view.inputStatus = snapshot.ok
              ? "unchanged"
              : snapshot.error.code === "WORKSPACE_REVISION_CONFLICT"
                ? "changed"
                : "unavailable";
          } else {
            const revision = await this.inputIdentity.read(
              this.getProject(),
              run.source.folderId,
              run.source.variant,
              run.engine,
            );
            run.view.inputStatus =
              revision === null
                ? "unavailable"
                : revision === run.view.inputRevision
                  ? "unchanged"
                  : "changed";
          }
        }
        return { ok: true, run: runReceipt(run.view) };
      }
      if ((op.preparedId ? 1 : 0) + (op.runId ? 1 : 0) !== 1)
        return problem(
          "ARTIFACT_TARGET_REQUIRED",
          "Select one prepared input or one run",
          "export",
        );
      const artifacts = op.runId
        ? this.runs.get(op.runId)?.view.artifacts
        : this.prepared.get(op.preparedId!)?.view.artifacts;
      return artifacts
        ? { ok: true, artifacts: [...artifacts] }
        : problem(
            "ARTIFACT_UNAVAILABLE",
            "Input/run is unavailable in this session",
            "export",
            "not-retryable",
          );
    } catch (error) {
      if (error instanceof ExecutionFailure)
        return { ok: false, error: error.problem };
      return {
        ok: false,
        error: {
          code: "INTERNAL_ERROR",
          message:
            "This operation failed; the session and authored input remain available.",
          stage:
            op.operation === "capabilities" ||
            op.operation === "authoring-help" ||
            op.operation === "history" ||
            op.operation === "catalog"
              ? "read"
              : op.operation === "prepare-batch"
                ? "prepare"
                : op.operation === "prepare-sweep"
                  ? "prepare"
                  : op.operation === "start-batch"
                    ? "start"
                    : op.operation === "read-batch"
                      ? "read"
                      : op.operation === "cancel-batch"
                        ? "cancel"
                        : op.operation,
          recovery: "not-retryable",
          correlationId: crypto.randomUUID(),
        },
      };
    }
  }
  private prune() {
    const now = this.now();
    const pinned = new Set(
      [...this.batches.values()]
        .filter((batch) => ["running", "cancelling"].includes(batch.view.state))
        .flatMap((batch) => batch.view.items.map((item) => item.prepared.id)),
    );
    for (const [id, p] of this.prepared)
      if (p.view.expiresAt <= now && !pinned.has(id)) this.prepared.delete(id);
    for (const [id, batch] of this.batches)
      if (
        batch.view.expiresAt !== null &&
        batch.view.expiresAt <= now &&
        batch.view.state === "prepared"
      )
        this.batches.delete(id);
    // Only unused execution preparations expire. Finished receipts and their
    // request identities survive for this host lifetime; evidence has its own storage.
  }
  private async prepareBatch(
    op: Extract<SimulationOperation, { operation: "prepare-batch" }>,
  ): Promise<SimulationReply> {
    return this.prepareBatchItems(
      op.items.map((item) => ({
        ...item,
        source: {
          kind: "project-folder" as const,
          folderId: item.folderId,
          expectedStructureRevision: op.expectedStructureRevision,
        },
      })),
    );
  }

  private async prepareSweep(
    op: Extract<SimulationOperation, { operation: "prepare-sweep" }>,
  ): Promise<SimulationReply> {
    const folder = this.getProject().simulationFolders.find(
      ({ id }) => id === op.folderId,
    );
    const config = folder ? readSimulationExperimentConfig(folder) : undefined;
    const variableNames = new Map(
      config?.ok
        ? config.config.variables.map(({ id, name }) => [id, name])
        : [],
    );
    type Variant = NonNullable<
      Extract<PrepareSource, { kind: "project-folder" }>["variant"]
    >;
    let variants: Array<{ label: string[]; variant: Variant }> = [
      { label: [], variant: { parameters: [] } },
    ];
    for (const axis of op.axes) {
      variants = variants.flatMap((existing) =>
        axis.values.map((value) => {
          if (axis.kind === "corner") {
            return {
              label: [...existing.label, `corner=${value}`],
              variant: {
                ...existing.variant,
                environment: {
                  ...existing.variant.environment,
                  corner: value as string,
                },
              },
            };
          }
          if (axis.kind === "temperature") {
            return {
              label: [...existing.label, `temp=${value}C`],
              variant: {
                ...existing.variant,
                environment: {
                  ...existing.variant.environment,
                  temperatureC: value as number,
                },
              },
            };
          }
          if (axis.kind === "variable") {
            return {
              label: [
                ...existing.label,
                `${variableNames.get(axis.variableId) ?? axis.variableId}=${value}`,
              ],
              variant: {
                ...existing.variant,
                variables: [
                  ...(existing.variant.variables ?? []),
                  { variableId: axis.variableId, value: value as string },
                ],
              },
            };
          }
          return {
            label: [
              ...existing.label,
              `${axis.instanceId}.${axis.parameter}=${value}`,
            ],
            variant: {
              ...existing.variant,
              parameters: [
                ...(existing.variant.parameters ?? []),
                {
                  documentId: axis.documentId,
                  instanceId: axis.instanceId,
                  parameter: axis.parameter,
                  value: value as string,
                },
              ],
            },
          };
        }),
      );
    }
    return this.prepareBatchItems(
      variants.map(({ label, variant }, index) => ({
        id: `sweep-${index + 1}`,
        folderId: op.folderId,
        label: label.join(", "),
        source: {
          kind: "project-folder" as const,
          folderId: op.folderId,
          expectedStructureRevision: op.expectedStructureRevision,
          variant,
        },
      })),
    );
  }

  private async prepareBatchItems(
    requestedItems: readonly BatchPrepareItem[],
  ): Promise<SimulationReply> {
    if (
      [...this.runs.values()].some((run) =>
        ["running", "cancelling"].includes(run.view.state),
      ) ||
      [...this.batches.values()].some((batch) =>
        ["running", "cancelling"].includes(batch.view.state),
      )
    ) {
      return {
        ok: false,
        error: {
          code: "SIMULATOR_BUSY",
          message: "This session already has an active run or batch",
          stage: "prepare",
          recovery: "retry-after",
          retryAfterMs: 1000,
        },
      };
    }
    const preparedIds: string[] = [];
    const items: SimulationBatch["items"] = [];
    for (const item of requestedItems) {
      const reply = await this.prepare({
        operation: "prepare",
        source: item.source,
      });
      if (!reply.ok || !("prepared" in reply)) {
        for (const preparedId of preparedIds) this.prepared.delete(preparedId);
        return reply;
      }
      preparedIds.push(reply.prepared.id);
      items.push({
        id: item.id,
        folderId: item.folderId,
        ...(item.label ? { label: item.label } : {}),
        prepared: structuredClone(reply.prepared),
        state: "prepared",
      });
    }
    const createdAt = this.now();
    const view: SimulationBatch = {
      id: crypto.randomUUID(),
      state: "prepared",
      createdAt,
      expiresAt: createdAt + TTL,
      items,
    };
    this.batches.set(view.id, {
      view,
      cancelled: false,
      done: Promise.resolve(),
    });
    return { ok: true, batch: structuredClone(view) };
  }
  private startBatch(
    op: Extract<SimulationOperation, { operation: "start-batch" }>,
    requestId: string,
  ): SimulationReply {
    const key = JSON.stringify([op.batchId, op.timeoutMs ?? null]);
    const old = this.batchStarts.get(requestId);
    if (old) {
      if (old.key !== key)
        return problem(
          "REQUEST_ID_REUSED",
          "This request ID already identifies a different batch start",
          "start",
        );
      const existing = this.batches.get(old.batchId);
      return existing
        ? { ok: true, batch: structuredClone(existing.view) }
        : problem(
            "BATCH_STATE_LOST",
            "The earlier batch is unavailable and was not restarted",
            "start",
            "not-retryable",
          );
    }
    const batch = this.batches.get(op.batchId);
    if (!batch)
      return problem(
        "BATCH_STATE_LOST",
        "Prepare the batch again; it is unavailable in this session",
        "start",
        "reprepare",
      );
    if (batch.view.state !== "prepared")
      return problem(
        "BATCH_ALREADY_STARTED",
        "This batch has already started; read it using its existing id",
        "start",
        "not-retryable",
      );
    if (
      [...this.runs.values()].some((run) =>
        ["running", "cancelling"].includes(run.view.state),
      ) ||
      [...this.batches.values()].some(
        (candidate) =>
          candidate !== batch &&
          ["running", "cancelling"].includes(candidate.view.state),
      )
    ) {
      return {
        ok: false,
        error: {
          code: "SIMULATOR_BUSY",
          message: "This session already has an active run",
          stage: "start",
          recovery: "retry-after",
          retryAfterMs: 1000,
        },
      };
    }
    this.batchStarts.set(requestId, { key, batchId: batch.view.id });
    batch.view.state = "running";
    for (const item of batch.view.items) item.state = "queued";
    const epoch = this.epoch;
    batch.done = this.executeBatch(batch, op.timeoutMs, requestId, epoch);
    return { ok: true, batch: structuredClone(batch.view) };
  }
  private async executeBatch(
    batch: InternalBatch,
    timeoutMs: number | undefined,
    requestId: string,
    epoch: number,
  ): Promise<void> {
    for (const item of batch.view.items) {
      if (epoch !== this.epoch) return;
      if (batch.cancelled) {
        item.state = "cancelled";
        continue;
      }
      const reply = this.start(
        {
          operation: "start",
          preparedId: item.prepared.id,
          digest: item.prepared.digest,
          ...(timeoutMs === undefined ? {} : { timeoutMs }),
        },
        `${requestId}:${batch.view.id}:${item.id}`,
        batch.view.id,
      );
      if (!reply.ok || !("run" in reply)) {
        item.state = "failed";
        item.error = reply.ok
          ? {
              code: "BATCH_RUN_UNAVAILABLE",
              message: "Batch member did not create a run",
              stage: "start",
              recovery: "not-retryable",
            }
          : reply.error;
        continue;
      }
      item.runId = reply.run.id;
      item.state = "running";
      const run = this.runs.get(reply.run.id);
      await run?.done;
      if (!run) {
        item.state = "lost";
        continue;
      }
      item.error = run.view.error;
      item.state =
        run.view.state === "cancelled"
          ? "cancelled"
          : run.view.state === "lost"
            ? "lost"
            : run.view.error
              ? "failed"
              : "finished";
    }
    if (epoch !== this.epoch) return;
    batch.view.state = batch.cancelled
      ? "cancelled"
      : batch.view.items.some((item) => ["failed", "lost"].includes(item.state))
        ? "failed"
        : "finished";
    batch.view.expiresAt = null;
  }
  private async accessBatch(
    op: Extract<
      SimulationOperation,
      { operation: "read-batch" | "cancel-batch" }
    >,
  ): Promise<SimulationReply> {
    const batch = this.batches.get(op.batchId);
    if (!batch)
      return problem(
        "BATCH_STATE_LOST",
        "No batch with this ID remains in this session",
        "read",
        "not-retryable",
      );
    if (
      op.operation === "cancel-batch" &&
      ["prepared", "running", "cancelling"].includes(batch.view.state)
    ) {
      batch.cancelled = true;
      batch.view.state = "cancelling";
      for (const item of batch.view.items) {
        if (item.state === "prepared" || item.state === "queued")
          item.state = "cancelled";
      }
      const running = batch.view.items.find(
        (item) => item.state === "running" && item.runId,
      );
      if (running?.runId) {
        const run = this.runs.get(running.runId);
        if (run && ["running", "cancelling", "lost"].includes(run.view.state)) {
          if (run.view.state !== "lost") run.view.state = "cancelling";
          await this.executor.cancel(
            run.token,
            run.prepared.environment.profileId,
          );
        }
      } else {
        batch.view.state = "cancelled";
        batch.view.expiresAt = null;
      }
    }
    return { ok: true, batch: structuredClone(batch.view) };
  }
  private async prepare(
    op: Extract<SimulationOperation, { operation: "prepare" }>,
  ): Promise<SimulationReply> {
    if (this.prepared.size >= 32)
      return problem(
        "PREPARED_LIMIT",
        "Prepared input capacity reached; expired entries are removed automatically",
        "prepare",
        "retry-after",
      );
    const epoch = this.epoch;
    const caps = await this.executor.capabilities();
    if (!caps.configured)
      return problem(
        "simulation-not-configured",
        "Configure an execution environment to run simulations; authored input remains available.",
        "prepare",
        "retry-after",
      );
    const preparation = await prepareExecutionInput(
      op,
      caps,
      this.getProject,
      this.files,
      (profileId) => this.executor.capabilities(profileId),
    );
    if (!preparation.ok) return preparation;
    const {
      input,
      vectors,
      outputs,
      deviceOperatingPoints,
      measurements,
      warnings,
      digest,
    } = preparation;
    if (epoch !== this.epoch)
      return problem(
        "SESSION_CHANGED",
        "Session changed during preparation",
        "prepare",
        "reauthorize",
      );
    const artifacts: ArtifactRef[] = [];
    artifacts.push(
      await this.publishArtifact(
        epoch,
        "prepared.cir",
        "text/plain",
        input.preparedDeck,
        { role: "prepared" },
      ),
    );
    for (const f of input.files)
      artifacts.push(
        await this.publishArtifact(epoch, f.path, "text/plain", f.text, {
          role: "source",
          sourcePath: f.path,
        }),
      );
    artifacts.push(
      await this.publishArtifact(
        epoch,
        "source-map.json",
        "application/json",
        JSON.stringify(preparation.sourceMaps, null, 2),
        { role: "source-map" },
      ),
    );
    artifacts.push(
      await this.publishArtifact(
        epoch,
        "prepared.json",
        "application/json",
        JSON.stringify(input, null, 2),
        { role: "execution-input" },
      ),
    );
    if (epoch !== this.epoch)
      return problem(
        "SESSION_CHANGED",
        "Session ended during preparation",
        "prepare",
        "reauthorize",
      );
    const view: Prepared = {
      id: crypto.randomUUID(),
      digest,
      inputRevision: input.inputRevision,
      expiresAt: this.now() + TTL,
      mode: "source",
      environment: input.environment,
      vectors,
      signalNames: preparation.signalNames,
      signalTargets: preparation.signalTargets,
      outputs,
      deviceOperatingPoints,
      measurements,
      artifacts,
      warnings,
    };
    this.prepared.set(view.id, {
      input: structuredClone(input),
      view,
      source: structuredClone(op.source),
    });
    return { ok: true, prepared: structuredClone(view) };
  }
  private start(
    op: Extract<SimulationOperation, { operation: "start" }>,
    requestId: string,
    owningBatchId?: string,
  ): SimulationReply {
    const key = JSON.stringify([
      op.preparedId,
      op.digest,
      op.timeoutMs ?? null,
    ]);
    const old = this.starts.get(requestId);
    if (old) {
      if (old.key !== key)
        return problem(
          "REQUEST_ID_REUSED",
          "This request ID already identifies a different start",
          "start",
        );
      const run = this.runs.get(old.runId);
      return run
        ? { ok: true, run: runReceipt(run.view) }
        : problem(
            "RUN_STATE_LOST",
            "The earlier run is unavailable and was not restarted",
            "start",
            "not-retryable",
          );
    }
    if (this.starts.size >= 256)
      return problem(
        "RUN_LIMIT",
        "Session run history limit reached; open a new session",
        "start",
        "reauthorize",
      );
    const prepared = this.prepared.get(op.preparedId);
    if (!prepared || prepared.view.digest !== op.digest)
      return problem(
        "PREPARED_INPUT_UNAVAILABLE",
        "Prepare again; this input is expired or its digest differs",
        "start",
        "reprepare",
      );
    if (
      [...this.runs.values()].some((r) =>
        ["running", "cancelling"].includes(r.view.state),
      ) ||
      [...this.batches.values()].some(
        (batch) =>
          batch.view.id !== owningBatchId &&
          ["running", "cancelling"].includes(batch.view.state),
      )
    )
      return {
        ok: false,
        error: {
          code: "SIMULATOR_BUSY",
          message: "This session already has an active run",
          stage: "start",
          recovery: "retry-after",
          retryAfterMs: 1000,
        },
      };
    const view: Run = {
      id: crypto.randomUUID(),
      preparedId: prepared.view.id,
      inputRevision: prepared.view.inputRevision,
      state: "running",
      artifacts: [...prepared.view.artifacts],
    };
    const entry: InternalRun = {
      view,
      engine: prepared.input.language === "vacask" ? "vacask" : "ngspice",
      prepared: structuredClone(prepared.view),
      token: crypto.randomUUID(),
      done: Promise.resolve(),
      source: prepared.source,
    };
    this.runs.set(view.id, entry);
    this.starts.set(requestId, { key, runId: view.id });
    const epoch = this.epoch;
    entry.done = this.execute(
      entry,
      structuredClone(prepared.input),
      op.timeoutMs,
      epoch,
    );
    return { ok: true, run: structuredClone(view) };
  }
  private async execute(
    run: InternalRun,
    input: ExecutionInput,
    timeoutMs: number | undefined,
    epoch: number,
  ) {
    let collectionStatus: "complete" | "partial" = "complete";
    let terminalState: Run["state"] = "finished";
    try {
      const output = validateExecutionOutput(
        input,
        await this.executor.execute(input, run.token, timeoutMs, {
          preparedId: run.prepared.id,
          preparedDigest: run.prepared.digest,
        }),
      );
      if (epoch !== this.epoch) return;
      run.view.result = output.result;
      collectionStatus = output.collectionStatus ?? "complete";
      const nativeReports =
        output.result.metadata.environment.simulator.name === "vacask"
          ? vacaskMeasurementResults(
              output.result.log,
              output.result.outcome.status !== "completed-with-dropped-input",
            )
          : {
              measurements: ngspiceMeasurementResults(
                input.files,
                input.entryPath ?? "run.cir",
                output.result.log,
              ),
              diagnostics: [],
            };
      const nativeMeasurements = nativeReports.measurements;
      const specs = simulationSpecReport(
        input.files,
        input.entryPath ?? "run.cir",
        nativeMeasurements,
        {
          runId: run.view.id,
          preparedId: run.prepared.id,
          inputDigest: run.prepared.digest,
        },
        output.result.outcome.status === "completed" && !output.cancelled,
      );
      // Raw numeric data lives in result.data. Keep legacy output fields readable
      // for archives, but never produce a second waveform or automatic metrics.
      run.view.outputData = {
        schemaVersion: 1,
        analyses: [],
        diagnostics: nativeReports.diagnostics,
        specs,
      };
      const artifact = async (
        name: string,
        type: string,
        text: string,
        metadata: Pick<ArtifactRef, "role" | "sourcePath" | "analysisIndex">,
      ) =>
        run.view.artifacts.push(
          await this.publishArtifact(epoch, name, type, text, metadata),
        );
      await artifact("log.txt", "text/plain", output.result.log, {
        role: "log",
      });
      await artifact("specs.json", "application/json", JSON.stringify(specs), {
        role: "specs",
      });
      await artifact("specs.csv", "text/csv", simulationSpecsToCsv(specs), {
        role: "specs",
      });
      if (output.rawfile !== undefined)
        await artifact("out.raw", "text/plain", output.rawfile, {
          role: "raw",
        });
      if (output.executedDeck !== undefined)
        await artifact("executed.cir", "text/plain", output.executedDeck, {
          role: "executed",
        });
      const nativeArtifacts: {
        kind: "raw" | "executed";
        path: string;
        artifact: ArtifactRef;
      }[] = [];
      for (const item of executionArtifactEntries(output)) {
        const ref = await this.publishArtifact(
          epoch,
          item.name,
          "text/plain",
          item.text,
          { role: item.kind, sourcePath: item.path },
        );
        run.view.artifacts.push(ref);
        nativeArtifacts.push({
          kind: item.kind,
          path: item.path,
          artifact: ref,
        });
      }
      await artifact(
        "result.json",
        "application/json",
        JSON.stringify(output.result),
        { role: "result" },
      );
      for (const [i, analysis] of (
        output.result.data?.analyses ?? []
      ).entries())
        await artifact(
          analysis.analysis + "-" + i + ".csv",
          "text/csv",
          simulationAnalysisToCsv(analysis),
          { role: "table", analysisIndex: i },
        );
      const catalog = resultCatalog(
        { ...run.view, state: output.cancelled ? "cancelled" : "finished" },
        collectionStatus,
        run.prepared.signalTargets,
      );
      const evidenceArtifacts = run.view.artifacts.map((item) => ({ ...item }));
      await artifact(
        "evidence-manifest.json",
        "application/json",
        JSON.stringify(
          {
            schemaVersion: 1,
            run: {
              id: run.view.id,
              preparedId: run.view.preparedId,
              inputRevision: run.view.inputRevision,
            },
            prepared: {
              digest: run.prepared.digest,
              mode: run.prepared.mode,
              environment: run.prepared.environment,
              vectors: run.prepared.vectors,
              signalNames: run.prepared.signalNames,
              signalTargets: run.prepared.signalTargets,
              outputs: run.prepared.outputs,
              deviceOperatingPoints: run.prepared.deviceOperatingPoints,
              measurements: run.prepared.measurements ?? [],
            },
            environment: output.result.metadata.environment,
            ...(nativeArtifacts.length ? { nativeArtifacts } : {}),
            artifacts: evidenceArtifacts,
            catalog,
          },
          null,
          2,
        ),
        { role: "manifest" },
      );
      if (epoch === this.epoch)
        terminalState = output.cancelled ? "cancelled" : "finished";
    } catch (error) {
      if (epoch !== this.epoch) return;
      if (error instanceof ExecutionFailure) {
        terminalState =
          error.problem.code === "run-cancelled"
            ? "cancelled"
            : error.acceptedUnknown
              ? "lost"
              : "finished";
        run.view.error = error.problem;
      } else {
        terminalState = run.view.result ? "finished" : "lost";
        run.view.error = {
          code:
            error instanceof Error && error.message === "ARTIFACT_CAPACITY"
              ? "ARTIFACT_CAPACITY"
              : error instanceof Error &&
                  error.message === "ARTIFACT_STORAGE_UNAVAILABLE"
                ? "ARTIFACT_STORAGE_UNAVAILABLE"
                : "INTERNAL_ERROR",
          message:
            "Run evidence could not be fully collected. Existing artifacts remain available; inspect the collection error before starting another run.",
          stage: "read",
          recovery: "not-retryable",
          correlationId: crypto.randomUUID(),
        };
      }
    }
    run.view.catalog = resultCatalog(
      { ...run.view, state: terminalState },
      run.view.error ? "partial" : collectionStatus,
      run.prepared.signalTargets,
    );
    if (!(await this.files.saveCatalog(run.view.catalog))) {
      run.view.error ??= {
        code: "RUN_CATALOG_STORAGE_UNAVAILABLE",
        message:
          "Files were collected, but the durable run directory could not be saved. Keep this run ID and download its evidence before closing the host.",
        stage: "export",
        recovery: "retry-after",
      };
    }
    if (epoch !== this.epoch) return;
    run.view.state = terminalState;
    // Do not retain full numeric arrays in memory after complete artifact
    // publication. On publication failure, preserve any otherwise unsaved data.
    if (!run.view.error) run.view = runReceipt(run.view);
  }
  private async publishArtifact(
    epoch: number,
    name: string,
    mediaType: string,
    text: string,
    metadata: Pick<ArtifactRef, "role" | "sourcePath" | "analysisIndex"> = {},
  ) {
    if (epoch !== this.epoch)
      throw new ExecutionFailure({
        code: "SESSION_CHANGED",
        message: "The session ended before publication",
        stage: "export",
        recovery: "reauthorize",
      });
    const ref = await this.files.put(name, mediaType, text, metadata);
    if (epoch !== this.epoch)
      throw new ExecutionFailure({
        code: "SESSION_CHANGED",
        message: "The session ended before publication",
        stage: "export",
        recovery: "reauthorize",
      });
    return ref;
  }
}
