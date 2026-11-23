/**
 * One ngspice batch run inside the WebAssembly build, as the hosted harness
 * (containers/ngspice/entrypoint.mjs) runs one in its container: the run's
 * files, its Profile libraries mounted at their runtime paths, `.spiceinit`
 * and the deck in a fresh directory, `ngspice -b ./<entry>`, both streams
 * captured under the harness's log cap, and the rawfile read back. Unlike
 * the container, the whole rawfile is returned: it never leaves this
 * computer, so memory is its only bound.
 *
 * Each run gets a fresh module instance; ngspice's process state is never
 * carried from one run to the next.
 */
import { NGSPICE_MAX_LOG_BYTES, deckRequestsRawfile } from "@icm/spice-run";

/** The parts of Emscripten's FS a run uses. */
export interface NgspiceFs {
  mkdirTree(path: string): void;
  writeFile(path: string, data: string | Uint8Array): void;
  readFile(path: string): Uint8Array;
  readdir(path: string): string[];
  symlink(target: string, path: string): void;
  lstat(path: string): { mode: number };
  isFile(mode: number): boolean;
  isDir(mode: number): boolean;
  isLink(mode: number): boolean;
  chdir(path: string): void;
}

export interface NgspiceModule {
  FS: NgspiceFs;
  callMain(args: string[]): number;
}

/** A fresh module whose two streams go to `print` and `printErr`, one line each. */
export type CreateNgspiceModule = (streams: {
  print(line: string): void;
  printErr(line: string): void;
}) => Promise<NgspiceModule>;

/** A read-only file the simulator or its Profile supplies, at its absolute path. */
export interface NgspiceLibraryFile {
  path: string;
  bytes: Uint8Array;
}

export interface NgspiceBatchRequest {
  deck: string;
  entryPath: string;
  files: readonly { path: string; text: string }[];
  /** Run-local paths linked to Profile library files, as the harness links them. */
  mounts: readonly { mountPath: string; target: string }[];
  collection?: { rawfile: string | null };
}

/** What every run of one simulator shares. */
export interface NgspiceSystem {
  /** ngspice's `spinit` and the Profile's model and cell files, at their absolute paths. */
  libraries: readonly NgspiceLibraryFile[];
  /** The run directory's `.spiceinit` (containers/ngspice/hosted.spiceinit). */
  startup: string;
}

export interface NgspiceBatchOutput {
  stdout: string;
  stderr: string;
  truncated: boolean;
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
  rawfileRequested: boolean;
  rawfile: string | null;
  rawfileName: string | null;
  rawfileFormat: "ascii" | "binary" | null;
  rawfileError?: string;
}

const RUN_DIRECTORY = "/work";
/**
 * ngspice sizes its output buffers from `/proc/meminfo` and refuses to run
 * without one. The module's address space is 4 GiB, but ngspice holds the
 * figure in a 32-bit `size_t` here, so half of it is what it is told.
 */
const MEMINFO =
  "MemTotal:        2097152 kB\nMemFree:         2097152 kB\nMemAvailable:    2097152 kB\n";
const DECK_NAME = "deck.cir";
const SPICEINIT_NAME = ".spiceinit";

function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index <= 0 ? "/" : path.slice(0, index);
}

/** Lines kept to `limit` UTF-8 bytes, as the harness's capped sinks keep them. */
function cappedLines(limit: number) {
  const encoder = new TextEncoder();
  let text = "";
  let size = 0;
  let truncated = false;
  return {
    write(line: string) {
      const bytes = encoder.encode(`${line}\n`);
      const room = limit - size;
      if (bytes.length > room) truncated = true;
      if (room <= 0) return;
      const kept = bytes.length > room ? bytes.subarray(0, room) : bytes;
      text += new TextDecoder().decode(kept);
      size += kept.length;
    },
    text: () => text,
    get truncated() {
      return truncated;
    },
  };
}

/**
 * Text when the bytes are UTF-8 without NUL, as the harness collects; null
 * when the file is longer than this browser can hold as one string.
 */
function decodeRawfile(bytes: Uint8Array): {
  text: string | null;
  format: "ascii" | "binary" | null;
} {
  if (bytes.includes(0)) return { text: null, format: "binary" };
  try {
    return {
      text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      format: "ascii",
    };
  } catch (error) {
    if (error instanceof RangeError) return { text: null, format: null };
    return { text: null, format: "binary" };
  }
}

/** The collected file, or why this browser could not keep it. */
function collected(
  fs: NgspiceFs,
  path: string,
  name: string,
): Pick<
  NgspiceBatchOutput,
  "rawfile" | "rawfileName" | "rawfileFormat" | "rawfileError"
> & { tooLarge?: number } {
  const bytes = fs.readFile(path);
  const { text, format } = decodeRawfile(bytes);
  return format === null
    ? {
        rawfile: null,
        rawfileName: null,
        rawfileFormat: null,
        rawfileError: "unreadable-output",
        tooLarge: bytes.length,
      }
    : { rawfile: text, rawfileName: name, rawfileFormat: format };
}

