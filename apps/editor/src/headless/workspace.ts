import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createEmptyProject, type CircuitProject } from "@icm/model";
import { parseProject, serializeProject } from "@icm/project-protocol";
import type { NetlistProfileId } from "../features/netlist-export/netlist-process-presets";
import { createLocalEditor, type LocalEditor } from "./local-editor";

/** One Project per directory: this file, read and written whole (#1498). */
export const WORKSPACE_PROJECT_FILE = "project.icproj.json";
/** The netlist a drawing is checked against, when the workspace has one. */
export const WORKSPACE_REFERENCE_FILE = "reference.sp";
const LOCK_FILE = ".lock";

export function workspaceProjectPath(dir: string): string {
  return join(dir, WORKSPACE_PROJECT_FILE);
}

/**
 * A new workspace with one empty Cell, `main`, and the reference netlist it
 * is drawn against, if any. An existing workspace is never overwritten.
 */
export async function createWorkspace(
  dir: string,
  options: { name?: string; reference?: string } = {},
): Promise<CircuitProject> {
  await mkdir(dir, { recursive: true });
  const project = createEmptyProject(
    `project-${randomUUID()}`,
    options.name ?? "Untitled",
  );
  project.documents[0]!.id = "main";
  project.topDocumentId = "main";
  const handle = await open(workspaceProjectPath(dir), "wx").catch(
    (error: NodeJS.ErrnoException) => {
      throw error.code === "EEXIST"
        ? new Error(`${dir} already holds a workspace`)
        : error;
    },
  );
  try {
    await handle.writeFile(serializeProject(project));
  } finally {
    await handle.close();
  }
  if (options.reference !== undefined)
    await writeFile(join(dir, WORKSPACE_REFERENCE_FILE), options.reference);
  return project;
}

export async function readWorkspace(dir: string): Promise<CircuitProject> {
  const text = await readFile(workspaceProjectPath(dir), "utf8").catch(
    (error: NodeJS.ErrnoException) => {
      throw error.code === "ENOENT"
        ? new Error(`${dir} holds no workspace; create one first`)
        : error;
    },
  );
  return parseProject(text);
}

/** Written beside the file and renamed over it, so no reader sees half. */
export async function writeWorkspace(
  dir: string,
  project: CircuitProject,
): Promise<void> {
  const path = workspaceProjectPath(dir);
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, serializeProject(project));
  await rename(temporary, path);
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Hold a workspace for this process. Another live process holding it is
 * refused by name, so two workers never interleave edits on one file; a lock
 * left by a process that has exited passes on. Different workspaces never
 * contend, so workers parallelise freely across directories.
 */
export async function lockWorkspace(dir: string): Promise<() => Promise<void>> {
  const path = join(dir, LOCK_FILE);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(path, "wx");
      await handle.writeFile(String(process.pid));
      await handle.close();
      return async () => {
        const holder = Number(await readFile(path, "utf8").catch(() => "0"));
        if (holder === process.pid) await rm(path, { force: true });
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const holder = Number(await readFile(path, "utf8").catch(() => "0"));
      if (holder && holder !== process.pid && processAlive(holder))
        throw new Error(
          `${dir} is in use by process ${holder}; wait for it or use another workspace`,
        );
      await rm(path, { force: true });
    }
  }
  throw new Error(`${dir} could not be locked`);
}

export interface LocalWorkspace {
  readonly dir: string;
  readonly editor: LocalEditor;
  /** Write the Project if a call changed it; true when it wrote. */
  save(): Promise<boolean>;
  /** Save, then let another process have the workspace. */
  close(): Promise<void>;
}

/** Lock a workspace and serve its Project through the editor's own host. */
export async function openLocalWorkspace(
  dir: string,
  options: { process?: NetlistProfileId } = {},
): Promise<LocalWorkspace> {
  const release = await lockWorkspace(dir);
  try {
    const editor = createLocalEditor({
      project: await readWorkspace(dir),
      ...(options.process ? { process: options.process } : {}),
    });
    let saved = editor.project;
    const save = async () => {
      const current = editor.project;
      if (current === saved) return false;
      await writeWorkspace(dir, current);
      saved = current;
      return true;
    };
    return {
      dir,
      editor,
      save,
      close: async () => {
        try {
          await save();
        } finally {
          await release();
        }
      },
    };
  } catch (error) {
    await release();
    throw error;
  }
}
