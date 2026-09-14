import {
  isRunLocalPath,
  readRunLocalTextFile,
} from "../simulation/run-local-files.mjs";

/** Collection is a run-local output, never a host path or an input file. */
export function validCollection(value, inputPaths = []) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (Object.keys(value).length !== 1 || !("rawfile" in value)) return false;
  const path = value.rawfile;
  if (path === null) return true;
  if (!isRunLocalPath(path) || path.toLowerCase() === ".spiceinit")
    return false;
  // A file cannot simultaneously be the run's input and collected output;
  // include parent/child collisions with dependency mounts and source paths.
  return !inputPaths.some(
    (input) =>
      input === path ||
      input.startsWith(`${path}/`) ||
      path.startsWith(`${input}/`),
  );
}

const empty = (rawfileError = null) => ({
  rawfile: null,
  rawfileName: null,
  rawfileFormat: null,
  rawfileError,
});

/**
 * Read exactly the declared regular file after the supervised process tree
 * has stopped. No directory search, filename guessing, symlink traversal or
 * alternate input-file fallback. The simulator parser remains in spice-run.
 */
export async function readDeclaredRawfile(directory, collection, maxBytes) {
  if (
    !validCollection(collection) ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1
  )
    return empty("invalid-collection");
  if (collection.rawfile === null) return empty();
  const result = await readRunLocalTextFile(
    directory,
    collection.rawfile,
    maxBytes,
  );
  if (result.error) return empty(result.error);
  return {
    rawfile: result.text,
    rawfileName: collection.rawfile,
    rawfileFormat: result.format,
    rawfileError: null,
    truncated: result.truncated,
  };
}
