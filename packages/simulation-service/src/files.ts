import { sha256 } from "./content-digest.js";
import { planSimulationSourceChanges } from "./source-files.js";
import {
  SimulationFileOperationSchema,
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
import { problem, type ArtifactRef, type Problem } from "./contract.js";

export { MAX_SIMULATION_INPUT_BYTES };
const TTL = 15 * 60_000;
export { sha256 } from "./content-digest.js";
export function safeInputPath(path: string): boolean {
  return isSimulationInputPath(path);
}

/** One File Resource; session storage is local, Project edits use host transactions. */
export class SimulationFiles {
  private epoch = 0;
  private workspaces = new Map<string, Workspace>();
  private artifacts = new Map<
    string,
    { ref: ArtifactRef; text: string; expiresAt: number }
  >();
  constructor(
    private now: () => number = Date.now,
    private projectHost?: ProjectSimulationFileHost,
  ) {}
  clear() {
    this.epoch++;
    this.workspaces.clear();
    this.artifacts.clear();
  }
  private prune() {
    const now = this.now();
    for (const [id, w] of this.workspaces)
      if (w.expiresAt <= now) this.workspaces.delete(id);
    for (const [id, a] of this.artifacts)
      if (a.expiresAt <= now) this.artifacts.delete(id);
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
        expiresAt: this.now() + TTL,
      };
      this.workspaces.set(workspace.id, workspace);
      return { ok: true as const, workspace: structuredClone(workspace) };
    }
    if (op.action === "artifact") {
      const item = this.artifacts.get(op.artifactId);
      if (!item)
        return problem(
          "ARTIFACT_UNAVAILABLE",
          "Artifact expired or was not created in this session",
          "export",
          "not-retryable",
        );
      if (op.offset > item.text.length)
        return problem(
          "ARTIFACT_OFFSET_INVALID",
          "Offset exceeds artifact length",
          "export",
        );
      const end = Math.min(item.text.length, op.offset + op.maxChars);
      return {
        ok: true as const,
        artifact: item.ref,
        text: item.text.slice(op.offset, end),
        offset: op.offset,
        nextOffset: end < item.text.length ? end : null,
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
    if (op.expectedRevision !== workspace.revision)
      return problem(
        "WORKSPACE_REVISION_CONFLICT",
        "Read the workspace and apply the edit to its current revision",
        "input",
      );
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
    });
    if (!planned.ok) return planned;
    this.prune();
    if (this.workspaces.get(workspace.id) !== workspace)
      return problem(
        "WORKSPACE_REVISION_CONFLICT",
        "Workspace changed while applying patches; read it again",
        "input",
      );
    const files = new Map(planned.files.map((file) => [file.path, file.text]));
    const entry = op.entry ?? workspace.entry;
    const configPath = op.configPath ?? workspace.configPath;
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
      revision: workspace.revision + 1,
      entry,
      configPath,
      files: [...files]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([path, text]) => ({ path, text })),
      expiresAt: this.now() + TTL,
    };
    this.workspaces.set(next.id, next);
    return this.listWorkspace(next);
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
  ): Promise<ArtifactRef> {
    const epoch = this.epoch;
    const digest = await sha256(text);
    if (epoch !== this.epoch) throw new Error("SESSION_CHANGED");
    this.prune();
    const byteLength = new TextEncoder().encode(text).byteLength;
    if (
      byteLength > 4 * 1024 * 1024 ||
      this.artifacts.size >= 256 ||
      [...this.artifacts.values()].reduce((n, a) => n + a.ref.byteLength, 0) +
        byteLength >
        16 * 1024 * 1024
    )
      throw new Error("ARTIFACT_CAPACITY");
    const ref: ArtifactRef = {
      id: crypto.randomUUID(),
      name,
      mediaType,
      byteLength,
      sha256: digest,
    };
    this.artifacts.set(ref.id, { ref, text, expiresAt: this.now() + TTL });
    return ref;
  }
}
