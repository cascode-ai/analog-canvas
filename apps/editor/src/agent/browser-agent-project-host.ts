import {
  AGENT_API_VERSION,
  type AgentProjectResourceRequest,
  type AgentProjectResourceResponse,
} from "@icm/agent-adapter";
import type {
  ProjectStructureEdit,
  ProjectTransactionResult,
} from "@icm/edit-engine";
import { planProjectCellImport } from "@icm/edit-engine";
import type { CircuitProject } from "@icm/model";

import {
  listCloudProjects,
  type CloudProjectListOutcome,
} from "../features/editor-shell/cloud-projects";
import {
  loadCloudProjectForCellImport,
  type CloudCellImportLoadResult,
} from "../features/hierarchy/cloud-cell-import";

export interface BrowserAgentProjectHostOptions {
  getProjectSessionId: () => string;
  getProject: () => CircuitProject;
  listProjects?: () => Promise<CloudProjectListOutcome>;
  loadProject?: (cloudProjectId: string) => Promise<CloudCellImportLoadResult>;
  dispatchProjectTransaction: (request: {
    transactionId: string;
    projectId: string;
    expectedStructureRevision: number;
    actor: { kind: "agent"; id: string };
    edits: ProjectStructureEdit[];
  }) => ProjectTransactionResult;
}

/** Browser authority for the signed-in Cloud Project shelf and live Project. */
export class BrowserAgentProjectHost {
  private readonly boundProjectSessionId: string;

  constructor(private readonly options: BrowserAgentProjectHostOptions) {
    this.boundProjectSessionId = options.getProjectSessionId();
  }

  async handle(
    request: AgentProjectResourceRequest,
  ): Promise<AgentProjectResourceResponse> {
    if (this.options.getProjectSessionId() !== this.boundProjectSessionId) {
      return this.error(
        request,
        "PROJECT_REPLACED",
        "The Agent session is bound to a Project that has been replaced",
        "refresh",
      );
    }
    if (request.operation === "list-projects") {
      const listed = await (this.options.listProjects ?? listCloudProjects)();
      if (listed.status !== "listed") {
        return this.error(
          request,
          listed.status === "signed-out"
            ? "SIGN_IN_REQUIRED"
            : "CLOUD_UNAVAILABLE",
          listed.status === "signed-out"
            ? "Sign in to inspect Cloud Project Cells"
            : listed.message,
          listed.status === "signed-out" ? "sign-in" : "retry",
        );
      }
      return {
        apiVersion: AGENT_API_VERSION,
        requestId: request.requestId,
        operation: request.operation,
        ok: true,
        projects: listed.projects.map((project) => ({ ...project })),
      };
    }

    const loaded = await (
      this.options.loadProject ?? loadCloudProjectForCellImport
    )(request.cloudProjectId);
    if (!loaded.ok) {
      return this.error(
        request,
        "SOURCE_PROJECT_UNAVAILABLE",
        loaded.message,
        loaded.message.includes("Sign in") ? "sign-in" : "retry",
      );
    }
    if (request.operation === "list-cells") {
      return {
        apiVersion: AGENT_API_VERSION,
        requestId: request.requestId,
        operation: request.operation,
        ok: true,
        project: {
          id: request.cloudProjectId,
          name: loaded.project.name,
        },
        cells: loaded.project.documents.map((document) => ({
          documentId: document.id,
          name: document.name,
          netlistName: document.netlist?.name ?? null,
          formalPorts:
            document.netlist?.terminals.map(({ name, direction }) => ({
              name,
              direction,
            })) ?? [],
        })),
      };
    }

    const destination = this.options.getProject();
    if (destination.structureRevision !== request.expectedStructureRevision) {
      return this.error(
        request,
        "STALE_STRUCTURE_REVISION",
        `Expected Project structure revision ${request.expectedStructureRevision}, current revision is ${destination.structureRevision}`,
        "refresh",
      );
    }
    const plan = planProjectCellImport(
      destination,
      loaded.project,
      request.sourceDocumentId,
    );
    if (!plan.ok) {
      return this.error(request, plan.code, plan.message, "fix-input");
    }
    if (plan.status === "already-imported") {
      return {
        apiVersion: AGENT_API_VERSION,
        requestId: request.requestId,
        operation: request.operation,
        ok: true,
        status: plan.status,
        rootDocumentId: plan.rootDocumentId,
        importedDocumentIds: [...plan.importedDocumentIds],
        structureRevision: destination.structureRevision,
      };
    }
    const result = this.options.dispatchProjectTransaction({
      transactionId: `agent-import-cell-${request.requestId}`,
      projectId: destination.id,
      expectedStructureRevision: request.expectedStructureRevision,
      actor: { kind: "agent", id: "project-resource" },
      edits: [...plan.edits],
    });
    if (!result.ok) {
      return this.error(
        request,
        result.error.code,
        result.diagnostics[0]?.message ?? result.error.message,
        result.error.code.includes("STALE") ? "refresh" : "fix-input",
      );
    }
    return {
      apiVersion: AGENT_API_VERSION,
      requestId: request.requestId,
      operation: request.operation,
      ok: true,
      status: "imported",
      rootDocumentId: plan.rootDocumentId,
      importedDocumentIds: [...plan.importedDocumentIds],
      structureRevision: result.structureRevision,
    };
  }

  private error(
    request: AgentProjectResourceRequest,
    code: string,
    message: string,
    recovery: "sign-in" | "refresh" | "fix-input" | "retry",
  ): AgentProjectResourceResponse {
    return {
      apiVersion: AGENT_API_VERSION,
      requestId: request.requestId,
      operation: request.operation,
      ok: false,
      error: { code, message, recovery },
    };
  }
}
