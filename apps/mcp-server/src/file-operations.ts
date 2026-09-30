import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import {
  AGENT_API_VERSION,
  type AgentFileResourceRequest,
} from "@icm/agent-adapter";
import { AgentSessionError, type AgentSessionClient } from "@icm/agent-client";

export type ExportFileOptions = Omit<
  Extract<AgentFileResourceRequest, { operation: "download" }>,
  "apiVersion" | "requestId" | "operation"
> & {
  outputPath: string;
};

export type ImportFileOperation =
  | { action: "stage-project"; path: string }
  | {
      action: "stage-spice";
      rootPath: string;
      entryPath: string;
      includePaths?: string[];
      namingProfile?: "native" | "cadence-bang";
    }
  | {
      action: "inspect" | "discard" | "request-approval" | "open";
      candidateId: string;
      background?: boolean;
      documentId?: string;
    }
  | {
      action: "import-cell";
      candidateId: string;
      sourceDocumentId: string;
      targetDocumentId: string;
      mode: "replace-body" | "append";
      expectedStructureRevision?: number;
      expectedRevision?: number;
    };

function requestId(): string {
  return `file-${randomUUID()}`;
}

function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function fileBlob(
  name: string,
  mediaType: string,
  data: Buffer,
): Extract<AgentFileResourceRequest, { operation: "stage" }>["files"][number] {
  return {
    name,
    mediaType,
    encoding: "base64",
    data: data.toString("base64"),
    byteLength: data.byteLength,
    sha256: sha256(data),
  };
}

function requestFailure(code: string, message: string): AgentSessionError {
  return new AgentSessionError(code, message, "request-rejected");
}

function pathWithin(
  root: string,
  path: string,
): { absolute: string; name: string } {
  const absolute = resolve(root, path);
  const fromRoot = relative(root, absolute);
  if (
    fromRoot === "" ||
    fromRoot === ".." ||
    fromRoot.startsWith(`..\\`) ||
    fromRoot.startsWith("../") ||
    isAbsolute(fromRoot) ||
    resolve(root, fromRoot) !== absolute
  ) {
    throw requestFailure(
      "FILE_OUTSIDE_ROOT",
      `SPICE file is outside rootPath: ${path}`,
    );
  }
  return { absolute, name: fromRoot.replaceAll("\\", "/") };
}

export async function exportFile(
  client: AgentSessionClient,
  options: ExportFileOptions,
): Promise<Record<string, unknown>> {
  const response = await client.fileResource({
    apiVersion: AGENT_API_VERSION,
    requestId: requestId(),
    operation: "download",
    artifact: options.artifact,
    ...(options.documentId ? { documentId: options.documentId } : {}),
    ...(options.simulation ? { simulation: options.simulation } : {}),
  });
  if (!response.ok || response.operation !== "download") {
    throw requestFailure(
      response.ok ? "INVALID_RESPONSE" : response.error.code,
      response.ok ? "unexpected file response" : response.error.message,
    );
  }
  const bytes = Buffer.from(response.artifact.data, "base64");
  if (
    bytes.byteLength !== response.artifact.byteLength ||
    sha256(bytes) !== response.artifact.sha256
  ) {
    throw requestFailure(
      "FILE_INTEGRITY_FAILED",
      "downloaded artifact did not match its declared length and SHA-256",
    );
  }
  const outputPath = resolve(options.outputPath);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, bytes);
  return {
    ok: true,
    artifact: options.artifact,
    outputPath,
    byteLength: bytes.byteLength,
    sha256: response.artifact.sha256,
  };
}

async function workspaceIds(client: AgentSessionClient) {
  const response = await client.projectResource({
    apiVersion: AGENT_API_VERSION,
    requestId: requestId(),
    operation: "workspace",
    request: { action: "list" },
  });
  return response.ok &&
    response.operation === "workspace" &&
    response.result.action === "list"
    ? response.result
    : null;
}

/**
 * A Gallery entry as a new working copy in one call: its Project Code is
 * staged and opened in memory, as `import_file` stages and opens a file.
 */
