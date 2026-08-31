import {
  AGENT_API_VERSION,
  AGENT_FILE_CANDIDATE_TTL_MS,
  AGENT_FILE_RESOURCE_MAX_BYTES,
  base64DecodeBytes,
  base64EncodeBytes,
  type AgentFileCandidateSummary,
  type AgentFileResourceRequest,
  type AgentFileResourceResponse,
} from "@icm/agent-adapter";
import { createFormalExportSource } from "@icm/exporters";
import { parseProject, serializeProject } from "@icm/project-protocol";
import type { CircuitProject, SchematicDocument } from "@icm/model";
import { importSpiceSources } from "@icm/spice";
import type { SymbolResolver } from "@icm/symbols";
import { prepareDocumentFormulaArtifacts } from "../features/text-editing/formula-artifacts";
import { importChunk } from "../components/chunk-import";

type StoredCandidate = {
  project: CircuitProject;
  summary: AgentFileCandidateSummary;
};

export interface BrowserAgentFileHostOptions {
  getProjectSessionId: () => string;
  getProject: () => CircuitProject;
  getDocument: (documentId: string) => SchematicDocument | null;
  getResolver: () => SymbolResolver;
  onApprovalRequested: (candidate: AgentFileCandidateSummary) => void;
}

/**
 * Browser-only endpoint for named File Resource requests. It owns short-lived
 * candidate bytes and parsed projects; the Worker only forwards typed messages.
 * A staged candidate has no authority to replace the live project by itself.
 */
export class BrowserAgentFileHost {
  private readonly candidates = new Map<string, StoredCandidate>();
  private readonly boundProjectSessionId: string;

  constructor(private readonly options: BrowserAgentFileHostOptions) {
    this.boundProjectSessionId = options.getProjectSessionId();
  }

  async handle(
    request: AgentFileResourceRequest,
  ): Promise<AgentFileResourceResponse> {
    if (this.options.getProjectSessionId() !== this.boundProjectSessionId) {
      return this.error(
        request,
        "PROJECT_REPLACED",
        "The Agent session is bound to a Project that has been replaced",
      );
    }
    this.removeExpired();
    switch (request.operation) {
      case "download":
        return this.download(request);
      case "stage":
        return this.stage(request);
      case "inspect": {
        const candidate = this.candidates.get(request.candidateId);
        return candidate
          ? {
              apiVersion: AGENT_API_VERSION,
              requestId: request.requestId,
              operation: "inspect",
              ok: true,
              candidate: candidate.summary,
            }
          : this.error(
              request,
              "FILE_CANDIDATE_NOT_FOUND",
              "Candidate is unavailable or expired",
            );
      }
      case "discard": {
        const existed = this.candidates.delete(request.candidateId);
        return existed
          ? {
              apiVersion: AGENT_API_VERSION,
              requestId: request.requestId,
              operation: "discard",
              ok: true,
              discarded: true,
            }
          : this.error(
              request,
              "FILE_CANDIDATE_NOT_FOUND",
              "Candidate is unavailable or expired",
            );
      }
      case "request-approval": {
        const candidate = this.candidates.get(request.candidateId);
        if (!candidate)
          return this.error(
            request,
            "FILE_CANDIDATE_NOT_FOUND",
            "Candidate is unavailable or expired",
          );
        this.options.onApprovalRequested(candidate.summary);
        return {
          apiVersion: AGENT_API_VERSION,
          requestId: request.requestId,
          operation: "request-approval",
          ok: true,
          candidate: candidate.summary,
          approval: "pending-human",
        };
      }
    }
  }

  /** Called only by a visible browser confirmation. */
  consumeApproved(candidateId: string): CircuitProject | null {
    this.removeExpired();
    const candidate = this.candidates.get(candidateId);
    if (!candidate) return null;
    this.candidates.delete(candidateId);
    return candidate.project;
  }

  discard(candidateId: string): void {
    this.candidates.delete(candidateId);
  }

  clear(): void {
    this.candidates.clear();
  }

