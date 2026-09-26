import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";

const BindingSchema = z.strictObject({
  version: z.literal(1),
  apiBaseUrl: z.string().url(),
  sessionId: z.string().min(1),
  workspaceId: z.string().min(1),
  projectId: z.string().min(1),
});
export type WorkspaceBinding = z.infer<typeof BindingSchema>;

/** Task-local target identity, never credentials or cached document revisions. */
export class WorkspaceBindingStore {
  constructor(readonly path: string) {}

  async load(): Promise<WorkspaceBinding | null> {
    try {
      return BindingSchema.parse(JSON.parse(await readFile(this.path, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new Error(
        "The saved workspace binding cannot be read; clear or rebind the task target",
        { cause: error },
      );
    }
  }

  async save(binding: WorkspaceBinding): Promise<void> {
    const value = BindingSchema.parse(binding);
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${crypto.randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(value)}\n`, {
        mode: 0o600,
        flag: "wx",
      });
      await rename(temporary, this.path);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  async clear(): Promise<void> {
    await rm(this.path, { force: true });
  }
}
