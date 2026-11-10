import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { AGENT_REVIEW_SKILL } from "@icm/agent-adapter";
import { InstallationFailure } from "./installation-diagnostics.js";

/** Where each host loads personal Skills: Codex, and Claude Code for `config`. */
const PROFILES = { codex: ".agents", config: ".claude" } as const;
const MARKER = ".analog-canvas-skill.json";
const MARKER_FORMAT = "analog-canvas-skill-v1";
/** What the 0.17.97-0.17.103 archives installed, before the marker existed. */
const UNMARKED_RELEASE: Record<string, string> = {
  "SKILL.md":
    "b8d79ef7fb7d87cb148cb61ee456bbd016e3a9336ffb43267f95192ffaa13bb9",
  "agents/openai.yaml":
    "61f1ee6a7c1d1990a7b3d4d48b51da760e0b8aedbe2ace6766a955e5c18af222",
};

const sha256 = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

async function readIfPresent(path: string) {
  try {
    return await readFile(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTDIR" && code !== "EISDIR")
      throw error;
  }
}

/** Every file under `root`, as relative POSIX paths; links count as files. */
async function filesUnder(root: string, folder = ""): Promise<string[]> {
  const entries = await readdir(join(root, folder), { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const file = folder ? `${folder}/${entry.name}` : entry.name;
      return entry.isDirectory() ? filesUnder(root, file) : [file];
    }),
  );
  return nested.flat();
}

/**
 * The digests of this installer's unedited copy at `path`; null when nothing
 * is there; "other" for anything else, including an edited copy or one with
 * files of the user's own.
 */
async function installedCopy(
  path: string,
): Promise<Record<string, string> | null | "other"> {
  const entry = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!entry) return null;
  if (!entry.isDirectory()) return "other";
  let written = UNMARKED_RELEASE;
  const marker = await readIfPresent(join(path, MARKER));
  if (marker) {
    const parsed = (() => {
      try {
        return JSON.parse(marker.toString("utf8")) as {
          format?: unknown;
          name?: unknown;
          files?: Record<string, string>;
        };
      } catch {
        return null;
      }
    })();
    if (
      parsed?.format !== MARKER_FORMAT ||
      parsed.name !== AGENT_REVIEW_SKILL.name ||
      !parsed.files
    )
      return "other";
    written = parsed.files;
  }
  for (const [file, digest] of Object.entries(written)) {
    const bytes = await readIfPresent(join(path, file));
    if (!bytes || sha256(bytes) !== digest) return "other";
  }
  // An update replaces the folder, so it must hold nothing else.
  if (
    (await filesUnder(path)).some((file) => file !== MARKER && !written[file])
  )
    return "other";
  return written;
}

const sameFiles = (a: Record<string, string>, b: Record<string, string>) =>
  Object.keys(a).length === Object.keys(b).length &&
  Object.entries(a).every(([file, digest]) => b[file] === digest);

function occupied(path: string) {
  return new InstallationFailure(
    "skill-config",
    "SKILL_PATH_OCCUPIED",
    `MCP was registered; ${path} holds a ${AGENT_REVIEW_SKILL.name} Skill this installer did not write, or one edited since. Move it aside and run the command again to install the Canvas one.`,
    "stop",
  );
}

/**
 * Install the review Skill, or update a copy this installer wrote. A Skill it
 * did not write, or one edited since, stays untouched.
 */
export async function installReviewSkill(
  home: string,
  host: keyof typeof PROFILES,
  files: Record<string, Buffer>,
) {
  const profile = join(home, PROFILES[host]);
  const skills = join(profile, "skills");
  const path = join(skills, AGENT_REVIEW_SKILL.name);
  const wanted = Object.fromEntries(
    Object.entries(files).map(([file, bytes]) => [file, sha256(bytes)]),
  );
  const current = await installedCopy(path);
  if (current === "other") throw occupied(path);
  if (current && sameFiles(current, wanted))
    return { path, status: "already-current" as const };

  await mkdir(skills, { recursive: true });
  // Staged beside the skills directory, so a host never loads half a copy.
  const staged = await mkdtemp(join(profile, `.${AGENT_REVIEW_SKILL.name}-`));
  const previous = `${staged}-previous`;
  try {
    for (const [file, bytes] of Object.entries(files)) {
      await mkdir(dirname(join(staged, file)), { recursive: true });
      await writeFile(join(staged, file), bytes);
    }
    await writeFile(
      join(staged, MARKER),
      `${JSON.stringify({ format: MARKER_FORMAT, name: AGENT_REVIEW_SKILL.name, files: wanted })}\n`,
    );
    if (current) await rename(path, previous);
    try {
      await rename(staged, path);
    } catch (error) {
      if (current) {
        await rename(previous, path);
        throw error;
      }
      // Another installer won the race: keep its copy if it is this one.
      const concurrent = await installedCopy(path);
      if (concurrent === "other") throw occupied(path);
      if (concurrent && sameFiles(concurrent, wanted))
        return { path, status: "already-current" as const };
      throw error;
    }
    if (!current) return { path, status: "installed" as const };
    await rm(previous, { recursive: true, force: true });
    return { path, status: "updated" as const };
  } finally {
    await rm(staged, { recursive: true, force: true });
  }
}
