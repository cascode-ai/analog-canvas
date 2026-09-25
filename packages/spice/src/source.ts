import { deriveStableId } from "@icm/model";

import { diagnostic } from "./diagnostics.js";
import type { SpiceDiagnostic } from "./diagnostics.js";
import type {
  SourceBundle,
  SpiceDependency,
  SpiceSourceFile,
  SpiceSourceInput,
} from "./source-types.js";
import { parseSpiceSource } from "./syntax.js";
import type {
  IncludeStatement,
  LibraryStatement,
  SpiceSyntaxFile,
} from "./syntax.js";

export function normalizeSourcePath(path: string): string | null {
  const replaced = path.replaceAll("\\", "/").replace(/^\.\//u, "");
  if (
    !replaced ||
    replaced.startsWith("/") ||
    /^[a-z]:\//iu.test(replaced) ||
    replaced.includes("://")
  ) {
    return null;
  }
  const parts: string[] = [];
  for (const part of replaced.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join("/") || null;
}

function directory(path: string): string {
  const separator = path.lastIndexOf("/");
  return separator < 0 ? "" : path.slice(0, separator);
}

function resolveInclude(
  sourcePath: string,
  requestedPath: string,
  rootDirectory: string,
): string | null {
  if (
    requestedPath.startsWith("/") ||
    /^[a-z]:[\\/]/iu.test(requestedPath) ||
    requestedPath.includes("://")
  ) {
    return null;
  }
  const combined = [directory(sourcePath), requestedPath]
    .filter(Boolean)
    .join("/");
  const normalized = normalizeSourcePath(combined);
  if (!normalized) return null;
  if (
    rootDirectory &&
    normalized !== rootDirectory &&
    !normalized.startsWith(`${rootDirectory}/`)
  ) {
    return null;
  }
  if (!rootDirectory && normalized.startsWith("../")) return null;
  return normalized;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    Uint8Array.from(bytes).buffer,
  );
  return `sha256:${[...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;
}

export function decodeSourceContent(bytes: Uint8Array): {
  encoding: SpiceSourceFile["encoding"];
  text: string;
} {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return {
      encoding: "utf-8-bom",
      text: new TextDecoder("utf-8").decode(bytes.slice(3)),
    };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return {
      encoding: "utf-16-le",
      text: new TextDecoder("utf-16le").decode(bytes.slice(2)),
    };
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return {
      encoding: "utf-16-be",
      text: new TextDecoder("utf-16be").decode(bytes.slice(2)),
    };
  }
  return {
    encoding: "utf-8",
    text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  };
}

async function loadInputs(inputs: readonly SpiceSourceInput[]): Promise<{
  files: Map<string, SpiceSourceFile>;
  diagnostics: SpiceDiagnostic[];
}> {
  const files = new Map<string, SpiceSourceFile>();
  const diagnostics: SpiceDiagnostic[] = [];
  for (const input of inputs) {
    const path = normalizeSourcePath(input.path);
    if (!path) {
      diagnostics.push(
        diagnostic(
          "SPICE_SOURCE_PATH_DENIED",
          "error",
          "source",
          `Invalid selected source path: ${input.path}`,
        ),
      );
      continue;
    }
    if (files.has(path)) {
      diagnostics.push(
        diagnostic(
          "SPICE_SOURCE_DUPLICATE_PATH",
          "error",
          "source",
          `Duplicate selected source path: ${path}`,
        ),
      );
      continue;
    }
    try {
      const decoded = decodeSourceContent(input.bytes);
      files.set(path, {
        id: deriveStableId("source", path),
        path,
        hash: await sha256(input.bytes),
        encoding: decoded.encoding,
        text: decoded.text,
      });
    } catch (error) {
      diagnostics.push(
        diagnostic(
          "SPICE_SOURCE_DECODE_FAILED",
          "error",
          "source",
          `Cannot decode ${path}: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }
  }
  return { files, diagnostics };
}

