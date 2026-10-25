import type { CoreWorker } from "@rich-netlist/runtime";

export interface RnlWorkspace {
  files?: Record<string, string>;
  pool?: string[];
  package_dirs?: string[];
}

const filename = "analog-canvas-extensions.rnl";
const root = "/.analog-canvas/rnl";

/** A Canvas package version's text, as the lock verified it. */
export interface CanvasPackageText {
  version: string;
  text: string;
}

function normalized(path: string): string {
  const slashed = path.replaceAll("\\", "/");
  const parts: string[] = [];
  for (const part of slashed.split("/")) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  return `${slashed.startsWith("/") ? "/" : ""}${parts.join("/")}`;
}

/**
 * Keep caller files and search order, including aliases of our private path.
 * Each version is in a directory of its own, so a file names either.
 */
function workspace<T extends RnlWorkspace>(
  request: T,
  packages: readonly CanvasPackageText[],
) {
  const files = request.files ?? {};
  const writtenFile =
    "write" in request &&
    typeof request.write === "object" &&
    request.write !== null &&
    "file" in request.write &&
    typeof request.write.file === "string"
      ? [request.write.file]
      : [];
  const claimed = new Set(
    [
      ...Object.keys(files),
      ...writtenFile,
      ...(request.pool ?? []),
      ...("entry" in request && typeof request.entry === "string"
        ? [request.entry]
        : []),
    ].map(normalized),
  );
  const placed = (base: string) =>
    packages.map(({ version, text }) => ({
      directory: `${base}/${version}`,
      path: `${base}/${version}/${filename}`,
      text,
    }));
  let base = root;
  let own = placed(base);
  for (
    let suffix = 1;
    own.some(({ path, text }) => claimed.has(path) && files[path] !== text);
    suffix++
  ) {
    base = `${root}-${suffix}`;
    own = placed(base);
  }
  return {
    ...request,
    files: {
      ...files,
      ...Object.fromEntries(own.map(({ path, text }) => [path, text])),
    },
    pool: [
      ...new Set([...(request.pool ?? []), ...own.map(({ path }) => path)]),
    ],
    // write and catalog currently use package_dirs rather than pool.
    package_dirs: [
      ...new Set([
        ...(request.package_dirs ?? []),
        ...own.map(({ directory }) => directory),
      ]),
    ],
  };
}

/** Every core entry point gets the Canvas packages; drawings retain the last build. */
export function withCanvasPackage(
  core: CoreWorker,
  packages: readonly CanvasPackageText[],
): CoreWorker {
  return {
    build: (request) => core.build(workspace(request, packages)),
    snapshot: (request) => core.snapshot(workspace(request, packages)),
    write: (request) => core.write(workspace(request, packages)),
    catalog: (request) => core.catalog(workspace(request, packages)),
    drawings: (request) => core.drawings(request),
    library: (request) => core.library(workspace(request, packages)),
    formats: (request) => core.formats(request),
    terminate: () => core.terminate(),
  };
}
