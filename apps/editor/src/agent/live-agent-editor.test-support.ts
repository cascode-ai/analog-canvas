import {
  AgentSessionScopeSchema,
  createAgentCircuitService,
  parseAgentFileResourceRequest,
  parseAgentProjectResourceRequest,
  parseAgentSimulationResourceRequest,
  type AgentSessionScope,
} from "@icm/agent-adapter";
import { createEmptyProject, type CircuitProject } from "@icm/model";
import {
  AgentSessionClient,
  type AgentSessionClientOptions,
} from "../../../../packages/agent-client/src/session-client";
import {
  FakeAgentHttp,
  type FakeRelayOptions,
} from "../../../../packages/agent-client/src/test-support/fake-relay";
import { EditorDocumentController } from "../document/document-controller";
import { agentCircuitServiceOptions } from "./agent-service-options";
import type { BrowserAgentPlanningContext } from "./browser-agent-command";
import { BrowserAgentFileHost } from "./browser-agent-file-host";
import { BrowserAgentHost } from "./browser-agent-host";
import { BrowserAgentSimulationHost } from "./browser-agent-simulation-host";
import {
  BrowserAgentProjectHost,
  type BrowserAgentProjectHostOptions,
} from "./browser-agent-project-host";

/** Every scope a person can grant a session. */
export const ALL_AGENT_SCOPES: readonly AgentSessionScope[] =
  AgentSessionScopeSchema.options;

/** A Project with one empty Cell, `main`. */
export function emptyAgentProject(name = "Agent"): CircuitProject {
  const project = createEmptyProject("project-1", name);
  project.documents[0]!.id = "main";
  project.topDocumentId = "main";
  return project;
}

export interface LiveAgentEditorOptions {
  project?: CircuitProject;
  scopes?: readonly AgentSessionScope[];
  planning?: BrowserAgentPlanningContext;
  /** The relay's side of pairing, when a test scripts it. */
  relay?: Pick<FakeRelayOptions, "claim" | "resume" | "baseUrl">;
  /** Project resource parts the browser takes from elsewhere. */
  projectHost?: Partial<BrowserAgentProjectHostOptions>;
  /**
   * The simulation service the editor's Simulation resource calls over the
   * network. Given, the editor serves the Simulation resource; this is the
   * service's side, not the editor's.
   */
  simulationService?: typeof fetch;
  client?: Partial<AgentSessionClientOptions>;
}

/**
 * The real editor an Agent client talks to: a live document controller with
 * the Circuit service, File host and Project host the browser serves, built
 * the way the session hook builds them. Requests pass over an in-process
 * relay; only pairing and network faults are scripted, never the editor's
 * answers.
 */
export function liveAgentEditor(options: LiveAgentEditorOptions = {}) {
  const controller = new EditorDocumentController(
    options.project ?? emptyAgentProject(),
  );
  const scopes = options.scopes ?? ALL_AGENT_SCOPES;
  const host = new BrowserAgentHost(
    controller,
    undefined,
    undefined,
    undefined,
    options.planning,
  );
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
      controller.commitProjectStructure(project, active),
    dispatchProjectTransaction: (request) =>
      host.dispatchProjectTransaction(request),
  });
  const projectHost = new BrowserAgentProjectHost({
    getProjectSessionId: () => controller.projectSessionId,
    getProject: () => controller.project,
    getActiveDocumentId: () => controller.document.id,
    commitProjectStructure: (project, active) =>
      controller.commitProjectStructure(project, active),
    dispatchProjectTransaction: (request) =>
      host.dispatchProjectTransaction(request),
    ...options.projectHost,
  });
  const simulationHost = options.simulationService
    ? new BrowserAgentSimulationHost({
        owner: "agent",
        files: fileHost.simulationFiles,
        getProjectSessionId: () => controller.projectSessionId,
        getProject: () => controller.project,
        fetch: options.simulationService,
      })
    : null;
  const service = createAgentCircuitService(
    agentCircuitServiceOptions({
      sessionId: "session-1",
      host,
      scopes,
      files: true,
      simulation: Boolean(simulationHost),
      projects: true,
    }),
  );
  const http = new FakeAgentHttp({
    claim: () => ({
      sessionId: "session-1",
      agentToken: "token-0123456789abcdef0123456789abcdef",
      tokenExpiresAt: Number.MAX_SAFE_INTEGER,
      connectorToken: "connector-0123456789abcdef0123456789abcdef",
      connectorExpiresAt: Number.MAX_SAFE_INTEGER,
      scopes: [...scopes],
      projectId: controller.project.id,
      documentIds: controller.project.documents.map((item) => item.id),
    }),
    ...options.relay,
    circuit: async ({ request }) => service.handle(request),
    files: async (request) => {
      const parsed = parseAgentFileResourceRequest(request);
      if (!parsed.success) throw new Error("File request off contract");
      return fileHost.handle(parsed.data);
    },
    projects: async (request) => {
      const parsed = parseAgentProjectResourceRequest(request);
      if (!parsed.success) throw new Error("Project request off contract");
      return projectHost.handle(parsed.data);
    },
    ...(simulationHost
      ? {
          simulation: async (request) => {
            const parsed = parseAgentSimulationResourceRequest(request);
            if (!parsed.success)
              throw new Error("Simulation request off contract");
            return simulationHost.handle(parsed.data);
          },
        }
      : {}),
  });
  const client = new AgentSessionClient({
    http,
    sleep: async () => {},
    ...options.client,
  });
  return {
    controller,
    host,
    service,
    fileHost,
    projectHost,
    simulationHost,
    http,
    client,
  };
}

/** A person's edit in the editor, between the Agent's calls. */
export function personEdits(
  controller: EditorDocumentController,
  edits: Parameters<EditorDocumentController["transact"]>[0],
) {
  const result = controller.transact(edits);
  if (!result.ok)
    throw new Error(`person's edit refused: ${result.error.message}`);
  return result;
}
