import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  writeFile,
  unlink,
  stat,
  lstat,
} from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { basename, join, resolve } from "node:path";
import { z } from "zod";
import {
  ArtifactRefSchema,
  ResultCatalogSchema,
  type ArtifactRef,
  type ResultCatalog,
} from "@icm/simulation-service/contract";
import { downloadSimulationArtifact } from "./artifact-download.js";
import { userWorkspaceRoot } from "./workspace-location.js";
import { TransferPending } from "./transfer-pending.js";

const IndexSchema = z.strictObject({
  kind: z.literal("analog-canvas-workspace"),
  schemaVersion: z.literal(2),
  serverUrl: z.string(),
  projectId: z.string(),
  projectIdentity: z.string(),
  sessions: z.array(z.string()),
  runs: z.array(ResultCatalogSchema),
  downloads: z.array(
    z.strictObject({
      artifact: ArtifactRefSchema,
      path: z.string(),
      runId: z.string().optional(),
    }),
  ),
});
const LegacyIndexSchema = IndexSchema.omit({ projectIdentity: true }).extend({
  schemaVersion: z.literal(1),
});
type Index = z.infer<typeof IndexSchema>;
type ReadableIndex = Index | z.infer<typeof LegacyIndexSchema>;
export type WorkspaceScope = {
  serverUrl: string;
  projectId: string;
  /** Cloud identity survives reopening; unsaved drafts use their browser workspace identity. */
  projectIdentity: string;
  sessionId: string;
};
export type FetchArtifact = ((
  ref: ArtifactRef,
  offset: number,
) => Promise<Response>) & {
  /** Selection only: do not publish/download until a missing local file requests bytes. */
  select?: (refs: ArtifactRef[], options?: { deferPending: boolean }) => void;
};
type DownloadTiming = { started: number; remoteWaitMs: number };
const workspaces = new Map<string, Promise<LocalWorkspace>>();
function segment(value: string): string {
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(
      value,
    )
  )
    return value;
  // Hex is case-insensitive-filesystem safe; case-folding a base64 path is not.
  const encoded = Buffer.from(value).toString("hex");
  if (!encoded || encoded.length > 180)
    throw new Error("WORKSPACE_ID_TOO_LONG");
  return `id-${encoded}`;
}
function filename(ref: ArtifactRef) {
  const label =
    basename(ref.name.replaceAll("\\", "/"))
      .replace(/[^a-zA-Z0-9._-]/gu, "_")
      .slice(-48) || "artifact";
  return `${segment(ref.fileId ?? ref.id)}-${label}`;
}
export function defaultWorkspacePath(
  scope: WorkspaceScope,
  root = userWorkspaceRoot(),
): string {
  return resolve(
    root,
    segment(new URL(scope.serverUrl).origin),
    segment(scope.projectIdentity),
  );
}
async function readIndex(path: string): Promise<ReadableIndex | null> {
  try {
    if ((await stat(path)).size > 16 * 1024 * 1024)
      throw new Error("WORKSPACE_INDEX_TOO_LARGE");
    return z
      .union([IndexSchema, LegacyIndexSchema])
      .parse(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error("WORKSPACE_INDEX_INVALID", { cause: error });
  }
}

/** One local index, immutable run files and ordinary user-owned work files. */
export class LocalWorkspace {
  private writes: Promise<void> = Promise.resolve();
  private persistenceFailed = false;
  private constructor(
    readonly basePath: string,
    private index: ReadableIndex,
  ) {}
  get indexPath() {
    return join(this.basePath, "index.json");
  }
  static async open(
    scope: WorkspaceScope,
    path = defaultWorkspacePath(scope),
  ): Promise<LocalWorkspace> {
    const basePath = resolve(path);
    let pending = workspaces.get(basePath);
    if (!pending) {
      pending = this.create(scope, basePath);
      workspaces.set(basePath, pending);
      void pending.catch(() => {
        if (workspaces.get(basePath) === pending) workspaces.delete(basePath);
      });
    }
    const workspace = await pending;
    if (workspace.index.schemaVersion === 1)
      throw new Error("WORKSPACE_LEGACY_INDEX_READ_ONLY");
    if (
      workspace.index.serverUrl !== new URL(scope.serverUrl).origin ||
      workspace.index.projectIdentity !== scope.projectIdentity
    )
      throw new Error("WORKSPACE_PROJECT_MISMATCH");
    if (
      workspace.index.projectId !== scope.projectId ||
      !workspace.index.sessions.includes(scope.sessionId)
    ) {
      workspace.index.projectId = scope.projectId;
      workspace.index.sessions.push(scope.sessionId);
      workspace.index.sessions = [...new Set(workspace.index.sessions)];
      await workspace.save();
    }
    return workspace;
  }
  private static async create(
    scope: WorkspaceScope,
    basePath: string,
  ): Promise<LocalWorkspace> {
    const serverUrl = new URL(scope.serverUrl).origin;
    const indexPath = join(basePath, "index.json");
    const index = (await readIndex(indexPath)) ?? {
      kind: "analog-canvas-workspace" as const,
      schemaVersion: 2 as const,
      serverUrl,
      projectId: scope.projectId,
      projectIdentity: scope.projectIdentity,
      sessions: [],
      runs: [],
      downloads: [],
    };
    if (index.schemaVersion === 1)
      throw new Error("WORKSPACE_LEGACY_INDEX_READ_ONLY");
    if (
      index.serverUrl !== serverUrl ||
      index.projectIdentity !== scope.projectIdentity
    )
      throw new Error("WORKSPACE_PROJECT_MISMATCH");
    index.projectId = scope.projectId;
    if (!index.sessions.includes(scope.sessionId))
      index.sessions.push(scope.sessionId);
    await mkdir(join(basePath, "work"), { recursive: true });
    const workspace = new LocalWorkspace(basePath, index);
    await workspace.save();
    return workspace;
  }
  static async inspect(path: string) {
    const basePath = resolve(path);
    const index = await readIndex(join(basePath, "index.json"));
    if (!index) throw new Error("WORKSPACE_NOT_FOUND");
    return new LocalWorkspace(basePath, index).describe();
  }
  describe() {
    return {
      ok: true,
      filesystem: "mcp-host",
      basePath: this.basePath,
      indexPath: this.indexPath,
      workPath: join(this.basePath, "work"),
      serverUrl: this.index.serverUrl,
      projectId: this.index.projectId,
      projectIdentity:
        this.index.schemaVersion === 2 ? this.index.projectIdentity : null,
      runs: this.index.runs.map((run) => ({
        runId: run.runId,
        execution: run.execution,
        collection: run.collection,
        files: run.files.length,
      })),
      workspaceFileCount: this.index.downloads.length,
    };
  }
  async download(
    ref: ArtifactRef,
    fetchArtifact: FetchArtifact,
    runId?: string,
    timing: DownloadTiming = { started: performance.now(), remoteWaitMs: 0 },
  ) {
    const path = this.artifactPath(ref, runId);
    const result = await downloadSimulationArtifact(
      ref,
      path,
      async (offset) => {
        const requested = performance.now();
        try {
          return await fetchArtifact(ref, offset);
        } finally {
          timing.remoteWaitMs += performance.now() - requested;
        }
      },
    );
    const old = this.index.downloads.findIndex((item) => item.path === path);
    const record = { artifact: ref, path, ...(runId ? { runId } : {}) };
    if (old < 0 || !isDeepStrictEqual(this.index.downloads[old], record)) {
      if (old < 0) this.index.downloads.push(record);
      else this.index.downloads[old] = record;
      await this.save();
    }
    return {
      ...result,
      timing: {
        elapsedMs: Math.round(performance.now() - timing.started),
        // Descriptor publication/wait and GET headers; excludes streamed body.
        remoteWaitMs: Math.round(timing.remoteWaitMs),
      },
    };
  }
  async sync(
    catalog: ResultCatalog,
    fetchArtifact: FetchArtifact,
    fileIds?: string[],
    selection?: {
      analysisIndex?: number | undefined;
      roles?: NonNullable<ArtifactRef["role"]>[] | undefined;
    },
  ) {
    // A prior failed atomic index write must not become a successful no-op just
    // because its in-memory records already match the next request.
    await this.writes;
    if (this.persistenceFailed) await this.save();
    const parsed = ResultCatalogSchema.parse(catalog);
    const byId =
      fileIds === undefined
        ? parsed.files
        : parsed.files.filter(
            (file) =>
              fileIds.includes(file.fileId ?? file.id) ||
              fileIds.includes(file.id),
          );
    if (
      fileIds?.some(
        (id) => !byId.some((file) => file.id === id || file.fileId === id),
      )
    )
      throw new Error("WORKSPACE_FILE_NOT_IN_RUN");
    const dataset =
      selection?.analysisIndex === undefined
        ? undefined
        : parsed.datasets.find(
            (item) => item.analysisIndex === selection.analysisIndex,
          );
    if (selection?.analysisIndex !== undefined && !dataset)
      throw new Error("WORKSPACE_ANALYSIS_NOT_IN_RUN");
    const selected = byId.filter(
      (file) =>
        (!selection?.roles ||
          (file.role !== undefined && selection.roles.includes(file.role))) &&
        (!dataset ||
          file.analysisIndex === dataset.analysisIndex ||
          dataset.representations.some(
            (r) =>
              r.artifactId === file.id || r.fileId === (file.fileId ?? file.id),
          )),
    );
    {
      const old = this.index.runs.findIndex(
        (run) => run.runId === parsed.runId,
      );
      if (old < 0 || !isDeepStrictEqual(this.index.runs[old], parsed)) {
        if (old < 0) this.index.runs.push(parsed);
        else this.index.runs[old] = parsed;
        await this.save();
      }
      const results: Awaited<ReturnType<LocalWorkspace["download"]>>[] = [];
      // Metadata only: content is verified exactly once by download(). Never
      // pre-read whole files or treat an index entry as proof of integrity.
      const missing: ArtifactRef[] = [];
      if (fetchArtifact.select) {
        for (let start = 0; start < selected.length; start += 32) {
          const group = selected.slice(start, start + 32);
          const absent = await Promise.all(
            group.map(async (ref) => {
              try {
                await lstat(this.artifactPath(ref, parsed.runId));
                return false;
              } catch (error) {
                if ((error as NodeJS.ErrnoException).code === "ENOENT")
                  return true;
                throw error;
              }
            }),
          );
          missing.push(...group.filter((_, i) => absent[i]));
        }
        fetchArtifact.select(missing, { deferPending: true });
      }
      const queue = selected.map((file, index) => ({
        file,
        index,
        readyAt: 0,
        waitStarted: 0,
        timing: undefined as DownloadTiming | undefined,
      }));
      let failure: { file: ArtifactRef; error: unknown } | undefined;
      // Two rolling slots, not two-file barriers. Stop scheduling on failure,
      // settle already-started writes and retain deterministic catalog order.
      const worker = async () => {
        while (!failure && queue.length) {
          const now = Date.now();
          const next = queue.findIndex((item) => item.readyAt <= now);
          if (next < 0) {
            await new Promise((resolve) =>
              setTimeout(
                resolve,
                Math.max(
                  1,
                  Math.min(...queue.map((item) => item.readyAt)) - now,
                ),
              ),
            );
            continue;
          }
          const item = queue.splice(next, 1)[0]!;
          const { file, index } = item;
          item.timing ??= { started: performance.now(), remoteWaitMs: 0 };
          if (item.waitStarted) {
            // Preserve publication backoff in the existing remote-wait metric,
            // but do not label extra queue time as remote work.
            item.timing.remoteWaitMs += Math.max(
              0,
              Math.min(now - item.waitStarted, item.readyAt - item.waitStarted),
            );
          }
          try {
            results[index] = await this.download(
              file,
              fetchArtifact,
              parsed.runId,
              item.timing,
            );
          } catch (error) {
            if (error instanceof TransferPending) {
              const waitStarted = Date.now();
              queue.push({
                ...item,
                waitStarted,
                readyAt: waitStarted + error.retryAfterMs,
              });
              continue;
            }
            failure ??= { file, error };
          }
        }
      };
      await Promise.all([worker(), worker()]);
      const files = results.filter((file) => file !== undefined);
      if (failure) {
        const { error } = failure;
        return {
          ...this.describe(),
          ok: false,
          runId: parsed.runId,
          files,
          transfer: {
            selected: selected.length,
            downloaded: files.filter((file) => !file.reused).length,
            reused: files.filter((file) => file.reused).length,
            remaining: selected.length - files.length,
          },
          error: {
            code: "WORKSPACE_DOWNLOAD_INCOMPLETE",
            fileId: failure.file.fileId ?? failure.file.id,
            message:
              error instanceof Error
                ? error.message
                : "Download failed; complete files remain usable",
          },
        };
      }
      return {
        ...this.describe(),
        runId: parsed.runId,
        files,
        transfer: {
          selected: selected.length,
          downloaded: files.filter((file) => !file.reused).length,
          reused: files.filter((file) => file.reused).length,
          remaining: 0,
        },
      };
    }
  }
  private artifactPath(ref: ArtifactRef, runId?: string) {
    return join(
      runId
        ? join(this.basePath, "runs", segment(runId))
        : join(this.basePath, "work", "downloads"),
      filename(ref),
    );
  }
  private async save() {
    const content = JSON.stringify(this.index, null, 2);
    const write = this.writes.then(async () => {
      try {
        await this.writeIndex(content);
        this.persistenceFailed = false;
      } catch (error) {
        this.persistenceFailed = true;
        throw error;
      }
    });
    this.writes = write.catch(() => undefined);
    return write;
  }
  private async writeIndex(content: string) {
    const temporary = `${this.indexPath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, content, {
        flag: "wx",
      });
      await rename(temporary, this.indexPath);
    } finally {
      await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
  }
}