  private async download(
    request: Extract<AgentFileResourceRequest, { operation: "download" }>,
  ): Promise<AgentFileResourceResponse> {
    try {
      if (request.artifact === "project") {
        const bytes = new TextEncoder().encode(
          serializeProject(this.options.getProject()),
        );
        return this.artifactResponse(
          request,
          "project.icproj.json",
          "application/json",
          bytes,
        );
      }
      const document = this.options.getDocument(request.documentId!);
      if (!document)
        return this.error(
          request,
          "DOCUMENT_NOT_FOUND",
          "Document is not present in this Project",
        );
      const prepared = await prepareDocumentFormulaArtifacts(document);
      const source = (() => {
        try {
          return createFormalExportSource(
            document,
            this.options.getResolver(),
            { title: this.options.getProject().name },
          );
        } finally {
          prepared.release();
        }
      })();
      if (request.artifact === "svg") {
        return this.artifactResponse(
          request,
          "schematic.svg",
          "image/svg+xml",
          new TextEncoder().encode(source.svg),
        );
      }
      if (request.artifact === "png") {
        const { rasterizeFormalSvgInBrowser } = await importChunk(
          "PNG export",
          () => import("@icm/exporters/browser-raster"),
        );
        const png = await rasterizeFormalSvgInBrowser(source);
        return this.artifactResponse(
          request,
          "schematic.png",
          png.mediaType,
          png.bytes,
        );
      }
      const { vectorizeFormalSvgInBrowser } = await importChunk(
        "PDF export",
        () => import("@icm/exporters/browser-pdf"),
      );
      const pdf = await vectorizeFormalSvgInBrowser(source);
      return this.artifactResponse(
        request,
        "schematic.pdf",
        "application/pdf",
        pdf,
      );
    } catch (error) {
      return this.error(
        request,
        "FILE_EXPORT_FAILED",
        error instanceof Error ? error.message : "Formal export failed",
      );
    }
  }

  private async stage(
    request: Extract<AgentFileResourceRequest, { operation: "stage" }>,
  ): Promise<AgentFileResourceResponse> {
    const decoded = await this.decodeFiles(request);
    if (!decoded.ok) return this.error(request, decoded.code, decoded.message);
    if (request.entryPath && !isVirtualSourcePath(request.entryPath)) {
      return this.error(
        request,
        "FILE_CONTENT_INVALID",
        "entryPath is not a safe virtual source path",
      );
    }
    try {
      let project: CircuitProject | null = null;
      let diagnostics: AgentFileCandidateSummary["diagnostics"] = [];
      if (request.kind === "project") {
        if (decoded.files.length !== 1)
          return this.error(
            request,
            "FILE_CONTENT_INVALID",
            "Project stage accepts exactly one .icproj.json file",
          );
        project = parseProject(
          new TextDecoder().decode(decoded.files[0]!.bytes),
        );
      } else {
        const entries = decoded.files.filter((file) =>
          /\.(?:cir|sp|spi)$/iu.test(file.name),
        );
        const entryPath =
          request.entryPath ?? (entries.length === 1 ? entries[0]!.name : null);
        if (!entryPath)
          return this.error(
            request,
            "FILE_CONTENT_INVALID",
            "Structural SPICE requires entryPath or exactly one .cir/.sp/.spi source",
          );
        const result = await importSpiceSources(
          decoded.files.map((file) => ({ path: file.name, bytes: file.bytes })),
          entryPath,
        );
        diagnostics = result.diagnostics.flatMap((item) =>
          item.severity === "warning" || item.severity === "error"
            ? [{ severity: item.severity, message: item.message }]
            : [],
        );
        if (!result.successful || !result.project) {
          return this.error(
            request,
            "FILE_IMPORT_FAILED",
            diagnostics[0]?.message ?? "Structural SPICE import failed",
          );
        }
        project = result.project;
      }
      const candidateId = `candidate-${crypto.randomUUID()}`;
      const expiresAt = new Date(
        Date.now() + AGENT_FILE_CANDIDATE_TTL_MS,
      ).toISOString();
      const summary: AgentFileCandidateSummary = {
        candidateId,
        kind: request.kind,
        expiresAt,
        projectName: project.name,
        documentCount: project.documents.length,
        instanceCount: project.documents.reduce(
          (total, document) => total + document.instances.length,
          0,
        ),
        diagnostics,
      };
      this.candidates.set(candidateId, { project, summary });
      return {
        apiVersion: AGENT_API_VERSION,
        requestId: request.requestId,
        operation: "stage",
        ok: true,
        candidate: summary,
      };
    } catch (error) {
      return this.error(
        request,
        "FILE_CONTENT_INVALID",
        error instanceof Error ? error.message : "File content is invalid",
      );
    }
  }

