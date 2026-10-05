import type {
  AgentCircuitRequest,
  AgentCircuitResponse,
  AgentFileResourceRequest,
  AgentFileResourceResponse,
  AgentProjectResourceRequest,
  AgentProjectResourceResponse,
  AgentSimulationResourceRequest,
  AgentSimulationResourceResponse,
} from "@icm/agent-adapter";
import { AgentHttpClient, type ClaimSuccess } from "../http-client.js";

/**
 * In-process stand-in for the public relay. It pairs a client and carries
 * its requests to the editor; it never answers for the editor. Attach the
 * real editor's services with `circuit`, `files`, `projects` and
 * `simulation` (apps/editor's liveAgentEditor does). A request no editor
 * service is attached for fails.
 */

export interface RecordedCircuitCall {
  sessionId: string;
  token: string;
  request: AgentCircuitRequest;
  payload: string;
}

export interface FakeRelayOptions {
  claim?: (claimCode: string) => Promise<ClaimSuccess> | ClaimSuccess;
  resume?: (
    sessionId: string,
    connectorToken: string,
  ) => Promise<ClaimSuccess> | ClaimSuccess;
  circuit?: (call: RecordedCircuitCall) => Promise<AgentCircuitResponse>;
  files?: (
    request: AgentFileResourceRequest,
  ) => Promise<AgentFileResourceResponse> | AgentFileResourceResponse;
  projects?: (
    request: AgentProjectResourceRequest,
  ) => Promise<AgentProjectResourceResponse> | AgentProjectResourceResponse;
  simulation?: (
    request: AgentSimulationResourceRequest,
  ) =>
    Promise<AgentSimulationResourceResponse> | AgentSimulationResourceResponse;
  baseUrl?: string;
}

/** No editor is attached: the relay has nothing to carry a request to. */
function noEditor(resource: string) {
  return (): never => {
    throw new Error(
      `No editor attached for this ${resource} request: run the client against the real editor (liveAgentEditor)`,
    );
  };
}

export class FakeAgentHttp extends AgentHttpClient {
  readonly circuitCalls: RecordedCircuitCall[] = [];
  readonly claims: string[] = [];
  readonly resumes: Array<{ sessionId: string; connectorToken: string }> = [];
  readonly fileCalls: AgentFileResourceRequest[] = [];
  readonly projectCalls: AgentProjectResourceRequest[] = [];
  readonly simulationCalls: AgentSimulationResourceRequest[] = [];
  readonly disconnects: string[] = [];
  /** Replaceable per-test dispatch over recorded circuit calls. */
  circuitHandler: (call: RecordedCircuitCall) => Promise<AgentCircuitResponse>;
  private readonly claimHandler: NonNullable<FakeRelayOptions["claim"]>;
  private readonly resumeHandler: NonNullable<FakeRelayOptions["resume"]>;
  private readonly fileHandler: NonNullable<FakeRelayOptions["files"]>;
  private readonly projectHandler: NonNullable<FakeRelayOptions["projects"]>;
  private readonly simulationHandler: FakeRelayOptions["simulation"];

  constructor(options: FakeRelayOptions = {}) {
    super({ baseUrl: options.baseUrl ?? "https://relay.test" });
    this.claimHandler =
      options.claim ??
      (() => ({
        sessionId: "session-1",
        agentToken: "token-0123456789abcdef0123456789abcdef",
        tokenExpiresAt: Number.MAX_SAFE_INTEGER,
        connectorToken: "connector-0123456789abcdef0123456789abcdef",
        connectorExpiresAt: Number.MAX_SAFE_INTEGER,
        scopes: ["circuit.snapshot", "circuit.render"],
        projectId: "project-1",
        documentIds: ["main"],
      }));
    this.resumeHandler = options.resume ?? (() => this.claimHandler("resume"));
    this.simulationHandler = options.simulation;
    this.fileHandler = options.files ?? noEditor("File");
    this.projectHandler = options.projects ?? noEditor("Project");
    this.circuitHandler = options.circuit ?? noEditor("Circuit");
  }

  override async claim(claimCode: string): Promise<ClaimSuccess> {
    this.claims.push(claimCode);
    return this.claimHandler(claimCode);
  }

  override async resumeConnector(
    sessionId: string,
    connectorToken: string,
  ): Promise<ClaimSuccess> {
    this.resumes.push({ sessionId, connectorToken });
    return this.resumeHandler(sessionId, connectorToken);
  }

  override async circuit(
    sessionId: string,
    agentToken: string,
    request: AgentCircuitRequest,
  ): Promise<AgentCircuitResponse> {
    const call: RecordedCircuitCall = {
      sessionId,
      token: agentToken,
      request,
      payload: JSON.stringify(request),
    };
    this.circuitCalls.push(call);
    return this.circuitHandler(call);
  }

  override async files(
    _sessionId: string,
    _agentToken: string,
    request: AgentFileResourceRequest,
  ): Promise<AgentFileResourceResponse> {
    this.fileCalls.push(request);
    return this.fileHandler(request);
  }

  override async projects(
    _sessionId: string,
    _agentToken: string,
    request: AgentProjectResourceRequest,
  ): Promise<AgentProjectResourceResponse> {
    this.projectCalls.push(request);
    return this.projectHandler(request);
  }

  override async simulation(
    _sessionId: string,
    _agentToken: string,
    request: AgentSimulationResourceRequest,
  ): Promise<AgentSimulationResourceResponse> {
    this.simulationCalls.push(request);
    return (this.simulationHandler ?? noEditor("Simulation"))(request);
  }

  override async disconnect(sessionId: string): Promise<void> {
    this.disconnects.push(sessionId);
  }
}
