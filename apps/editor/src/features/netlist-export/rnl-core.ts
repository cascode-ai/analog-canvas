import type { CoreWorker } from "@rich-netlist/runtime";

export interface RnlWorkspace {
  files?: Record<string, string>;
  pool?: string[];
  package_dirs?: string[];
}

const filename = "analog-canvas-extensions.rnl";
const root = "/.analog-canvas/rnl";

function normalized(path: string): string {
  const slashed = path.replaceAll("\\", "/");
  const parts: string[] = [];
  for (const part of slashed.split("/")) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  return `${slashed.startsWith("/") ? "/" : ""}${parts.join("/")}`;
}

/** Keep caller files and search order, including aliases of our private path. */
function workspace<T extends RnlWorkspace>(request: T, text: string) {
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
  let directory = root;
  let path = `${directory}/${filename}`;
  for (let suffix = 1; claimed.has(path) && files[path] !== text; suffix++) {
    directory = `${root}-${suffix}`;
    path = `${directory}/${filename}`;
  }
  return {
    ...request,
    files: { ...files, [path]: text },
    pool: [...new Set([...(request.pool ?? []), path])],
    // write and catalog currently use package_dirs rather than pool.
    package_dirs: [...new Set([...(request.package_dirs ?? []), directory])],
  };
}

/** Every core entry point gets the Canvas package; drawings retain the last build. */
export function withCanvasPackage(core: CoreWorker, text: string): CoreWorker {
  return {
    build: (request) => core.build(workspace(request, text)),
    snapshot: (request) => core.snapshot(workspace(request, text)),
    write: (request) => core.write(workspace(request, text)),
    catalog: (request) => core.catalog(workspace(request, text)),
    drawings: (request) => core.drawings(request),
    library: (request) => core.library(workspace(request, text)),
    formats: (request) => core.formats(request),
    terminate: () => core.terminate(),
  };
}
