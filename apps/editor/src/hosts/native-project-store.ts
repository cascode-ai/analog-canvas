// File bridge/outcome flow adapted from LXY-freshman/schematic-draft @ 5231840f.
// AGPL-3.0-only; exact originals and changes: apps/desktop/SOURCES.md.
import type { CircuitProject } from "@icm/model";
import { serializeProject } from "@icm/project-protocol";
import { projectFileBaseName } from "../document/project-file-service";

export interface NativeFileBinding {
  id: string;
  revision: number;
  name: string;
  path: string;
}
export type RecentProjectFile = Omit<NativeFileBinding, "revision">;
type Failure = { status: "failed" | "conflict"; message: string };
export type NativeSaveOutcome =
  | { status: "saved"; file: NativeFileBinding; warning?: string }
  | { status: "cancelled" }
  | Failure;
export interface NativeProjectStore {
  open(
    recentId?: string,
  ): Promise<
    | { status: "opened"; file: NativeFileBinding; text: string }
    | { status: "cancelled" }
    | Failure
  >;
  recent(): Promise<RecentProjectFile[]>;
  forget(id: string): Promise<void>;
  release(id: string): Promise<void>;
  save(
    project: CircuitProject,
    binding: NativeFileBinding | null,
    saveAs?: boolean,
  ): Promise<NativeSaveOutcome>;
}
function binding(value: unknown): value is NativeFileBinding {
  const file = value as Partial<NativeFileBinding> | null;
  return (
    !!file &&
    typeof file.id === "string" &&
    file.id.length > 0 &&
    typeof file.name === "string" &&
    typeof file.path === "string" &&
    typeof file.revision === "number" &&
    Number.isSafeInteger(file.revision) &&
    file.revision > 0
  );
}
async function post(route: string, body?: unknown, recentId?: string) {
  const response = await fetch(`/desktop/project/${route}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(recentId ? { "x-recent-project": recentId } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok)
    throw new Error(`File operation failed (${response.status})`);
  return (await response.json()) as Record<string, unknown>;
}
const failure = (value: unknown): Failure => ({
  status: "failed",
  message: value instanceof Error ? value.message : "Invalid file response",
});
function unsuccessful(
  body: Record<string, unknown>,
): Failure | { status: "cancelled" } {
  if (body.status === "cancelled") return { status: "cancelled" };
  return {
    status: body.status === "conflict" ? "conflict" : "failed",
    message:
      typeof body.message === "string" ? body.message : "File operation failed",
  };
}
export function createNativeProjectStore(): NativeProjectStore {
  return {
    async recent() {
      const body = await post("recent");
      if (!Array.isArray(body.files))
        throw new Error("Could not read recent Projects");
      return body.files.filter(
        (file): file is RecentProjectFile =>
          !!file &&
          typeof file.id === "string" &&
          typeof file.name === "string" &&
          typeof file.path === "string",
      );
    },
    async forget(id) {
      await post("forget", { id });
    },
    async release(id) {
      await post("release", { id });
    },
    async open(recentId) {
      try {
        const body = await post("open", undefined, recentId);
        return body.status === "opened" &&
          binding(body.file) &&
          typeof body.text === "string"
          ? { status: "opened", file: body.file, text: body.text }
          : unsuccessful(body);
      } catch (error) {
        return failure(error);
      }
    },
    async save(project, file, saveAs = false) {
      try {
        const body = await post("save", {
          text: serializeProject(project),
          name: `${projectFileBaseName(project.name)}.icproj.json`,
          binding: file,
          saveAs,
        });
        return body.status === "saved" && binding(body.file)
          ? {
              status: "saved",
              file: body.file,
              ...(typeof body.warning === "string"
                ? { warning: body.warning }
                : {}),
            }
          : unsuccessful(body);
      } catch (error) {
        return failure(error);
      }
    },
  };
}