/** Exactly the declared run-local file: no search, no symlink, no directory. */
function readDeclaredRawfile(
  fs: NgspiceFs,
  path: string,
): ReturnType<typeof collected> {
  const parts = path.split("/");
  let cursor = RUN_DIRECTORY;
  try {
    for (const [index, part] of parts.entries()) {
      cursor = `${cursor}/${part}`;
      const { mode } = fs.lstat(cursor);
      if (
        fs.isLink(mode) ||
        (index < parts.length - 1 ? !fs.isDir(mode) : !fs.isFile(mode))
      )
        return {
          rawfile: null,
          rawfileName: null,
          rawfileFormat: null,
          rawfileError: "unsafe-output",
        };
    }
  } catch {
    return {
      rawfile: null,
      rawfileName: null,
      rawfileFormat: null,
      rawfileError: "missing-output",
    };
  }
  return collected(fs, cursor, path);
}

/** The harness's legacy search: a top-level `.raw` file, else the first one. */
function readFoundRawfile(fs: NgspiceFs): ReturnType<typeof collected> {
  const candidates = fs
    .readdir(RUN_DIRECTORY)
    .filter(
      (name) =>
        name !== "." &&
        name !== ".." &&
        name !== DECK_NAME &&
        name !== SPICEINIT_NAME &&
        fs.isFile(fs.lstat(`${RUN_DIRECTORY}/${name}`).mode),
    )
    .sort();
  const preferred =
    candidates.find((name) => name.toLowerCase().endsWith(".raw")) ??
    candidates[0];
  if (!preferred)
    return { rawfile: null, rawfileName: null, rawfileFormat: null };
  return collected(fs, `${RUN_DIRECTORY}/${preferred}`, preferred);
}

/** Run one deck in a fresh module over `system`'s files. */
export async function runNgspiceBatch(
  createModule: CreateNgspiceModule,
  system: NgspiceSystem,
  request: NgspiceBatchRequest,
): Promise<NgspiceBatchOutput> {
  const stdout = cappedLines(Math.ceil(NGSPICE_MAX_LOG_BYTES / 2));
  const stderr = cappedLines(Math.floor(NGSPICE_MAX_LOG_BYTES / 2));
  const module = await createModule({
    print: (line) => stdout.write(line),
    printErr: (line) => stderr.write(line),
  });
  const { FS } = module;
  FS.writeFile("/proc/meminfo", MEMINFO);
  for (const library of system.libraries) {
    FS.mkdirTree(dirname(library.path));
    FS.writeFile(library.path, library.bytes);
  }
  FS.mkdirTree(RUN_DIRECTORY);
  const local = (path: string) => `${RUN_DIRECTORY}/${path}`;
  for (const file of request.files) {
    FS.mkdirTree(dirname(local(file.path)));
    FS.writeFile(local(file.path), file.text);
  }
  for (const mount of request.mounts) {
    FS.mkdirTree(dirname(local(mount.mountPath)));
    FS.symlink(mount.target, local(mount.mountPath));
  }
  FS.mkdirTree(dirname(local(request.entryPath)));
  FS.writeFile(local(request.entryPath), request.deck);
  FS.writeFile(local(SPICEINIT_NAME), system.startup);
  FS.chdir(RUN_DIRECTORY);

  const startedAt = performance.now();
  let exitCode: number | null;
  let signal: string | null = null;
  try {
    exitCode = module.callMain(["-b", `./${request.entryPath}`]);
  } catch (error) {
    // A WebAssembly trap or abort: the process died without an exit status,
    // reported as the harness reports a signal death.
    exitCode = 134;
    signal = "SIGABRT";
    stderr.write(
      `*** ngspice stopped: ${error instanceof Error ? error.message : String(error)} ***`,
    );
  }
  const durationMs = Math.round(performance.now() - startedAt);

  const rawfileRequested =
    request.collection === undefined
      ? deckRequestsRawfile(request.deck)
      : request.collection.rawfile !== null;
  const { tooLarge, ...raw }: ReturnType<typeof collected> =
    request.collection !== undefined
      ? request.collection.rawfile === null
        ? { rawfile: null, rawfileName: null, rawfileFormat: null }
        : readDeclaredRawfile(FS, request.collection.rawfile)
      : rawfileRequested
        ? readFoundRawfile(FS)
        : { rawfile: null, rawfileName: null, rawfileFormat: null };
  if (tooLarge !== undefined)
    stderr.write(
      `*** The rawfile (${Math.round(tooLarge / 1048576)} MB) is longer than this browser can hold as text; save fewer vectors or points. ***`,
    );
  return {
    stdout: stdout.text(),
    stderr: stderr.text(),
    truncated: stdout.truncated || stderr.truncated,
    exitCode,
    signal,
    durationMs,
    rawfileRequested,
    ...raw,
  };
}