  private async decodeFiles(
    request: Extract<AgentFileResourceRequest, { operation: "stage" }>,
  ): Promise<
    | { ok: true; files: { name: string; bytes: Uint8Array }[] }
    | { ok: false; code: string; message: string }
  > {
    let total = 0;
    const files: { name: string; bytes: Uint8Array }[] = [];
    const names = new Set<string>();
    for (const file of request.files) {
      if (!isVirtualSourcePath(file.name)) {
        return {
          ok: false,
          code: "FILE_CONTENT_INVALID",
          message: `File name is not a safe virtual source path: ${file.name}`,
        };
      }
      if (names.has(file.name)) {
        return {
          ok: false,
          code: "FILE_CONTENT_INVALID",
          message: `Duplicate virtual source path: ${file.name}`,
        };
      }
      names.add(file.name);
      const bytes = base64DecodeBytes(file.data);
      if (!bytes || bytes.byteLength !== file.byteLength)
        return {
          ok: false,
          code: "FILE_CONTENT_INVALID",
          message: `Invalid base64 or byteLength for ${file.name}`,
        };
      total += bytes.byteLength;
      if (total > AGENT_FILE_RESOURCE_MAX_BYTES)
        return {
          ok: false,
          code: "FILE_TOO_LARGE",
          message: "Combined staged files exceed the File Resource limit",
        };
      if ((await sha256(bytes)) !== file.sha256)
        return {
          ok: false,
          code: "FILE_INTEGRITY_MISMATCH",
          message: `sha256 mismatch for ${file.name}`,
        };
      files.push({ name: file.name, bytes });
    }
    return { ok: true, files };
  }

  private async artifactResponse(
    request: Extract<AgentFileResourceRequest, { operation: "download" }>,
    name: string,
    mediaType: string,
    bytes: Uint8Array,
  ): Promise<AgentFileResourceResponse> {
    if (bytes.byteLength > AGENT_FILE_RESOURCE_MAX_BYTES)
      return this.error(
        request,
        "FILE_TOO_LARGE",
        "Formal artifact exceeds the File Resource limit",
      );
    return {
      apiVersion: AGENT_API_VERSION,
      requestId: request.requestId,
      operation: "download",
      ok: true,
      artifact: {
        name,
        mediaType,
        encoding: "base64",
        data: base64EncodeBytes(bytes),
        byteLength: bytes.byteLength,
        sha256: await sha256(bytes),
      },
    };
  }

  private error(
    request: AgentFileResourceRequest,
    code: string,
    message: string,
  ): AgentFileResourceResponse {
    return {
      apiVersion: AGENT_API_VERSION,
      requestId: request.requestId,
      operation: request.operation,
      ok: false,
      error: { code, message },
    };
  }

  private removeExpired(): void {
    const now = Date.now();
    for (const [id, candidate] of this.candidates) {
      if (Date.parse(candidate.summary.expiresAt) <= now)
        this.candidates.delete(id);
    }
  }
}

function isVirtualSourcePath(value: string): boolean {
  if (
    value.startsWith("/") ||
    value.includes("\\") ||
    /^[a-z][a-z0-9+.-]*:/iu.test(value)
  )
    return false;
  return value
    .split("/")
    .every(
      (segment) => segment.length > 0 && segment !== "." && segment !== "..",
    );
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new Uint8Array(bytes).buffer,
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
