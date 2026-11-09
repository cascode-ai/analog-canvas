import {
  lstat,
  mkdir,
  mkdtemp,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { InstallationFailure } from "./installation-diagnostics.js";

async function statIfPresent(path: string, follow = false) {
  try {
    return await (follow ? stat(path) : lstat(path));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function existingSkill(path: string) {
  const entry = await statIfPresent(path);
  if (!entry) return;
  if (entry.isDirectory() || entry.isSymbolicLink()) {
    const skillFile = await statIfPresent(join(path, "SKILL.md"), true);
    if (skillFile?.isFile())
      return { path, status: "already-present" as const };
  }
  throw new InstallationFailure(
    "skill-config",
    "SKILL_PATH_OCCUPIED",
    "MCP was registered; the review skill path is occupied by another entry",
    "stop",
  );
}

export async function installCodexReviewSkill(
  home: string,
  files: { guidance: Buffer; metadata: Buffer },
) {
  const profile = join(home, ".agents");
  const skills = join(profile, "skills");
  const path = join(skills, "canvas-review");
  const existing = await existingSkill(path);
  if (existing) return existing;

  await mkdir(skills, { recursive: true });
  const temporary = await mkdtemp(join(profile, ".canvas-review-"));
  try {
    await mkdir(join(temporary, "agents"));
    await writeFile(join(temporary, "SKILL.md"), files.guidance);
    await writeFile(join(temporary, "agents", "openai.yaml"), files.metadata);
    try {
      await rename(temporary, path);
    } catch (error) {
      const concurrent = await existingSkill(path);
      if (concurrent) return concurrent;
      throw error;
    }
    return { path, status: "installed" as const };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
