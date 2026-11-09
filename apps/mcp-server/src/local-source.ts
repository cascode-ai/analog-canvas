import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readlink, realpath, stat } from "node:fs/promises";
import { isAbsolute, posix, relative, resolve } from "node:path";
import {
  AGENT_FILE_RESOURCE_MAX_BYTES,
  AGENT_FILE_RESOURCE_MAX_FILES,
  hasRnlCommentRecords,
  localSourceIdentity,
  type AgentFileResourceRequest,
} from "@icm/agent-adapter";
import { AgentSessionError } from "@icm/agent-client";
import {
  decodeSourceContent,
  isExternalLibraryPath,
  isSpectreSource,
  parseSpiceSource,
  spectreSourceIncludes,
} from "@icm/spice";

type FileBlob = Extract<
  AgentFileResourceRequest,
  { operation: "stage" }
>["files"][number];

export function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export function fileBlob(
  name: string,
  mediaType: string,
  data: Buffer,
): FileBlob {
  return {
    name,
    mediaType,
    encoding: "base64",
    data: data.toString("base64"),
    byteLength: data.byteLength,
    sha256: sha256(data),
  };
}

export function requestFailure(
  code: string,
  message: string,
): AgentSessionError {
  return new AgentSessionError(code, message, "request-rejected");
}

export function pathWithin(
  root: string,
  path: string,
): { absolute: string; name: string } {
  const absolute = resolve(root, path);
  const name = relative(root, absolute).replaceAll("\\", "/");
  if (!name || name === ".." || name.startsWith("../") || isAbsolute(name))
    throw requestFailure(
      "FILE_OUTSIDE_ROOT",
      `File is outside rootPath: ${path}`,
    );
  return { absolute, name };
}

/** Fetch paths declared in RNL records. The browser runtime interprets the records. */
function packageReferences(text: string, packageFile: boolean): string[] {
  if (!packageFile && !hasRnlCommentRecords(text)) return [];
  const records = packageFile
    ? text
    : text
        .split(/\r\n?|\n/u)
        .map((line) => /^(?:\*|\/\/) (.*)$/u.exec(line)?.[1] ?? "\u0000")
        .join("\n");
  const paths: string[] = [];
  let depth = 0;
  for (const [token, opening, attributes] of records.matchAll(
    /(^@RNL\b(?:\([^\r\n)]*\))?\s*\{)|"(?:[^"\\]|\\.)*"|\/\/[^\r\n]*|@USE-PACKAGE\s*\(((?:"(?:[^"\\]|\\.)*"|[^"()\u0000])*)\)|[{}\u0000]/gmu,
  )) {
    if (opening) depth = 1;
    else if (token === "\u0000") depth = 0;
    else if (depth && token === "{") depth++;
    else if (depth && token === "}") depth--;
    else if (depth === 1 && attributes) {
      const path = /(?:^|,)\s*path\s*=\s*("(?:[^"\\]|\\.)*")/u.exec(attributes);
      if (path) paths.push(JSON.parse(path[1]!) as string);
    }
  }
  return paths;
}

function dependencyPath(parent: string, requested: string): string {
  const path = posix.normalize(
    posix.join(posix.dirname(parent), requested.replaceAll("\\", "/")),
  );
  if (
    !requested ||
    /^(?:[\\/])/u.test(requested) ||
    /[:\x00]/u.test(requested) ||
    path === ".." ||
    path.startsWith("../")
  )
    throw requestFailure(
      "FILE_OUTSIDE_ROOT",
      `${parent}: dependency is outside rootPath or is not local: ${requested}`,
    );
  return path;
}

