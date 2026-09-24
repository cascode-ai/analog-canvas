import { sha256 } from "./content-digest.js";
import {
  planSimulationSourceChanges,
  sourceUpdateReceipt,
} from "./source-files.js";
import {
  SimulationFileOperationSchema,
  ArtifactDownloadResultSchema,
  type SimulationFileResult,
  type Workspace,
  type SimulationFileOwner,
} from "./file-contract.js";
import {
  handleProjectSourceFiles,
  type ProjectSimulationFileHost,
} from "./project-source-files.js";
export * from "./file-contract.js";
export type {
  ProjectSimulationFileHost,
  ProjectSourceSnapshot,
} from "./project-source-files.js";
import {
  isSimulationInputPath,
  MAX_SIMULATION_INPUT_BYTES,
  MAX_SIMULATION_INPUT_FILES,
} from "@icm/model";
import {
  problem,
  type ArtifactRef,
  type Problem,
  type ResultCatalog,
  type SimulationHistoryEntry,
} from "./contract.js";

export { MAX_SIMULATION_INPUT_BYTES };
export class ArtifactDownloadError extends Error {
  constructor(
    readonly code: string,
    readonly recovery: Problem["recovery"],
    message: string,
  ) {
    super(message);
  }
}
export const MAX_ARTIFACT_BYTES = 256 * 1024 * 1024;
export const MAX_ARTIFACT_STORE_BYTES = 1024 * 1024 * 1024;
// Preserve headroom for older protected evidence while generated runs rotate.
export const MAX_ARTIFACT_FILES = 4096;
export const MAX_ARTIFACT_TRANSFER_CONCURRENCY = 8;
export const MAX_ARTIFACT_TRANSFER_IN_FLIGHT_BYTES = 32 * 1024 * 1024;
export function artifactTransferConcurrency(
  byteLengths: readonly number[],
): number {
  const largest = byteLengths.reduce(
    (maximum, bytes) => Math.max(maximum, bytes),
    0,
  );
  return Math.min(
    MAX_ARTIFACT_TRANSFER_CONCURRENCY,
    Math.max(
      1,
      largest === 0
        ? MAX_ARTIFACT_TRANSFER_CONCURRENCY
        : Math.floor(MAX_ARTIFACT_TRANSFER_IN_FLIGHT_BYTES / largest),
    ),
  );
}
const CACHE_BYTES = 16 * 1024 * 1024;
export interface SimulationArtifactStore {
  /** Release this consumer's lifetime protection; persisted evidence remains. */
  releaseSession?(): void;
  put(ref: ArtifactRef, text: string): Promise<void>;
  /** Persist one generated result set in a single store transaction when supported. */
  putMany?(
    entries: readonly { ref: ArtifactRef; text: string }[],
  ): Promise<void>;
  get(id: string): Promise<{ ref: ArtifactRef; text: string } | null>;
  find?(fileId: string): Promise<ArtifactRef | null>;
  saveCatalog?(record: StoredResultCatalog): Promise<void>;
  catalog?(runId: string): Promise<StoredResultCatalog | null>;
  catalogs?(): Promise<StoredResultCatalog[]>;
  /** Current durable owners after a logical Run deletion. */
  referencedArtifactIds?(): Promise<string[]>;
  usage?(): Promise<{
    fileCount: number;
    byteLength: number;
    unreferencedFileCount: number;
    unreferencedBytes: number;
    catalogCount: number;
    cleanupDeferred: boolean;
  }>;
  runArchives?(): Promise<
    readonly { runId: string; retention: "saved" | "cache" }[]
  >;
  /** Delete by Run identity, never by arbitrary artifact ID. */
  deleteRun?(
    runId: string,
    includeSaved: boolean,
  ): Promise<{
    archiveCount: number;
    reclaimedFiles: number;
    reclaimedBytes: number;
    cleanupDeferred: boolean;
  }>;
}
export interface StoredResultCatalog {
  catalog: ResultCatalog;
  storedAt: number;
}
type CachedArtifact = { ref: ArtifactRef; text?: string };
export { sha256 } from "./content-digest.js";
export function safeInputPath(path: string): boolean {
  return isSimulationInputPath(path);
}