export async function openGalleryEntry(
  client: AgentSessionClient,
  galleryEntryId: string,
  background: boolean,
): Promise<Record<string, unknown>> {
  const read = await client.projectResource({
    apiVersion: AGENT_API_VERSION,
    requestId: requestId(),
    operation: "read-gallery-entry",
    galleryEntryId,
    netlistFormat: null,
  });
  if (!read.ok || read.operation !== "read-gallery-entry")
    throw requestFailure(
      read.ok ? "INVALID_RESPONSE" : read.error.code,
      read.ok ? "unexpected Gallery response" : read.error.message,
    );
  const staged = await client.fileResource({
    apiVersion: AGENT_API_VERSION,
    requestId: requestId(),
    operation: "stage",
    kind: "project",
    files: [
      fileBlob(
        `${galleryEntryId}.icproj.json`,
        "application/json",
        Buffer.from(read.projectCode, "utf8"),
      ),
    ],
  });
  if (!staged.ok || staged.operation !== "stage")
    throw requestFailure(
      staged.ok ? "INVALID_RESPONSE" : staged.error.code,
      staged.ok ? "unexpected stage response" : staged.error.message,
    );
  const before = await workspaceIds(client);
  const opened = await client.fileResource({
    apiVersion: AGENT_API_VERSION,
    requestId: requestId(),
    operation: "open",
    candidateId: staged.candidate.candidateId,
    ...(background ? { background: true } : {}),
  });
  if (!opened.ok || opened.operation !== "open")
    throw requestFailure(
      opened.ok ? "INVALID_RESPONSE" : opened.error.code,
      opened.ok ? "unexpected open response" : opened.error.message,
    );
  const after = await workspaceIds(client);
  const known = new Set(
    before?.projects.map((project) => project.workspaceId) ?? [],
  );
  const workspace = after?.projects.find(
    (project) => !known.has(project.workspaceId),
  );
  return {
    ok: true,
    galleryEntryId,
    name: read.entry.name,
    workspaceId: workspace?.workspaceId ?? null,
    activeWorkspaceId: after?.activeWorkspaceId ?? null,
    background,
  };
}

export async function importFile(
  client: AgentSessionClient,
  operation: ImportFileOperation,
): Promise<unknown> {
  let request: AgentFileResourceRequest;
  if (operation.action === "stage-project") {
    const path = resolve(operation.path);
    const data = await readFile(path);
    request = {
      apiVersion: AGENT_API_VERSION,
      requestId: requestId(),
      operation: "stage",
      kind: "project",
      files: [fileBlob(basename(path), "application/json", data)],
    };
  } else if (operation.action === "stage-spice") {
    const root = resolve(operation.rootPath);
    const paths = [operation.entryPath, ...(operation.includePaths ?? [])];
    const normalized = paths.map((path) => pathWithin(root, path));
    const unique = [
      ...new Map(normalized.map((entry) => [entry.name, entry])).values(),
    ];
    const files = await Promise.all(
      unique.map(async ({ absolute, name }) => {
        return fileBlob(name, "text/plain", await readFile(absolute));
      }),
    );
    request = {
      apiVersion: AGENT_API_VERSION,
      requestId: requestId(),
      operation: "stage",
      kind: "structural-spice",
      files,
      entryPath: normalized[0]!.name,
      ...(operation.namingProfile
        ? { namingProfile: operation.namingProfile }
        : {}),
    };
  } else if (operation.action === "import-cell") {
    const { action: _action, ...input } = operation;
    const state =
      operation.expectedStructureRevision === undefined ||
      operation.expectedRevision === undefined
        ? await client.documentState(operation.targetDocumentId)
        : undefined;
    request = {
      ...input,
      apiVersion: AGENT_API_VERSION,
      requestId: requestId(),
      operation: "import-cell",
      expectedStructureRevision:
        operation.expectedStructureRevision ?? state!.structureRevision,
      expectedRevision: operation.expectedRevision ?? state!.revision,
    };
  } else {
    request = {
      apiVersion: AGENT_API_VERSION,
      requestId: requestId(),
      operation: operation.action,
      candidateId: operation.candidateId,
      ...(operation.action === "inspect" && operation.documentId
        ? { documentId: operation.documentId }
        : {}),
      ...(operation.action === "open" && operation.background
        ? { background: true }
        : {}),
    };
  }
  return client.fileResource(request);
}
