import {
  AgentSessionScopeSchema,
  createAgentCircuitService,
  parseAgentFileResourceRequest,
  parseAgentProjectResourceRequest,
  type AgentCircuitRequest,
  type AgentCircuitResponse,
  type AgentFileResourceResponse,
  type AgentProjectResourceResponse,
  type AgentSessionScope,
} from "@icm/agent-adapter";
import type { CircuitProject } from "@icm/model";
import { EditorDocumentController } from "../document/document-controller";
import { agentCircuitServiceOptions } from "../agent/agent-service-options";
import type { BrowserAgentPlanningContext } from "../agent/browser-agent-command";
import { BrowserAgentFileHost } from "../agent/browser-agent-file-host";
import { BrowserAgentHost } from "../agent/browser-agent-host";
import { BrowserAgentProjectHost } from "../agent/browser-agent-project-host";
import {
  createDefaultNetlistExportPreferences,
  type NetlistExportPreferences,
} from "../features/netlist-export/netlist-export-preferences";
import type { NetlistProfileId } from "../features/netlist-export/netlist-process-presets";
import {
  placementModelTarget,
  placementProcessFill,
  processTargetForShortName,
} from "../features/netlist-export/netlist-process";

/** Every scope a person can grant; a local workspace is its owner's own. */
export const LOCAL_AGENT_SCOPES: readonly AgentSessionScope[] =
  AgentSessionScopeSchema.options;

export interface LocalEditorOptions {
  project: CircuitProject;
  /** The Process a new transistor is placed in; the editor's default if left out. */
  process?: NetlistProfileId;
}

/**
 * The editor's own Agent host and Circuit service around one Project, with no
 * browser (#1498). It is built as the session hook builds it for a paired
 * page, so an Agent's calls are planned and committed exactly as in the
 * editor; only the relay is gone. Simulation, the Cloud shelf and the Gallery
 * need the website and are not offered.
 */
export function createLocalEditor(options: LocalEditorOptions) {
  const controller = new EditorDocumentController(options.project);
  const preferences: NetlistExportPreferences = {
    ...createDefaultNetlistExportPreferences(),
    ...(options.process ? { selected: options.process } : {}),
  };
  // The Process a person working in this Project would have selected.
  const planning: BrowserAgentPlanningContext = {
    processModelTarget: (source, symbolId) =>
      placementModelTarget(source, preferences, symbolId),
    processTargetForShortName: (source, symbolId, name) =>
      processTargetForShortName(source, preferences, symbolId, name),
    processFill: (source, documentId, edits) =>
      placementProcessFill(source, preferences, documentId, edits),
  };
  const host = new BrowserAgentHost(
    controller,
    undefined,
    undefined,
    undefined,
    planning,
  );
  const unavailable: typeof fetch = async () => {
    throw new Error("A local workspace has no website to reach");
  };
  const fileHost = new BrowserAgentFileHost({
    getProjectSessionId: () => controller.projectSessionId,
    getProject: () => controller.project,
    getDocument: (documentId) =>
      controller.project.documents.find((item) => item.id === documentId) ??
      null,
    getResolver: () => controller.resolver,
    getActiveDocumentId: () => controller.document.id,
    onApprovalRequested: () => {},
    commitProjectStructure: (project, active) =>
      host.commitProjectStructure(project, active),
    dispatchProjectTransaction: (request) =>
      host.dispatchProjectTransaction(request),
  });
  const projectHost = new BrowserAgentProjectHost({
    getProjectSessionId: () => controller.projectSessionId,
    getProject: () => controller.project,
    getActiveDocumentId: () => controller.document.id,
    commitProjectStructure: (project, active) =>
      host.commitProjectStructure(project, active),
    dispatchProjectTransaction: (request) =>
      host.dispatchProjectTransaction(request),
    fetch: unavailable,
  });
  const service = createAgentCircuitService(
    agentCircuitServiceOptions({
      sessionId: "local",
      host,
      scopes: LOCAL_AGENT_SCOPES,
      files: true,
      simulation: false,
      projects: true,
    }),
  );
  return {
    controller,
    /** The Project as it stands after the last committed call. */
    get project(): CircuitProject {
      return controller.project;
    },
    circuit: (request: AgentCircuitRequest): AgentCircuitResponse =>
      service.handle(request),
    files: async (request: unknown): Promise<AgentFileResourceResponse> => {
      const parsed = parseAgentFileResourceRequest(request);
      if (!parsed.success) throw new Error("File request off contract");
      return fileHost.handle(parsed.data);
    },
    projects: async (
      request: unknown,
    ): Promise<AgentProjectResourceResponse> => {
      const parsed = parseAgentProjectResourceRequest(request);
      if (!parsed.success) throw new Error("Project request off contract");
      return projectHost.handle(parsed.data);
    },
  };
}

export type LocalEditor = ReturnType<typeof createLocalEditor>;