/** One File Resource; session storage is local, Project edits use host transactions. */
export class SimulationFiles {
  private publisher?:
    ((ref: ArtifactRef, text: string) => Promise<string>) | undefined;
  private downloads = new Map<
    string,
    { result?: { path: string } | { error: unknown } }
  >();
  private uploadQueue: Array<{ bytes: number; run: () => void }> = [];
  private uploading = 0;
  private uploadingBytes = 0;
  private publicationEpoch = 0;
  setArtifactPublisher(
    publisher: (ref: ArtifactRef, text: string) => Promise<string>,
  ) {
    this.publisher = publisher;
    this.publicationEpoch++;
    this.uploading = 0;
    this.uploadingBytes = 0;
    this.downloads.clear();
    this.uploadQueue = [];
    for (const item of this.artifacts.values()) this.startDownload(item);
  }
  private epoch = 0;
  private workspaces = new Map<string, Workspace>();
  private artifacts = new Map<string, CachedArtifact>();
  /** Logical Run deletion takes effect before cross-tab physical reclamation. */
  private revokedArtifactIds = new Set<string>();
  private catalogs = new Map<
    string,
    StoredResultCatalog & { storage: "persistent" | "memory" }
  >();
  constructor(
    private now: () => number = Date.now,
    private projectHost?: ProjectSimulationFileHost,
    private selectEngine?: (
      folder: import("@icm/model").ProjectSimulationFolder,
    ) => Promise<"ngspice" | "vacask">,
    private artifactStore?: SimulationArtifactStore,
  ) {}
  clear() {
    this.epoch++;
    this.artifactStore?.releaseSession?.();
    this.publicationEpoch++;
    this.uploading = 0;
    this.uploadingBytes = 0;
    this.workspaces.clear();
    this.artifacts.clear();
    this.revokedArtifactIds.clear();
    this.catalogs.clear();
    this.downloads.clear();
    this.uploadQueue = [];
    this.publisher = undefined;
  }
  private prune() {
    const now = this.now();
    for (const [id, w] of this.workspaces)
      if (w.expiresAt !== null && w.expiresAt <= now)
        this.workspaces.delete(id);
  }
  async handle(
    input: unknown,
  ): Promise<SimulationFileResult | { ok: false; error: Problem }> {
    this.prune();
    const parsed = SimulationFileOperationSchema.safeParse(input);
    if (!parsed.success)
      return problem(
        "SIMULATION_FILE_INVALID",
        parsed.error.issues[0]?.message ?? "Invalid file operation",
        "input",
      );
    const op = parsed.data;
    if (op.action === "downloads") {
      const epoch = this.epoch;
      const publicationEpoch = this.publicationEpoch;
      const downloads = [];
      // Restoring cold evidence can read large bodies. Do not materialize 32
      // files concurrently merely to obtain their small descriptors.
      for (const artifactId of op.artifactIds) {
        const result = await this.handle({ action: "download", artifactId });
        downloads.push({
          artifactId,
          result: result.ok
            ? ArtifactDownloadResultSchema.parse(result)
            : result,
        });
      }
      if (epoch !== this.epoch || publicationEpoch !== this.publicationEpoch)
        return problem(
          "SESSION_CHANGED",
          "The file session changed",
          "export",
          "reauthorize",
        );
      // Each entry reports ready/pending/failure independently; never wait for uploads here.
      return { ok: true, downloads };
    }
    if (
      (op.action === "list" ||
        op.action === "read" ||
        op.action === "update") &&
      op.owner?.kind === "project-folder"
    ) {
      if (!this.projectHost)
        return problem(
          "PROJECT_FILES_UNAVAILABLE",
          "This host has not attached Project-owned simulation files",
          "input",
          "retry-after",
        );
      const epoch = this.epoch;
      return handleProjectSourceFiles(
        this.projectHost,
        op,
        () => this.epoch === epoch,
        this.selectEngine,
      );
    }
    if (op.action === "list" && !op.owner)
      return {
        ok: true,
        workspaces: [...this.workspaces.values()].map(
          ({ files: _files, ...summary }) => summary,
        ),
      };
    if (op.action === "create") {
      if (this.workspaces.size >= 8)
        return problem(
          "WORKSPACE_LIMIT",
          "Discard an unused workspace before creating another",
          "input",
        );
      const workspace: Workspace = {
        id: crypto.randomUUID(),
        revision: 0,
        entry: null,
        configPath: "experiment.json",
        files: [],
        expiresAt: null,
      };
      this.workspaces.set(workspace.id, workspace);
      return { ok: true as const, workspace: structuredClone(workspace) };
    }
    if (op.action === "artifact" || op.action === "download") {
      if (this.revokedArtifactIds.has(op.artifactId))
        return problem(
          "ARTIFACT_UNAVAILABLE",
          "Artifact is unavailable in this Project",
          "export",
          "not-retryable",
        );
      const epoch = this.epoch;
      let item = this.artifacts.get(op.artifactId);
      if (!item && this.artifactStore) {
        try {
          const restored = await this.artifactStore.get(op.artifactId);
          if (epoch !== this.epoch)
            return problem(
              "SESSION_CHANGED",
              "The file session changed",
              "export",
              "reauthorize",
            );
          if (restored) {
            item = restored;
            this.artifacts.set(restored.ref.id, restored);
            this.trimCache();
          }
        } catch {
          return problem(
            "ARTIFACT_STORAGE_UNAVAILABLE",
            "Persistent evidence could not be read; retry without restarting the simulation",
            "export",
            "retry-after",
          );
        }
      }
      if (!item)
        return problem(
          "ARTIFACT_UNAVAILABLE",
          "Artifact is not available in this Project's evidence storage",
          "export",
          "not-retryable",
        );
      if (op.action === "download") {
        if (!this.publisher)
          return problem(
            "ARTIFACT_DOWNLOAD_UNAVAILABLE",
            "This host has not attached the authenticated download transport",
            "export",
            "retry-after",
          );
        const publisher = this.publisher;
        const epoch = this.epoch;
        const upload =
          this.downloads.get(item.ref.id) ?? this.startDownload(item);
        // Let already-settled publishers report immediately, but never wait for
        // network I/O inside the relay's short control-request deadline.
        await Promise.resolve();
        try {
          if (this.epoch !== epoch || this.publisher !== publisher)
            return problem(
              "SESSION_CHANGED",
              "The download session changed",
              "export",
              "reauthorize",
            );
          if (!upload.result)
            return {
              ok: false,
              error: {
                code: "ARTIFACT_TRANSFER_PENDING",
                message:
                  "File publication is in progress; retry this descriptor, not the simulation",
                stage: "export",
                recovery: "retry-after",
                retryAfterMs: 2000,
              },
            };
          if ("error" in upload.result) throw upload.result.error;
          return {
            ok: true,
            artifact: item.ref,
            download: { path: upload.result.path },
          };
        } catch (error) {
          if (this.downloads.get(item.ref.id) === upload)
            this.downloads.delete(item.ref.id);
          if (error instanceof ArtifactDownloadError)
            return problem(error.code, error.message, "export", error.recovery);
          return problem(
            "ARTIFACT_UPLOAD_FAILED",
            "File transfer could not be prepared; the original artifact remains available",
            "export",
            "retry-after",
          );
        }
      }
      let text: string;
      try {
        text = await this.artifactText(item);
      } catch {
        return problem(
          "ARTIFACT_STORAGE_UNAVAILABLE",
          "Persistent evidence could not be read",
          "export",
          "retry-after",
        );
      }
      if (epoch !== this.epoch)
        return problem(
          "SESSION_CHANGED",
          "The file session changed",
          "export",
          "reauthorize",
        );
      if (op.offset > text.length)
        return problem(
          "ARTIFACT_OFFSET_INVALID",
          "Offset exceeds artifact length",
          "export",
        );
      const end = Math.min(text.length, op.offset + op.maxChars);
      return {
        ok: true as const,
        artifact: item.ref,
        text: text.slice(op.offset, end),
        offset: op.offset,
        nextOffset: end < text.length ? end : null,
      };
    }
    const owner = op.owner as Extract<
      SimulationFileOwner,
      { kind: "session-workspace" }
    >;
    const workspace = this.workspaces.get(owner.workspaceId);
    if (!workspace)
      return problem(
        "WORKSPACE_UNAVAILABLE",
        "Workspace expired or belongs to a different session",
        "input",
      );
    if (op.action === "discard") {
      this.workspaces.delete(workspace.id);
      return { ok: true as const, discarded: true as const };
    }
    if (op.action === "list") return this.listWorkspace(workspace);
    if (op.action === "read") {
      const file = workspace.files.find((f) => f.path === op.path);
      if (!file)
        return problem(
          "SIMULATION_FILE_NOT_FOUND",
          `No authored file ${op.path}`,
          "input",
        );
      if (op.offset > file.text.length)
        return problem(
          "SIMULATION_TEXT_RANGE_INVALID",
          "Offset exceeds file length",
          "input",
        );
      const textDigest = await sha256(file.text);
      this.prune();
      if (this.workspaces.get(workspace.id) !== workspace)
        return problem(
          "WORKSPACE_REVISION_CONFLICT",
          "Workspace changed while reading; read it again",
          "input",
        );
      const end = Math.min(file.text.length, op.offset + op.maxChars);
      return {
        ok: true,
        owner,
        revision: workspace.revision,
        path: file.path,
        textDigest,
        text: file.text.slice(op.offset, end),
        offset: op.offset,
        nextOffset: end < file.text.length ? end : null,
      };
    }
    if (op.circuitEdits.length || op.drafts !== undefined)
      return problem(
        "SIMULATION_CIRCUIT_OWNER_REQUIRED",
        "Circuit edits and saved drafts require a Project folder owner",
        "input",
      );
    const conflict = () => ({
      ok: false as const,
      error: {
        ...problem(
          "WORKSPACE_REVISION_CONFLICT",
          "Read the workspace and apply the edit to its current revision",
          "input",
        ).error,
        currentRevision: this.workspaces.get(workspace.id)?.revision,
        fileEdit: {
          applied: false as const,
          expectedRevision: op.expectedRevision,
        },
      },
    });
    if (op.expectedRevision !== workspace.revision) return conflict();
    for (const path of [...op.removes, ...op.writes.map((file) => file.path)]) {
      if (!safeInputPath(path))
        return problem(
          "INPUT_PATH_INVALID",
          "Use a relative path without parent traversal or reserved runtime names",
          "input",
        );
    }
    const planned = await planSimulationSourceChanges(workspace.files, {
      writes: op.writes,
      removes: op.removes,
      patches: op.patches,
      replacements: op.replacements,
    });
    if (!planned.ok) return planned;
    const update = await sourceUpdateReceipt(workspace.files, planned.files);
    this.prune();
    if (this.workspaces.get(workspace.id) !== workspace) return conflict();
    const files = new Map(planned.files.map((file) => [file.path, file.text]));
    const entry = op.entry ?? workspace.entry;
    const configPath = op.configPath ?? workspace.configPath;
    update.changed ||=
      entry !== workspace.entry || configPath !== workspace.configPath;
    if (entry === configPath)
      return problem(
        "SIMULATION_FILE_INVALID",
        "The SPICE entry and configuration require distinct paths",
        "input",
      );
    const size = [...files.values()].reduce(
      (n, t) => n + new TextEncoder().encode(t).byteLength,
      0,
    );
    if (
      files.size > MAX_SIMULATION_INPUT_FILES ||
      size > MAX_SIMULATION_INPUT_BYTES
    )
      return problem(
        "INPUT_TOO_LARGE",
        "At most 24 files and 1 MiB are accepted per workspace",
        "input",
      );
    const next: Workspace = {
      ...workspace,
      revision: workspace.revision + (update.changed ? 1 : 0),
      entry,
      configPath,
      files: [...files]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([path, text]) => ({ path, text })),
      expiresAt: null,
    };
    this.workspaces.set(next.id, next);
    return { ...this.listWorkspace(next), update };
  }
  private trimCache() {
    if (!this.artifactStore) return;
    let bytes = [...this.artifacts.values()].reduce(
      (n, item) => n + (item.text === undefined ? 0 : item.ref.byteLength),
      0,
    );
    for (const item of this.artifacts.values()) {
      if (bytes <= CACHE_BYTES) break;
      if (item.text !== undefined) {
        delete item.text;
        bytes -= item.ref.byteLength;
      }
    }
  }
  private async artifactText(item: CachedArtifact): Promise<string> {
    if (item.text !== undefined) return item.text;
    const restored = await this.artifactStore?.get(item.ref.id);
    if (!restored) throw new Error("ARTIFACT_UNAVAILABLE");
    return restored.text;
  }
  /** Persist the canonical Run catalog, without embedding numeric evidence. */
  async saveCatalog(catalog: ResultCatalog): Promise<boolean> {
    const epoch = this.epoch;
    const record = {
      catalog: structuredClone(catalog),
      storedAt: this.now(),
      storage: "memory" as const,
    };
    this.catalogs.set(catalog.runId, record);
    if (!this.artifactStore?.saveCatalog) return true;
    try {
      await this.artifactStore.saveCatalog(record);
      if (epoch === this.epoch)
        this.catalogs.set(catalog.runId, { ...record, storage: "persistent" });
      return true;
    } catch {
      return false;
    }
  }
  private async retainedCatalogs() {
    const epoch = this.epoch;
    const saved = (await this.artifactStore?.catalogs?.()) ?? [];
    if (epoch !== this.epoch) throw new Error("SESSION_CHANGED");
    const records = new Map(
      saved.map((record) => [
        record.catalog.runId,
        { ...record, storage: "persistent" as "persistent" | "memory" },
      ]),
    );
    for (const [id, record] of this.catalogs) {
      if (record.storage === "memory" || !this.artifactStore?.catalogs) {
        records.set(id, record);
      } else if (records.has(id)) {
        records.set(id, record);
      } else {
        // An automatic retention pass removed the durable catalog while this
        // process was open. Do not resurrect it from the hot cache.
        this.catalogs.delete(id);
        for (const file of record.catalog.files) {
          this.artifacts.delete(file.id);
          this.downloads.delete(file.id);
        }
      }
    }
    return [...records.values()].sort(
      (a, b) =>
        b.storedAt - a.storedAt ||
        a.catalog.runId.localeCompare(b.catalog.runId),
    );
  }
  private async archiveRetention() {
    const archives = (await this.artifactStore?.runArchives?.()) ?? [];
    const byRun = new Map<string, { saved: boolean; count: number }>();
    for (const archive of archives) {
      const entry = byRun.get(archive.runId) ?? { saved: false, count: 0 };
      entry.saved ||= archive.retention === "saved";
      entry.count++;
      byRun.set(archive.runId, entry);
    }
    return byRun;
  }
  async usage() {
    const stored = await this.artifactStore?.usage?.();
    if (stored)
      return {
        ...stored,
        fileLimit: MAX_ARTIFACT_FILES,
        byteLimit: MAX_ARTIFACT_STORE_BYTES,
      };
    const records = await this.retainedCatalogs();
    const referenced = new Set(
      records.flatMap((record) => record.catalog.files.map((file) => file.id)),
    );
    const unreferenced = [...this.artifacts.values()].filter(
      (item) => !referenced.has(item.ref.id),
    );
    return {
      fileCount: this.artifacts.size,
      byteLength: [...this.artifacts.values()].reduce(
        (sum, item) => sum + item.ref.byteLength,
        0,
      ),
      unreferencedFileCount: unreferenced.length,
      unreferencedBytes: unreferenced.reduce(
        (sum, item) => sum + item.ref.byteLength,
        0,
      ),
      catalogCount: records.length,
      fileLimit: MAX_ARTIFACT_FILES,
      byteLimit: MAX_ARTIFACT_STORE_BYTES,
      cleanupDeferred: false,
    };
  }
  async catalog(runId: string): Promise<ResultCatalog | undefined> {
    const current = this.catalogs.get(runId);
    if (current?.storage === "memory" || !this.artifactStore?.catalogs)
      return current ? structuredClone(current.catalog) : undefined;
    if (this.artifactStore?.catalog) {
      const saved = await this.artifactStore.catalog(runId);
      if (!saved) this.catalogs.delete(runId);
      return saved ? structuredClone(saved.catalog) : undefined;
    }
    return (await this.retainedCatalogs()).find(
      (record) => record.catalog.runId === runId,
    )?.catalog;
  }
  async history(
    limit: number,
    cursor?: string,
  ): Promise<{ runs: SimulationHistoryEntry[]; nextCursor: string | null }> {
    const records = await this.retainedCatalogs();
    // A damaged secondary archive index must not hide canonical Run catalogs.
    // Deletion below remains strict and never assumes the archive is absent.
    const archives = await this.archiveRetention().catch(() => undefined);
    const offset = cursor
      ? records.findIndex((record) => record.catalog.runId === cursor) + 1
      : 0;
    if (cursor && offset === 0) throw new Error("HISTORY_CURSOR_UNAVAILABLE");
    const selected = records.slice(offset, offset + limit);
    return {
      runs: selected.map(({ catalog, storedAt, storage }) => ({
        runId: catalog.runId,
        preparedId: catalog.preparedId,
        inputRevision: catalog.inputRevision,
        ...(catalog.source ? { source: catalog.source } : {}),
        execution: catalog.execution,
        collection: catalog.collection,
        storedAt,
        storage,
        fileCount: catalog.files.length,
        byteLength: catalog.files.reduce(
          (sum, file) => sum + file.byteLength,
          0,
        ),
        retention:
          storage === "memory"
            ? ("session-only" as const)
            : !archives
              ? ("unverified" as const)
              : archives.get(catalog.runId)?.saved
                ? ("saved" as const)
                : archives.has(catalog.runId) ||
                    catalog.retentionPolicy === "cache"
                  ? ("cache" as const)
                  : ("catalog-only" as const),
        archiveCount: archives?.get(catalog.runId)?.count ?? 0,
      })),
      nextCursor:
        offset + selected.length < records.length
          ? selected.at(-1)!.catalog.runId
          : null,
    };
  }
  async deleteHistory(
    runId: string,
    options: {
      dryRun?: boolean | undefined;
      includeSaved?: boolean | undefined;
    },
  ) {
    const record = (await this.retainedCatalogs()).find(
      (item) => item.catalog.runId === runId,
    );
    if (!record) throw new Error("RUN_HISTORY_NOT_FOUND");
    const archives = (await this.archiveRetention()).get(runId);
    const retention =
      record.storage === "memory"
        ? ("session-only" as const)
        : archives?.saved
          ? ("saved" as const)
          : archives || record.catalog.retentionPolicy === "cache"
            ? ("cache" as const)
            : ("catalog-only" as const);
    const receipt = {
      runId,
      dryRun: options.dryRun ?? false,
      deleted: false,
      retention,
      archiveCount: archives?.count ?? 0,
      fileCount: record.catalog.files.length,
      byteLength: record.catalog.files.reduce(
        (sum, file) => sum + file.byteLength,
        0,
      ),
      reclaimedFiles: 0,
      reclaimedBytes: 0,
      cleanupDeferred: false,
    };
    if (options.dryRun) return receipt;
    if (record.catalog.execution === "pending")
      throw new Error("RUN_HISTORY_ACTIVE");
    if (retention === "saved" && !options.includeSaved)
      throw new Error("RUN_HISTORY_SAVED");
    if (record.storage === "persistent" && !this.artifactStore?.deleteRun)
      throw new Error("RUN_HISTORY_DELETE_UNAVAILABLE");
    const removed = await this.artifactStore?.deleteRun?.(
      runId,
      options.includeSaved ?? false,
    );
    this.catalogs.delete(runId);
    // An active Editor lease can defer physical reclamation. Invalidate its
    // process cache now, but retain IDs still owned by another Run or archive.
    let retainedIds: Set<string> | undefined;
    try {
      retainedIds = new Set(
        this.artifactStore?.referencedArtifactIds
          ? await this.artifactStore.referencedArtifactIds()
          : (await this.retainedCatalogs()).flatMap((entry) =>
              entry.catalog.files.map((file) => file.id),
            ),
      );
    } catch {
      // The delete committed; do not turn a cache refresh failure into a
      // misleading retryable delete failure.
    }
    for (const file of record.catalog.files) {
      if (retainedIds?.has(file.id)) continue;
      this.artifacts.delete(file.id);
      this.downloads.delete(file.id);
      if (retainedIds) this.revokedArtifactIds.add(file.id);
    }
    return {
      ...receipt,
      deleted: true,
      archiveCount: removed?.archiveCount ?? receipt.archiveCount,
      reclaimedFiles: removed?.reclaimedFiles ?? 0,
      reclaimedBytes: removed?.reclaimedBytes ?? 0,
      cleanupDeferred: removed?.cleanupDeferred ?? !!this.artifactStore,
    };
  }
  /** Host-local whole-file access. Never embed this body in the relay RPC. */
  async readArtifact(
    id: string,
  ): Promise<
    | { ok: true; artifact: ArtifactRef; text: string }
    | { ok: false; error: Problem }
  > {
    if (this.revokedArtifactIds.has(id))
      return problem(
        "ARTIFACT_UNAVAILABLE",
        "Artifact is unavailable in this Project",
        "export",
        "not-retryable",
      );
    const epoch = this.epoch;
    try {
      const item =
        this.artifacts.get(id) ?? (await this.artifactStore?.get(id));
      if (!item)
        return problem(
          "ARTIFACT_UNAVAILABLE",
          "Artifact is unavailable in this Project",
          "export",
          "not-retryable",
        );
      const text = await this.artifactText(item);
      if (epoch !== this.epoch)
        return problem(
          "SESSION_CHANGED",
          "The file session changed",
          "export",
          "reauthorize",
        );
      return { ok: true, artifact: item.ref, text };
    } catch {
      return problem(
        "ARTIFACT_STORAGE_UNAVAILABLE",
        "Persistent evidence could not be read",
        "export",
        "retry-after",
      );
    }
  }
  private startDownload(item: CachedArtifact) {
    const upload: { result?: { path: string } | { error: unknown } } = {};
    this.downloads.set(item.ref.id, upload);
    const publisher = this.publisher!;
    const epoch = this.publicationEpoch;
    const bytes = item.ref.byteLength;
    const run = () => {
      if (this.publisher !== publisher || epoch !== this.publicationEpoch)
        return;
      this.uploading++;
      this.uploadingBytes += bytes;
      let promise: Promise<string>;
      try {
        promise =
          item.text !== undefined
            ? publisher(item.ref, item.text)
            : this.artifactText(item).then((text) => {
                if (epoch !== this.publicationEpoch)
                  throw new Error("SESSION_CHANGED");
                return publisher(item.ref, text);
              });
      } catch (error) {
        promise = Promise.reject(error);
      }
      void promise
        .then(
          (path) => {
            upload.result = { path };
          },
          (error: unknown) => {
            upload.result = { error };
          },
        )
        .finally(() => {
          if (epoch !== this.publicationEpoch) return;
          this.uploading--;
          this.uploadingBytes -= bytes;
          this.drainUploadQueue();
        });
    };
    this.uploadQueue.push({ bytes, run });
    this.drainUploadQueue();
    return upload;
  }
  private drainUploadQueue() {
    while (
      this.uploading < MAX_ARTIFACT_TRANSFER_CONCURRENCY &&
      this.uploadQueue.length
    ) {
      const next = this.uploadQueue.findIndex(
        ({ bytes }) =>
          this.uploading === 0 ||
          this.uploadingBytes + bytes <= MAX_ARTIFACT_TRANSFER_IN_FLIGHT_BYTES,
      );
      if (next < 0) return;
      const [entry] = this.uploadQueue.splice(next, 1);
      entry!.run();
    }
  }
  private listWorkspace(workspace: Workspace): SimulationFileResult {
    return {
      ok: true,
      source: {
        owner: { kind: "session-workspace", workspaceId: workspace.id },
        revision: workspace.revision,
        entry: workspace.entry,
        configPath: workspace.configPath,
        files: workspace.files.map((file) => ({
          path: file.path,
          kind: "authored",
          editing: "text",
          byteLength: new TextEncoder().encode(file.text).byteLength,
        })),
      },
    };
  }
  snapshot(id: string, revision: number) {
    this.prune();
    const w = this.workspaces.get(id);
    if (!w)
      return problem(
        "WORKSPACE_UNAVAILABLE",
        "Workspace is unavailable",
        "prepare",
      );
    if (w.revision !== revision)
      return problem(
        "WORKSPACE_REVISION_CONFLICT",
        "Read the workspace before preparing",
        "prepare",
        "reprepare",
      );
    if (!w.entry)
      return problem(
        "ENTRY_NOT_SET",
        "Select a workspace entry file",
        "prepare",
      );
    return { ok: true as const, workspace: structuredClone(w) };
  }
  async put(
    name: string,
    mediaType: string,
    text: string,
    metadata: Pick<
      ArtifactRef,
      "fileId" | "role" | "sourcePath" | "analysisIndex"
    > = {},
  ): Promise<ArtifactRef> {
    const epoch = this.epoch;
    const digest = await sha256(text);
    if (epoch !== this.epoch) throw new Error("SESSION_CHANGED");
    this.prune();
    const byteLength = new TextEncoder().encode(text).byteLength;
    if (metadata.fileId) {
      let existing: ArtifactRef | null | undefined = [
        ...this.artifacts.values(),
      ].find(
        (item) => (item.ref.fileId ?? item.ref.id) === metadata.fileId,
      )?.ref;
      if (!existing) {
        try {
          existing = await this.artifactStore?.find?.(metadata.fileId);
        } catch {
          throw new Error("ARTIFACT_STORAGE_UNAVAILABLE");
        }
      }
      if (epoch !== this.epoch) throw new Error("SESSION_CHANGED");
      if (existing) {
        if (
          existing.sha256 !== digest ||
          existing.byteLength !== byteLength ||
          existing.name !== name ||
          existing.mediaType !== mediaType ||
          existing.role !== metadata.role ||
          existing.sourcePath !== metadata.sourcePath ||
          existing.analysisIndex !== metadata.analysisIndex
        )
          throw new Error("ARTIFACT_ID_CONFLICT");
        const item = { ref: existing, text };
        this.revokedArtifactIds.delete(existing.id);
        this.artifacts.set(existing.id, item);
        this.trimCache();
        if (this.publisher && !this.downloads.has(existing.id))
          this.startDownload(item);
        return existing;
      }
    }
    if (
      byteLength > MAX_ARTIFACT_BYTES ||
      this.artifacts.size >= MAX_ARTIFACT_FILES ||
      (!this.artifactStore &&
        [...this.artifacts.values()].reduce((n, a) => n + a.ref.byteLength, 0) +
          byteLength >
          CACHE_BYTES)
    )
      throw new Error("ARTIFACT_CAPACITY");
    const id = crypto.randomUUID();
    const ref: ArtifactRef = {
      id,
      name,
      mediaType,
      byteLength,
      sha256: digest,
      ...metadata,
      fileId: metadata.fileId ?? id,
    };
    if (this.artifactStore) {
      try {
        await this.artifactStore.put(ref, text);
      } catch (error) {
        if (error instanceof Error && error.message === "ARTIFACT_CAPACITY")
          throw error;
        throw new Error("ARTIFACT_STORAGE_UNAVAILABLE");
      }
    }
    if (epoch !== this.epoch) throw new Error("SESSION_CHANGED");
    const item = { ref, text };
    this.revokedArtifactIds.delete(ref.id);
    this.artifacts.set(ref.id, item);
    this.trimCache();
    if (this.publisher) this.startDownload(item);
    return ref;
  }
  /** Generated run evidence without stable caller-supplied file identities. */
  async putMany(
    entries: readonly {
      name: string;
      mediaType: string;
      text: string;
      metadata?: Pick<ArtifactRef, "role" | "sourcePath" | "analysisIndex">;
    }[],
  ): Promise<ArtifactRef[]> {
    if (!entries.length) return [];
    const epoch = this.epoch;
    const encoder = new TextEncoder();
    const prepared = await Promise.all(
      entries.map(async (entry) => {
        const byteLength = encoder.encode(entry.text).byteLength;
        return {
          ...entry,
          byteLength,
          digest: await sha256(entry.text),
        };
      }),
    );
    if (epoch !== this.epoch) throw new Error("SESSION_CHANGED");
    const totalBytes = prepared.reduce((sum, item) => sum + item.byteLength, 0);
    if (
      prepared.some((item) => item.byteLength > MAX_ARTIFACT_BYTES) ||
      this.artifacts.size + prepared.length > MAX_ARTIFACT_FILES ||
      (!this.artifactStore &&
        [...this.artifacts.values()].reduce(
          (sum, item) => sum + item.ref.byteLength,
          totalBytes,
        ) > CACHE_BYTES)
    )
      throw new Error("ARTIFACT_CAPACITY");
    const items = prepared.map((entry) => {
      const id = crypto.randomUUID();
      return {
        ref: {
          id,
          fileId: id,
          name: entry.name,
          mediaType: entry.mediaType,
          byteLength: entry.byteLength,
          sha256: entry.digest,
          ...entry.metadata,
        } satisfies ArtifactRef,
        text: entry.text,
      };
    });
    if (this.artifactStore) {
      try {
        if (this.artifactStore.putMany) await this.artifactStore.putMany(items);
        else
          for (const item of items)
            await this.artifactStore.put(item.ref, item.text);
      } catch (error) {
        if (error instanceof Error && error.message === "ARTIFACT_CAPACITY")
          throw error;
        throw new Error("ARTIFACT_STORAGE_UNAVAILABLE");
      }
    }
    if (epoch !== this.epoch) throw new Error("SESSION_CHANGED");
    for (const item of items) {
      this.artifacts.set(item.ref.id, item);
      if (this.publisher) this.startDownload(item);
    }
    this.trimCache();
    return items.map((item) => item.ref);
  }
}
