import { z } from "zod";
import {
  ArtifactRefSchema,
  Id,
  problem,
  type ArtifactRef,
  type Problem,
} from "./contract.js";

export const MAX_SIMULATION_INPUT_BYTES = 1024 * 1024;
const TTL = 15 * 60_000;
export const WorkspaceSchema = z.strictObject({
  id: Id,
  revision: z.number().int().nonnegative(),
  entry: z.string().nullable(),
  files: z.array(z.strictObject({ path: z.string(), text: z.string() })),
  expiresAt: z.number(),
});
export type Workspace = z.infer<typeof WorkspaceSchema>;
export const SimulationFileOperationSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("create") }),
  z.strictObject({ action: z.literal("read"), workspaceId: Id }),
  z.strictObject({ action: z.literal("discard"), workspaceId: Id }),
  z.strictObject({
    action: z.literal("update"),
    workspaceId: Id,
    expectedRevision: z.number().int().nonnegative(),
    entry: z.string().optional(),
    writes: z
      .array(z.strictObject({ path: z.string(), text: z.string() }))
      .max(24)
      .default([]),
    removes: z.array(z.string()).max(24).default([]),
  }),
  z.strictObject({
    action: z.literal("artifact"),
    artifactId: Id,
    offset: z.number().int().nonnegative().default(0),
    maxChars: z.number().int().positive().max(65536).default(65536),
  }),
]);
export type SimulationFileOperation = z.infer<
  typeof SimulationFileOperationSchema
>;
export const SimulationFileResultSchema = z.union([
  z.strictObject({ ok: z.literal(true), workspace: WorkspaceSchema }),
  z.strictObject({ ok: z.literal(true), discarded: z.literal(true) }),
  z.strictObject({
    ok: z.literal(true),
    artifact: ArtifactRefSchema,
    text: z.string(),
    offset: z.number().int().nonnegative(),
    nextOffset: z.number().int().nonnegative().nullable(),
  }),
]);
export async function sha256(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(bytes)]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
export function safeInputPath(path: string): boolean {
  return (
    path.length > 0 &&
    path.length <= 240 &&
    !path.startsWith("/") &&
    !/[\\:\u0000-\u001f]/u.test(path) &&
    path.split("/").every((p) => p !== "" && p !== "." && p !== "..") &&
    path.toLowerCase() !== ".spiceinit"
  );
}

/** File Resource owns mutable drafts and immutable artifact bytes. No Project mutation. */
export class SimulationFiles {
  private epoch = 0;
  private workspaces = new Map<string, Workspace>();
  private artifacts = new Map<
    string,
    { ref: ArtifactRef; text: string; expiresAt: number }
  >();
  constructor(private now: () => number = Date.now) {}
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
  ): Promise<
    z.infer<typeof SimulationFileResultSchema> | { ok: false; error: Problem }
  > {
    this.prune();
    const parsed = SimulationFileOperationSchema.safeParse(input);
    if (!parsed.success)
      return problem(
        "SIMULATION_FILE_INVALID",
        parsed.error.issues[0]?.message ?? "Invalid file operation",
        "input",
      );
    const op = parsed.data;
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
    const workspace = this.workspaces.get(op.workspaceId);
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
    if (op.action === "read")
      return { ok: true as const, workspace: structuredClone(workspace) };
    if (op.expectedRevision !== workspace.revision)
      return problem(
        "WORKSPACE_REVISION_CONFLICT",
        "Read the workspace and apply the edit to its current revision",
        "input",
      );
    const files = new Map(workspace.files.map((f) => [f.path, f.text]));
    for (const path of op.removes) files.delete(path);
    for (const file of op.writes) {
      if (!safeInputPath(file.path))
        return problem(
          "INPUT_PATH_INVALID",
          "Use a relative path without parent traversal or reserved runtime names",
          "input",
        );
      files.set(file.path, file.text);
    }
    const entry = op.entry ?? workspace.entry;
    if (entry !== null && !files.has(entry))
      return problem(
        "ENTRY_NOT_FOUND",
        "The entry must name a file in this workspace",
        "input",
      );
    const size = [...files.values()].reduce(
      (n, t) => n + new TextEncoder().encode(t).byteLength,
      0,
    );
    if (files.size > 24 || size > MAX_SIMULATION_INPUT_BYTES)
      return problem(
        "INPUT_TOO_LARGE",
        "At most 24 files and 1 MiB are accepted per workspace",
        "input",
      );
    const next: Workspace = {
      ...workspace,
      revision: workspace.revision + 1,
      entry,
      files: [...files]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([path, text]) => ({ path, text })),
      expiresAt: this.now() + TTL,
    };
    this.workspaces.set(next.id, next);
    return { ok: true as const, workspace: structuredClone(next) };
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
