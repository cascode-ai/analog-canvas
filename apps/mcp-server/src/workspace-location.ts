import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { z } from "zod";

export function userWorkspaceRoot(
  env: Record<string, string | undefined> = process.env,
  platform = process.platform,
  home = homedir(),
): string {
  const base =
    platform === "win32"
      ? env.LOCALAPPDATA || join(home, "AppData", "Local")
      : platform === "darwin"
        ? join(home, "Library", "Application Support")
        : env.XDG_DATA_HOME || join(home, ".local", "share");
  if (!isAbsolute(base))
    throw new Error("WORKSPACE_DATA_ROOT_MUST_BE_ABSOLUTE");
  return join(base, "analog-canvas", "workspaces");
}

const Location = z.strictObject({
  schemaVersion: z.literal(1),
  basePath: z.string().refine(isAbsolute),
});

/** One small pointer per server/Project. No credentials, global scans or migration. */
export async function savedWorkspacePath(
  defaultPath: string,
): Promise<string | undefined> {
  try {
    return Location.parse(
      JSON.parse(await readFile(join(defaultPath, "location.json"), "utf8")),
    ).basePath;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error("WORKSPACE_LOCATION_INVALID", { cause: error });
  }
}

export async function rememberWorkspacePath(
  defaultPath: string,
  basePath: string,
): Promise<void> {
  if ((await savedWorkspacePath(defaultPath)) === basePath) return;
  await mkdir(defaultPath, { recursive: true });
  const temporary = join(defaultPath, `location-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify({ schemaVersion: 1, basePath }), {
      flag: "wx",
    });
    await rename(temporary, join(defaultPath, "location.json"));
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}