export async function createSourceBundle(
  inputs: readonly SpiceSourceInput[],
  entryPath: string,
): Promise<SourceBundle> {
  const normalizedEntry = normalizeSourcePath(entryPath) ?? entryPath;
  const loaded = await loadInputs(inputs);
  const entry = loaded.files.get(normalizedEntry);
  const diagnostics = [...loaded.diagnostics];
  const files: SpiceSourceFile[] = [];
  const syntaxFiles: SpiceSyntaxFile[] = [];
  const dependencies: SpiceDependency[] = [];
  if (!entry) {
    diagnostics.push(
      diagnostic(
        "SPICE_SOURCE_ENTRY_MISSING",
        "error",
        "source",
        `Selected entry does not exist: ${normalizedEntry}`,
      ),
    );
    return {
      entryPath: normalizedEntry,
      entryFileId: null,
      files,
      syntaxFiles,
      dependencies,
      diagnostics,
    };
  }

  const visited = new Set<string>();
  const active: string[] = [];
  const rootDirectory = directory(normalizedEntry);

  function visit(path: string): void {
    const source = loaded.files.get(path)!;
    visited.add(path);
    active.push(path);
    files.push(source);
    const syntax = parseSpiceSource(source);
    syntaxFiles.push(syntax);
    diagnostics.push(...syntax.diagnostics);
    for (const statement of syntax.statements) {
      if (
        statement.kind !== "include" &&
        !(statement.kind === "library" && statement.mode === "include")
      ) {
        continue;
      }
      const includeStatement = statement as
        | IncludeStatement
        | (LibraryStatement & { mode: "include"; requestedPath: string });
      const resolvedPath = resolveInclude(
        path,
        includeStatement.requestedPath,
        rootDirectory,
      );
      if (!resolvedPath) {
        dependencies.push({
          sourceFileId: source.id,
          requestedPath: includeStatement.requestedPath,
          resolvedPath: null,
          targetFileId: null,
          status: "denied",
          ...(includeStatement.kind === "library"
            ? { section: includeStatement.section }
            : {}),
          sourceRef: includeStatement.sourceRef,
        });
        diagnostics.push(
          diagnostic(
            "SPICE_SOURCE_INCLUDE_DENIED",
            "error",
            "source",
            `Include escapes the selected source root or is not local: ${includeStatement.requestedPath}`,
            includeStatement.sourceRef,
          ),
        );
        continue;
      }
      const target = loaded.files.get(resolvedPath);
      if (!target) {
        dependencies.push({
          sourceFileId: source.id,
          requestedPath: includeStatement.requestedPath,
          resolvedPath,
          targetFileId: null,
          status: "missing",
          ...(includeStatement.kind === "library"
            ? { section: includeStatement.section }
            : {}),
          sourceRef: includeStatement.sourceRef,
        });
        diagnostics.push(
          diagnostic(
            "SPICE_SOURCE_INCLUDE_MISSING",
            "error",
            "source",
            `Include target was not selected or found: ${includeStatement.requestedPath}`,
            includeStatement.sourceRef,
          ),
        );
        continue;
      }
      if (active.includes(resolvedPath)) {
        dependencies.push({
          sourceFileId: source.id,
          requestedPath: includeStatement.requestedPath,
          resolvedPath,
          targetFileId: target.id,
          status: "cycle",
          ...(includeStatement.kind === "library"
            ? { section: includeStatement.section }
            : {}),
          sourceRef: includeStatement.sourceRef,
        });
        diagnostics.push(
          diagnostic(
            "SPICE_SOURCE_INCLUDE_CYCLE",
            "error",
            "source",
            `Include cycle detected: ${[...active, resolvedPath].join(" -> ")}`,
            includeStatement.sourceRef,
          ),
        );
        continue;
      }
      if (visited.has(resolvedPath)) {
        dependencies.push({
          sourceFileId: source.id,
          requestedPath: includeStatement.requestedPath,
          resolvedPath,
          targetFileId: target.id,
          status: "duplicate",
          ...(includeStatement.kind === "library"
            ? { section: includeStatement.section }
            : {}),
          sourceRef: includeStatement.sourceRef,
        });
        diagnostics.push(
          diagnostic(
            "SPICE_SOURCE_INCLUDE_DUPLICATE",
            "info",
            "source",
            `Duplicate include suppressed: ${includeStatement.requestedPath}`,
            includeStatement.sourceRef,
          ),
        );
        continue;
      }
      dependencies.push({
        sourceFileId: source.id,
        requestedPath: includeStatement.requestedPath,
        resolvedPath,
        targetFileId: target.id,
        status: "resolved",
        ...(includeStatement.kind === "library"
          ? { section: includeStatement.section }
          : {}),
        sourceRef: includeStatement.sourceRef,
      });
      visit(resolvedPath);
    }
    active.pop();
  }

  visit(normalizedEntry);
  return {
    entryPath: normalizedEntry,
    entryFileId: entry.id,
    files,
    syntaxFiles,
    dependencies,
    diagnostics,
  };
}

export function sourceText(bundle: SourceBundle, fileId: string): string {
  const source = bundle.files.find((candidate) => candidate.id === fileId);
  if (!source) throw new Error(`Unknown source file: ${fileId}`);
  return source.text;
}
