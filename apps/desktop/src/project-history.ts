import { randomUUID } from "node:crypto";
import { mkdir, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { readLimited, writeDurable } from "./durable-files.js";
import { parseProject } from "@icm/project-protocol";

interface Version {
  id: string;
  savedAt: number;
}
interface Manifest {
  version: 1;
  versions: Version[];
  pending?: { before: string | null; after: string; versions: Version[] };
}
const validId = (id: unknown): id is string =>
  typeof id === "string" && /^[a-f0-9-]{36}$/u.test(id);
const validVersions = (value: unknown): value is Version[] =>
  Array.isArray(value) &&
  value.length <= 3 &&
  value.every((v) => v && validId(v.id) && Number.isFinite(v.savedAt));

/** The journal is durable before the Project replacement. Recovery compares bytes,
 * so a process exit on either side of rename never invents a committed version. */
export function projectHistory(directory: string, projectPath: string) {
  const manifestPath = join(directory, "manifest.json");
  const snapshotPath = (id: string) => join(directory, `${id}.icproj.json`);
  async function current() {
    try {
      return await readLimited(projectPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
  async function clean(manifest: Manifest) {
    const keep = new Set(manifest.versions.map((v) => `${v.id}.icproj.json`));
    for (const name of await readdir(directory))
      if (/^[a-f0-9-]{36}\.icproj\.json$/u.test(name) && !keep.has(name))
        await unlink(join(directory, name));
  }
  async function load(recoverCreation = false): Promise<Manifest> {
    let manifest: Manifest;
    try {
      manifest = JSON.parse(
        (await readLimited(manifestPath, 16384)).toString("utf8"),
      ) as Manifest;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { version: 1, versions: [] };
      throw error;
    }
    if (
      manifest.version !== 1 ||
      !validVersions(manifest.versions) ||
      (manifest.pending &&
        (!validId(manifest.pending.after) ||
          (manifest.pending.before !== null &&
            !validId(manifest.pending.before)) ||
          !validVersions(manifest.pending.versions)))
    )
      throw new Error("Save history is damaged; preserve it before retrying");
    if (manifest.pending) {
      const bytes = await current();
      const after = await readLimited(snapshotPath(manifest.pending.after));
      const before =
        manifest.pending.before === null
          ? null
          : await readLimited(snapshotPath(manifest.pending.before));
      if (recoverCreation && bytes === null && before === null) {
        parseProject(after.toString("utf8"));
        await writeDurable(projectPath, after);
        manifest = { version: 1, versions: manifest.pending.versions };
      } else if (bytes?.equals(after))
        manifest = { version: 1, versions: manifest.pending.versions };
      else if (
        bytes === null
          ? before === null
          : before !== null && bytes.equals(before)
      )
        manifest = { version: 1, versions: manifest.versions };
      else
        throw new Error(
          "An interrupted save conflicts with the current file. History is retained; save a separate copy.",
        );
      await writeDurable(manifestPath, JSON.stringify(manifest));
    }
    // Cleanup is maintenance, never part of acknowledging the Project write.
    await clean(manifest).catch(() => {});
    return manifest;
  }
  return {
    async list() {
      const manifest = await load();
      return Promise.all(
        manifest.versions.map(async (version) => ({
          ...version,
          text: (await readLimited(snapshotPath(version.id))).toString("utf8"),
        })),
      );
    },
    async prepare(before: Buffer | null, after: Buffer, independent = false) {
      const manifest = await load();
      if (before?.equals(after)) return;
      await mkdir(directory, { recursive: true });
      const previous =
        before === null ? null : { id: randomUUID(), savedAt: Date.now() };
      if (previous && before)
        await writeDurable(snapshotPath(previous.id), before);
      const nextId = randomUUID();
      await writeDurable(snapshotPath(nextId), after);
      await writeDurable(
        manifestPath,
        JSON.stringify({
          ...manifest,
          pending: {
            before: previous?.id ?? null,
            after: nextId,
            versions:
              !independent && previous
                ? [previous, ...manifest.versions].slice(0, 3)
                : [],
          },
        } satisfies Manifest),
      );
    },
    async finish() {
      await load();
    },
    async recoverCreation() {
      await load(true);
    },
  };
}