async function readSource(
  root: string,
  path: string,
  reference: string,
  remaining: number,
): Promise<Buffer> {
  const target = pathWithin(root, path);
  try {
    const resolved = await realpath(target.absolute);
    pathWithin(root, resolved);
    const invalid = () =>
      requestFailure(
        "FILE_CONTENT_INVALID",
        `${reference}: ${path} must be a nonempty regular file`,
      );
    const changed = () =>
      requestFailure(
        "FILE_CHANGED_DURING_READ",
        `${reference}: ${path} changed while being read`,
      );
    const expected = await lstat(resolved);
    if (!expected.isFile()) throw invalid();
    const handle = await open(
      resolved,
      constants.O_RDONLY |
        (constants.O_NOFOLLOW ?? 0) |
        (constants.O_NONBLOCK ?? 0),
    );
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.size === 0) throw invalid();
      if (expected.dev !== before.dev || expected.ino !== before.ino)
        throw changed();
      // Linux can check the opened descriptor itself, including directory
      // links that changed between resolving and opening the path.
      if (process.platform === "linux") {
        const opened = await readlink(`/proc/self/fd/${handle.fd}`);
        pathWithin(root, opened);
        if (opened !== resolved) throw changed();
      }
      const confirmed = await realpath(target.absolute);
      pathWithin(root, confirmed);
      const actual = await stat(confirmed);
      if (
        resolved !== confirmed ||
        actual.dev !== before.dev ||
        actual.ino !== before.ino
      )
        throw changed();
      if (before.size > remaining)
        throw requestFailure(
          "FILE_TRANSFER_LIMIT",
          `${reference}: ${path} exceeds the remaining ${remaining} bytes of the file delivery limit`,
        );
      const bytes = Buffer.alloc(before.size + 1);
      let length = 0;
      while (length < bytes.length) {
        const { bytesRead } = await handle.read(
          bytes,
          length,
          bytes.length - length,
          length,
        );
        if (!bytesRead) break;
        length += bytesRead;
      }
      const after = await handle.stat();
      if (
        length !== before.size ||
        after.size !== before.size ||
        after.mtimeMs !== before.mtimeMs ||
        after.ctimeMs !== before.ctimeMs
      )
        throw changed();
      return bytes.subarray(0, length);
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error instanceof AgentSessionError) throw error;
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    throw requestFailure(
      missing ? "FILE_DEPENDENCY_MISSING" : "FILE_READ_FAILED",
      `${reference}: cannot read ${path}${missing ? " (file not found)" : ` (${(error as NodeJS.ErrnoException).code ?? "read failed"})`}`,
    );
  }
}

export async function prepareLocalSource(rootPath: string, path: string) {
  const selected = resolve(rootPath);
  const entry = pathWithin(selected, path);
  if (
    process.platform !== "win32" &&
    relative(selected, entry.absolute).includes("\\")
  )
    throw requestFailure(
      "FILE_CONTENT_INVALID",
      "An entry filename containing a literal backslash cannot be transferred",
    );
  const entryPath = entry.name;
  const root = await realpath(selected).catch(() => {
    throw requestFailure(
      "FILE_READ_FAILED",
      "Cannot read the selected rootPath",
    );
  });
  const files = new Map<string, FileBlob>();
  let remaining = AGENT_FILE_RESOURCE_MAX_BYTES;
  const project = /\.icproj(?:\.json)?$/iu.test(entryPath);
  if (!project && !/\.(?:cir|sp|spi|scs|spice|net)$/iu.test(entryPath))
    throw requestFailure(
      "FILE_FORMAT_UNSUPPORTED",
      "Select a native .icproj.json Project or a SPICE/Spectre netlist entry",
    );

  async function visit(
    name: string,
    reference: string,
    packageFile = false,
  ): Promise<void> {
    if (files.has(name)) return;
    if (name.length > 512 || files.size >= AGENT_FILE_RESOURCE_MAX_FILES)
      throw requestFailure(
        "FILE_TRANSFER_LIMIT",
        `${reference}: ${name} exceeds the file count or path length limit`,
      );
    const bytes = await readSource(root, name, reference, remaining);
    remaining -= bytes.byteLength;
    files.set(
      name,
      fileBlob(name, project ? "application/json" : "text/plain", bytes),
    );
    if (project) return;

    try {
      const content = decodeSourceContent(bytes);
      for (const path of packageReferences(content.text, packageFile))
        await visit(dependencyPath(name, path), `${name} @USE-PACKAGE`, true);
      if (packageFile) return;

      const includes = isSpectreSource({ path: name, bytes })
        ? spectreSourceIncludes(content.text)
        : parseSpiceSource({
            path: name,
            id: name,
            hash: "",
            ...content,
          }).statements.flatMap((statement) => {
            const path =
              statement.kind === "include" ||
              (statement.kind === "library" && statement.mode === "include")
                ? statement.requestedPath
                : undefined;
            return path ? [{ path, line: statement.sourceRef.start.line }] : [];
          });
      for (const { path, line } of includes) {
        // A library named by an absolute path (a foundry's models) stays the
        // simulator's: it is not read, and the import keeps it external.
        if (isExternalLibraryPath(path)) continue;
        await visit(dependencyPath(name, path), `${name}:${line}`);
      }
    } catch (error) {
      if (error instanceof AgentSessionError) throw error;
      throw requestFailure(
        "FILE_SOURCE_UNSUPPORTED",
        `${name}: ${error instanceof Error ? error.message : "Cannot read dependencies"}`,
      );
    }
  }
  await visit(entryPath, "Selected entry");
  const prepared = [...files.values()];
  const version = sha256(Buffer.from(localSourceIdentity(entryPath, prepared)));
  return { entryPath, files: prepared, version };
}
