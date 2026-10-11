import { createHash, randomUUID } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  readdir,
  realpath,
  rename,
  rm,
  unlink,
} from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { readLimited, writeDurable } from "./durable-files.js";
import { projectHistory } from "./project-history.js";
import { parseProject } from "@icm/project-protocol";

const pathKey = (path: string) =>
  process.platform === "win32" ? path.toLowerCase() : path;

export interface LibraryProject {
  id: string;
  name: string;
  path: string;
  modified: number;
  error?: string;
  warning?: string;
  favorite: boolean;
  recycled: boolean;
}
interface LibraryRoot {
  id: string;
  path: string;
}
interface LibrarySettings {
  active: string;
  roots: LibraryRoot[];
}

/** Owns user-selected directories. Renderer identifiers never authorize a path. */
export function createProjectLibrary(options: {
  stateDirectory: string;
  defaultRoot: string;
}) {
  const settingsPath = join(options.stateDirectory, "project-library.json");
  let settings: LibrarySettings | undefined;
  const persist = async (value: LibrarySettings) => {
    await mkdir(options.stateDirectory, { recursive: true });
    await writeDurable(settingsPath, JSON.stringify(value));
    settings = value;
  };
  const load = async (): Promise<LibrarySettings> => {
    if (settings) return settings;
    try {
      if ((await lstat(settingsPath)).size > 1024 * 1024)
        throw new Error("Project library settings exceed the size limit");
      const value = JSON.parse(
        (await readLimited(settingsPath, 1024 * 1024)).toString("utf8"),
      ) as LibrarySettings;
      if (
        !Array.isArray(value.roots) ||
        !value.roots.length ||
        value.roots.some(
          (root) =>
            !root ||
            typeof root.id !== "string" ||
            !/^[a-f0-9-]{36}$/u.test(root.id) ||
            typeof root.path !== "string" ||
            !isAbsolute(root.path),
        ) ||
        !value.roots.some((root) => root.id === value.active)
      ) {
        throw new Error(
          "Project library settings are damaged; choose a project directory",
        );
      }
      settings = value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await mkdir(options.defaultRoot, { recursive: true });
      const root = {
        id: randomUUID(),
        path: await realpath(options.defaultRoot),
      };
      await persist({ active: root.id, roots: [root] });
    }
    if (!settings) throw new Error("Project library could not be initialized");
    return settings;
  };
  const activeRoot = (value: LibrarySettings) => {
    const root = value.roots.find((root) => root.id === value.active);
    if (!root) throw new Error("The active project directory is unavailable");
    return root;
  };
  const list = async () => {
    const value = await load();
    const projects: LibraryProject[] = [];
    for (const root of value.roots) {
      for (const recycled of [false, true]) {
        const scanRoot = recycled ? join(root.path, ".recycle") : root.path;
        let directories;
        try {
          if (pathKey(await realpath(scanRoot)) !== pathKey(scanRoot))
            throw new Error("Project directory moved");
          directories = await readdir(scanRoot, { withFileTypes: true });
        } catch {
          if (!recycled)
            projects.push({
              id: `library:${root.id}`,
              name: "Unavailable project directory",
              path: root.path,
              modified: 0,
              favorite: false,
              recycled: false,
              error: "Locate this directory or choose another one",
            });
          continue;
        }
        for (const directory of directories) {
          if (
            !directory.isDirectory() ||
            directory.isSymbolicLink() ||
            directory.name.startsWith(".")
          )
            continue;
          const path = join(scanRoot, directory.name, "project.icproj.json");
          const entry: LibraryProject = {
            id: `library:${root.id}:${recycled ? "recycle:" : ""}${directory.name}`,
            name: directory.name,
            path,
            modified: 0,
            favorite: false,
            recycled,
          };
          try {
            if (
              pathKey(await realpath(dirname(path))) !== pathKey(dirname(path))
            )
              throw new Error("Project directory moved");
            const pending = join(dirname(path), ".pending-create");
            try {
              const marker = await lstat(pending);
              if (!marker.isFile() || marker.isSymbolicLink())
                throw new Error("Invalid creation marker");
              let wasMissing = false;
              try {
                await lstat(path);
              } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ENOENT")
                  throw error;
                wasMissing = true;
              }
              await projectHistory(
                join(dirname(path), ".history"),
                path,
              ).recoverCreation();
              await lstat(path);
              await unlink(pending);
              if (wasMissing)
                entry.warning = "Recovered an interrupted first save";
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== "ENOENT")
                throw error;
            }
            const stat = await lstat(path);
            if (
              !stat.isFile() ||
              stat.isSymbolicLink() ||
              stat.size > 16 * 1024 * 1024
            )
              throw new Error("Invalid or oversized Project file");
            entry.modified = stat.mtimeMs;
            if (
              pathKey(await realpath(dirname(path))) !== pathKey(dirname(path))
            )
              throw new Error("Project directory moved");
            const project = parseProject(
              (await readLimited(path)).toString("utf8"),
            );
            entry.name = project.name;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
              if (!/^[a-f0-9-]{36}$/u.test(directory.name)) continue;
              entry.error =
                "Project file is missing or its first save was interrupted. Open its folder to inspect retained data.";
            } else
              entry.error =
                error instanceof Error
                  ? error.message
                  : "Could not read Project";
          }
          try {
            const meta = JSON.parse(
              (
                await readLimited(
                  join(dirname(path), ".project-meta.json"),
                  4096,
                )
              ).toString("utf8"),
            );
            entry.favorite = meta.favorite === true;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT")
              entry.warning =
                "Project metadata could not be read; content is retained";
          }
          projects.push(entry);
        }
      }
    }
    return {
      root: activeRoot(value).path,
      roots: value.roots,
      projects: projects.sort((a, b) => b.modified - a.modified),
    };
  };
  async function inspect(id: string) {
    const entry = (await list()).projects.find((project) => project.id === id);
    if (!entry || entry.error)
      throw new Error(entry?.error ?? "Unknown library Project");
    return entry;
  }
  const library = {
    list,
    inspect,
    async locate(id: string) {
      const entry = (await list()).projects.find(
        (project) => project.id === id,
      );
      if (!entry) throw new Error("Unknown library Project");
      return entry.path;
    },
    async archiveReplacement(path: string, bytes: Buffer) {
      const versions = await projectHistory(
        await library.historyDirectory(path),
        path,
      ).list();
      const value = await load();
      const root = activeRoot(value);
      const canonical = await realpath(root.path);
      if (pathKey(canonical) !== pathKey(root.path))
        throw new Error("Project directory moved; choose its current location");
      const recycle = join(canonical, ".recycle");
      await mkdir(recycle, { recursive: true });
      if (pathKey(await realpath(recycle)) !== pathKey(recycle))
        throw new Error("Invalid recycle directory");
      const id = randomUUID();
      const temporary = join(recycle, `.archive-${id}`);
      await mkdir(join(temporary, ".history"), { recursive: true });
      await writeDurable(join(temporary, "project.icproj.json"), bytes);
      for (const version of versions)
        await writeDurable(
          join(temporary, ".history", `${version.id}.icproj.json`),
          version.text,
        );
      await writeDurable(
        join(temporary, ".history", "manifest.json"),
        JSON.stringify({
          version: 1,
          versions: versions.map(({ id, savedAt }) => ({ id, savedAt })),
        }),
      );
      await writeDurable(
        join(temporary, ".project-meta.json"),
        JSON.stringify({ replacedPath: path, favorite: false }),
      );
      await rename(temporary, join(recycle, id));
    },
    async favorite(id: string, favorite: boolean) {
      const entry = await inspect(id);
      if (entry.warning) throw new Error(entry.warning);
      await writeDurable(
        join(dirname(entry.path), ".project-meta.json"),
        JSON.stringify({ favorite }),
      );
    },
    async recycle(id: string, restore = false) {
      const entry = await inspect(id);
      if (entry.recycled === restore) {
        const source = dirname(entry.path);
        const root = restore ? dirname(dirname(source)) : dirname(source);
        const targetRoot = restore ? root : join(root, ".recycle");
        await mkdir(targetRoot, { recursive: true });
        if (pathKey(await realpath(targetRoot)) !== pathKey(targetRoot))
          throw new Error("Project directory moved; no Project was moved");
        const target = join(
          targetRoot,
          relative(restore ? join(root, ".recycle") : root, source),
        );
        try {
          await lstat(target);
          throw new Error(
            "A Project already occupies this location; no Project was replaced",
          );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        await rename(source, target);
      } else throw new Error("Project state changed; refresh the list");
    },
    async purge(id: string) {
      const entry = await inspect(id);
      if (!entry.recycled)
        throw new Error("Only recycled Projects can be removed permanently");
      const source = dirname(entry.path);
      if (dirname(source).split(/[\\/]/u).at(-1) !== ".recycle")
        throw new Error("Invalid recycle location");
      await rm(source, { recursive: true });
    },
    async historyDirectory(path: string) {
      const value = await load();
      if (
        value.roots.some((root) =>
          /^[^\\/]+[\\/]project\.icproj\.json$/u.test(
            relative(root.path, path),
          ),
        )
      )
        return join(dirname(path), ".history");
      const indexPath = join(options.stateDirectory, "external-history.json");
      let index: { path: string; id: string }[] = [];
      try {
        index = JSON.parse(
          (await readLimited(indexPath, 1024 * 1024)).toString("utf8"),
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      if (
        !Array.isArray(index) ||
        index.some(
          (entry) =>
            typeof entry.path !== "string" ||
            !/^[a-f0-9-]{36}$/u.test(entry.id),
        )
      )
        throw new Error("External history index is damaged");
      let entry = index.find((entry) =>
        process.platform === "win32"
          ? entry.path.toLowerCase() === path.toLowerCase()
          : entry.path === path,
      );
      if (!entry) {
        entry = { path, id: randomUUID() };
        index.push(entry);
        await writeDurable(indexPath, JSON.stringify(index));
      }
      return join(options.stateDirectory, "external-history", entry.id);
    },
    async resolve(id: string) {
      const entry = await inspect(id);
      if (entry.recycled)
        throw new Error(
          "Restore the Project from the recycle area before opening",
        );
      return entry.path;
    },
    async allocate(creation?: { key: string; bytes: Buffer }) {
      const value = await load();
      const root = activeRoot(value);
      // A removed library must be explicitly located, never silently recreated.
      const current = await realpath(root.path);
      if (pathKey(current) !== pathKey(root.path))
        throw new Error("Project directory moved; choose its current location");
      let directory: string;
      if (creation) {
        if (!creation.key || creation.key.length > 200)
          throw new Error("Invalid creation identity");
        const hash = createHash("sha256")
          .update(creation.key)
          .digest("hex")
          .slice(0, 32);
        const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20)}`;
        const digest = createHash("sha256")
          .update(creation.bytes)
          .digest("hex");
        directory = join(current, id);
        for (const candidate of value.roots) {
          const previous = join(candidate.path, id);
          try {
            await lstat(previous);
            directory = previous;
            break;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
        }
        await mkdir(directory, { recursive: true });
        if (pathKey(await realpath(directory)) !== pathKey(directory))
          throw new Error("Creation directory moved");
        const record = join(directory, ".creation.json");
        try {
          const previous = JSON.parse(
            (await readLimited(record, 4096)).toString("utf8"),
          );
          if (previous.key !== creation.key || previous.digest !== digest)
            throw new Error(
              "This creation already has retained content. Open it from Local projects before making another copy.",
            );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          const contents = await readdir(directory);
          if (
            contents.some(
              (name) => !/^\.creation\.json\.[a-f0-9-]+\.tmp$/u.test(name),
            )
          )
            throw new Error(
              "Incomplete creation contains retained files; inspect its folder before retrying",
            );
          await writeDurable(
            record,
            JSON.stringify({ key: creation.key, digest }),
          );
        }
        try {
          const existing = await readLimited(
            join(directory, "project.icproj.json"),
          );
          if (createHash("sha256").update(existing).digest("hex") !== digest)
            throw new Error(
              "The previously created Project changed; no file was overwritten",
            );
          return join(directory, "project.icproj.json");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      } else {
        directory = join(current, randomUUID());
        await mkdir(directory);
      }
      await writeDurable(join(directory, ".pending-create"), "1");
      return join(directory, "project.icproj.json");
    },
    async discardFailedAllocation(path: string) {
      const value = await load();
      const root = value.roots.find((root) =>
        /^[a-f0-9-]{36}[\\/]project\.icproj\.json$/u.test(
          relative(root.path, path),
        ),
      );
      if (!root) return;
      const directory = dirname(path);
      if (pathKey(await realpath(directory)) !== pathKey(directory)) return;
      try {
        await lstat(path);
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const marker = await lstat(join(directory, ".pending-create"));
      if (!marker.isFile() || marker.isSymbolicLink()) return;
      // A durable operation receipt can still point here. Keep its allocation
      // retriable; the scanner marks an incomplete file as damaged, never saved.
      try {
        await lstat(join(directory, ".creation.json"));
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      // Only a failed, never-committed allocation owned by this library. The
      // caller retains the working copy; an interrupted process instead leaves
      // this marker and its journal for recovery on the next list operation.
      await rm(directory, { recursive: true });
    },
    async selectRoot(path: string) {
      const canonical = await realpath(path);
      if (!(await lstat(canonical)).isDirectory())
        throw new Error("Choose a project directory");
      let value: LibrarySettings;
      try {
        value = await load();
      } catch {
        // Explicit directory selection can repair settings without discarding evidence.
        try {
          await copyFile(
            settingsPath,
            `${settingsPath}.damaged`,
            constants.COPYFILE_EXCL,
          );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "EEXIST")
            await copyFile(
              settingsPath,
              `${settingsPath}.${randomUUID()}.damaged`,
              constants.COPYFILE_EXCL,
            );
          else if ((error as NodeJS.ErrnoException).code !== "ENOENT")
            throw error;
        }
        value = { active: "", roots: [] };
      }
      const root = value.roots.find((root) => root.path === canonical) ?? {
        id: randomUUID(),
        path: canonical,
      };
      await persist({
        active: root.id,
        roots: value.roots.some((item) => item.id === root.id)
          ? value.roots
          : [...value.roots, root],
      });
      return list();
    },
  };
  return library;
}
export type ProjectLibrary = ReturnType<typeof createProjectLibrary>;
