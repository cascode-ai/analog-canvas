import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, extname, relative, resolve } from "node:path";

import { createSourceBundle } from "./source.js";
import type { SourceBundle, SpiceSourceInput } from "./source-types.js";

const SOURCE_EXTENSIONS = new Set([".cir", ".inc", ".lib", ".sp", ".spi"]);

async function collectSourceInputs(
  root: string,
  directory: string,
): Promise<SpiceSourceInput[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const result: SpiceSourceInput[] = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name, "en"),
  )) {
    const absolute = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await collectSourceInputs(root, absolute)));
    } else if (
      entry.isFile() &&
      SOURCE_EXTENSIONS.has(extname(entry.name).toLowerCase())
    ) {
      result.push({
        path: relative(root, absolute).replaceAll("\\", "/"),
        bytes: Uint8Array.from(await readFile(absolute)),
      });
    }
  }
  return result;
}

/** @public The `./node` entry point reads a source tree from disk. */
export async function loadSourceBundleFromFile(
  entryPath: string,
): Promise<SourceBundle> {
  const absoluteEntry = resolve(entryPath);
  const root = dirname(absoluteEntry);
  const inputs = await collectSourceInputs(root, root);
  return createSourceBundle(inputs, basename(absoluteEntry));
}
