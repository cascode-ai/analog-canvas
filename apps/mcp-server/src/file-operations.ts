import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import {
  AGENT_API_VERSION,
  matchesAgentReviewTarget,
  type AgentFileResourceRequest,
  type AgentLocalModelTypes,
  type AgentRnlAppearance,
} from "@icm/agent-adapter";
import { AgentSessionError, type AgentSessionClient } from "@icm/agent-client";
import {
  fileBlob,
  pathWithin,
  prepareLocalSource,
  requestFailure,
  sha256,
} from "./local-source.js";

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
    ...(options.includeReview ? { includeReview: true } : {}),
    ...(options.expected ? { expected: options.expected } : {}),
    ...(options.bounds ? { bounds: options.bounds } : {}),
    ...(options.simulation ? { simulation: options.simulation } : {}),
  });
  if (!response.ok || response.operation !== "download") {
    throw requestFailure(
      response.ok ? "INVALID_RESPONSE" : response.error.code,
      response.ok ? "unexpected file response" : response.error.message,
    );
  }
  if (
    (options.includeReview && !response.review) ||
    (options.expected &&
      (!response.review ||
        !matchesAgentReviewTarget(response.review, options.expected))) ||
    (options.bounds &&
      (!response.review?.bounds ||
        Object.entries(options.bounds).some(
          ([key, value]) =>
            response.review?.bounds?.[key as keyof typeof options.bounds] !==
            value,
        )))
  )
    throw requestFailure(
      "REVIEW_TARGET_CHANGED",
      "Canvas did not confirm the requested revision and image bounds",
    );
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
    ...(response.review ? { review: response.review } : {}),
    ...(response.warnings ? { warnings: response.warnings } : {}),
  };
}

async function workspaceIds(
  client: Pick<AgentSessionClient, "projectResource">,
) {
  const list = () =>
    client.projectResource({
      apiVersion: AGENT_API_VERSION,
      requestId: requestId(),
      operation: "workspace",
      request: { action: "list" },
    });
  // Opening a foreground tab can publish its context after the file receipt.
  // The client refreshes for both HTTP and editor refusals. Retry only this
  // read once, under a new ID; leave all other failures unchanged.
  let response = await list().catch((error: unknown) => {
    if (
      error instanceof AgentSessionError &&
      error.code === "PROJECT_CONTEXT_STALE"
    )
      return null;
    throw error;
  });
  if (
    response === null ||
    (!response.ok && response.error.code === "PROJECT_CONTEXT_STALE")
  )
    response = await list();
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
  client: Pick<AgentSessionClient, "projectResource" | "fileResource">,
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

/** Each stage of a local delivery, in ms; a refusal leaves those it never ran at 0. */
export function deliveryTiming() {
  return { prepare: 0, locate: 0, transfer: 0, import: 0, open: 0 };
}
type DeliveryTiming = ReturnType<typeof deliveryTiming>;

/** Runs one stage and records its time, whether it succeeds or throws. */
async function timed<T>(
  timingMs: DeliveryTiming,
  stage: keyof DeliveryTiming,
  run: () => Promise<T>,
): Promise<T> {
  const started = performance.now();
  try {
    return await run();
  } finally {
    timingMs[stage] = performance.now() - started;
  }
}

/** The caller keeps `timingMs`, so a refusal can report the stages it ran. */
export async function openLocalFile(
  client: AgentSessionClient,
  options: {
    rootPath: string;
    entryPath: string;
    background?: boolean;
    rnlAppearance?: AgentRnlAppearance;
    taskRef?: string;
    modelTypes?: AgentLocalModelTypes;
  },
  timingMs: DeliveryTiming = deliveryTiming(),
) {
  const { entryPath, files, version } = await timed(timingMs, "prepare", () =>
    prepareLocalSource(options.rootPath, options.entryPath),
  );
  const background = options.background ?? false;
  const appearance = options.rnlAppearance
    ? { rnlAppearance: options.rnlAppearance }
    : {};
  const locateCopy = () =>
    client.fileResource(
      {
        apiVersion: AGENT_API_VERSION,
        requestId: requestId(),
        operation: "locate-local",
        sourceVersion: version,
        background,
        ...appearance,
        ...(options.taskRef ? { taskRef: options.taskRef } : {}),
      },
      "session",
    );
  const located = await timed(timingMs, "locate", async () => {
    const first = await locateCopy().catch((error: unknown) => {
      if (
        error instanceof AgentSessionError &&
        error.code === "PROJECT_CONTEXT_STALE"
      )
        return null;
      throw error;
    });
    return !first || (!first.ok && first.error.code === "PROJECT_CONTEXT_STALE")
      ? await locateCopy()
      : first;
  });
  if (!located.ok || located.operation !== "locate-local")
    throw requestFailure(
      located.ok ? "INVALID_RESPONSE" : located.error.code,
      located.ok ? "Unexpected locate-local response" : located.error.message,
    );
  let delivery = located.delivery;
  if (!delivery) {
    // A refused import has no separate import time: it is all transfer.
    const staged = await timed(timingMs, "transfer", () =>
      client.fileResource(
        {
          apiVersion: AGENT_API_VERSION,
          requestId: requestId(),
          operation: "stage",
          kind: "local-circuit",
          entryPath,
          files,
          ...appearance,
          ...(options.modelTypes ? { modelTypes: options.modelTypes } : {}),
        },
        "session",
      ),
    );
    if (staged.ok && staged.operation === "stage") {
      timingMs.import = staged.candidate.importMs ?? 0;
      timingMs.transfer = Math.max(0, timingMs.transfer - timingMs.import);
    }
    if (
      !staged.ok ||
      staged.operation !== "stage" ||
      staged.candidate.source?.version !== version
    )
      throw requestFailure(
        staged.ok ? "FILE_INTEGRITY_FAILED" : staged.error.code,
        staged.ok
          ? "The staged source version did not match the local bytes"
          : staged.error.message,
      );
    const { candidateId } = staged.candidate;
    const opened = await timed(timingMs, "open", () =>
      client.fileResource(
        {
          apiVersion: AGENT_API_VERSION,
          requestId: requestId(),
          operation: "open",
          candidateId,
          background,
          ...(options.taskRef ? { taskRef: options.taskRef } : {}),
        },
        "session",
      ),
    );
    if (!opened.ok || opened.operation !== "open" || !opened.delivery)
      throw requestFailure(
        opened.ok ? "FILE_LOAD_UNCONFIRMED" : opened.error.code,
        opened.ok
          ? "The browser did not confirm which Project loaded"
          : opened.error.message,
      );
    delivery = opened.delivery;
  }
  if (delivery.source.version !== version)
    throw requestFailure(
      "FILE_INTEGRITY_FAILED",
      "The live Project reports a different source version",
    );
  if (
    options.taskRef &&
    !background &&
    client.workspaceId !== delivery.workspaceId
  ) {
    const target = await client.bindWorkspace(
      delivery.workspaceId,
      delivery.projectId,
    );
    if (target.workspaceId !== delivery.workspaceId)
      throw requestFailure(
        "FILE_LOAD_UNCONFIRMED",
        "The loaded Project could not be bound to the task",
      );
  }
  const { sessionId } = await client.status();
  return {
    ok: true,
    taskRef: options.taskRef ?? null,
    sessionId,
    delivery,
    timingMs,
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
