import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  writeFile,
  unlink,
  stat,
} from "node:fs/promises";
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

const IndexSchema = z.strictObject({
  kind: z.literal("analog-canvas-workspace"),
  schemaVersion: z.literal(1),
  serverUrl: z.string(),
  projectId: z.string(),
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
type Index = z.infer<typeof IndexSchema>;
export type WorkspaceScope = {
  serverUrl: string;
  projectId: string;
  sessionId: string;
};
type FetchArtifact = (ref: ArtifactRef, offset: number) => Promise<Response>;
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
    segment(scope.projectId),
  );
}
async function readIndex(path: string): Promise<Index | null> {
  try {
    if ((await stat(path)).size > 16 * 1024 * 1024)
      throw new Error("WORKSPACE_INDEX_TOO_LARGE");
    return IndexSchema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error("WORKSPACE_INDEX_INVALID", { cause: error });
  }
}

/** One local index, immutable run files and ordinary user-owned work files. */
export class LocalWorkspace {
  private writes: Promise<void> = Promise.resolve();
  private constructor(
    readonly basePath: string,
    private index: Index,
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
    if (
      workspace.index.serverUrl !== new URL(scope.serverUrl).origin ||
      workspace.index.projectId !== scope.projectId
    )
      throw new Error("WORKSPACE_PROJECT_MISMATCH");
    if (!workspace.index.sessions.includes(scope.sessionId)) {
      workspace.index.sessions.push(scope.sessionId);
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
      schemaVersion: 1 as const,
      serverUrl,
      projectId: scope.projectId,
      sessions: [],
      runs: [],
      downloads: [],
    };
    if (index.serverUrl !== serverUrl || index.projectId !== scope.projectId)
      throw new Error("WORKSPACE_PROJECT_MISMATCH");
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
  ) {
    const started = performance.now();
    let remoteWaitMs = 0;
    const directory = runId
      ? join(this.basePath, "runs", segment(runId))
      : join(this.basePath, "work", "downloads");
    const path = join(directory, filename(ref));
    const result = await downloadSimulationArtifact(
      ref,
      path,
      async (offset) => {
        const requested = performance.now();
        try {
          return await fetchArtifact(ref, offset);
        } finally {
          remoteWaitMs += performance.now() - requested;
        }
      },
    );
    const old = this.index.downloads.findIndex((item) => item.path === path);
    const record = { artifact: ref, path, ...(runId ? { runId } : {}) };
    if (old < 0) this.index.downloads.push(record);
    else this.index.downloads[old] = record;
    await this.save();
    return {
      ...result,
      timing: {
        elapsedMs: Math.round(performance.now() - started),
        // Descriptor publication/wait and GET headers; excludes streamed body.
        remoteWaitMs: Math.round(remoteWaitMs),
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
      if (old < 0) this.index.runs.push(parsed);
      else this.index.runs[old] = parsed;
      await this.save();
      const results: Awaited<ReturnType<LocalWorkspace["download"]>>[] = [];
      let next = 0;
      let failure: { file: ArtifactRef; error: unknown } | undefined;
      // Two rolling slots, not two-file barriers. Stop scheduling on failure,
      // settle already-started writes and retain deterministic catalog order.
      const worker = async () => {
        while (!failure && next < selected.length) {
          const index = next++;
          const file = selected[index]!;
          try {
            results[index] = await this.download(
              file,
              fetchArtifact,
              parsed.runId,
            );
          } catch (error) {
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
  private async save() {
    const content = JSON.stringify(this.index, null, 2);
    const write = this.writes.then(() => this.writeIndex(content));
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
