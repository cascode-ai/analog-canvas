// File bridge/outcome flow adapted from LXY-freshman/schematic-draft @ 5231840f.
// AGPL-3.0-only; exact originals and changes: apps/desktop/SOURCES.md.
import type { CircuitProject } from "@icm/model";
import { serializeProject } from "@icm/project-protocol";
import { projectFileBaseName } from "../document/project-file-service";
import { nativeProjectRequest as post } from "./native-project-request";

export interface NativeFileBinding {
  id: string;
  revision: number;
  name: string;
  path: string;
  byteDigest?: string;
}
export type RecentProjectFile = Omit<
  NativeFileBinding,
  "revision" | "byteDigest"
>;
type Failure = { status: "failed" | "conflict"; message: string };
export type NativeSaveOutcome =
  | { status: "saved"; file: NativeFileBinding; warning?: string }
  | { status: "cancelled" }
  | Failure;
export interface NativeProjectStore {
  nextLaunch?(): Promise<string | null>;
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
    intoLibrary?: boolean,
    creationKey?: string,
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
const failure = (value: unknown): Failure => ({
  status: "failed",
  message: value instanceof Error ? value.message : "Invalid file response",
});
export async function resumeNativeFile(
  path: string,
  byteDigest: string | undefined,
): Promise<NativeFileBinding> {
  const body = await post("resume", { path, byteDigest });
  if (body.status !== "opened" || !binding(body.file))
    throw new Error(
      typeof body.message === "string"
        ? body.message
        : "File cannot be rebound",
    );
  return body.file;
}
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
    async nextLaunch() {
      const body = await post("next-launch");
      if (body.status === "empty") return null;
      if (body.status === "queued" && typeof body.id === "string")
        return body.id;
      throw new Error(
        typeof body.message === "string"
          ? body.message
          : "Could not open the requested file",
      );
    },
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
      const result = await post("forget", { id });
      if (result.status !== "done")
        throw new Error(
          String(result.message ?? "Could not remove recent Project"),
        );
    },
    async release(id) {
      const result = await post("release", { id });
      if (result.status !== "done")
        throw new Error(
          String(result.message ?? "Could not close Project file"),
        );
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
    async save(
      project,
      file,
      saveAs = false,
      intoLibrary = false,
      creationKey,
    ) {
      try {
        const body = await post("save", {
          text: serializeProject(project),
          name: `${projectFileBaseName(project.name)}.icproj.json`,
          binding: file,
          saveAs,
          intoLibrary,
          creationKey,
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
