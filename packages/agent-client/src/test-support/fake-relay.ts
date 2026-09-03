import type {
  AgentCircuitRequest,
  AgentCircuitResponse,
  AgentFileResourceRequest,
  AgentFileResourceResponse,
} from "@icm/agent-adapter";
import { AgentHttpClient, type ClaimSuccess } from "../http-client.js";
import { testSnapshot } from "./snapshot-fixture.js";

/**
 * In-process fake of the public relay for Helper and MCP contract tests.
 * Tests script claim/circuit outcomes; nothing touches the network.
 */

export interface RecordedCircuitCall {
  sessionId: string;
  token: string;
  request: AgentCircuitRequest;
  payload: string;
}

export function capabilitiesResponse(requestId: string): AgentCircuitResponse {
  return {
    apiVersion: "2.0",
    requestId,
    operation: "capabilities",
    ok: true,
    capabilities: {
      apiVersions: ["2.0"],
      snapshotVersions: ["2.0"],
      operations: ["capabilities", "snapshot", "transact", "render"],
      editKinds: ["add_instance", "move_instance", "connect_endpoints"],
      permissions: {
        snapshot: true,
        render: true,
        sourceSpans: false,
        edit: { geometry: true, connectivity: true, presentation: true },
      },
      limits: {
        maxSnapshotBytes: 4_000_000,
        maxTransactionEdits: 64,
        maxRenderBytes: 1_000_000,
        maxRequestBytes: 256_000,
        changeHistoryEntries: 32,
      },
    },
  };
}

export function snapshotResponse(
  requestId: string,
  snapshot = testSnapshot(),
  revision = snapshot.document.revision,
): AgentCircuitResponse {
  return {
    apiVersion: "2.0",
    requestId,
    operation: "snapshot",
    ok: true,
    revision,
    snapshot,
    diagnostics: snapshot.document.diagnostics,
  };
}

export function transactSuccessResponse(
  requestId: string,
  fromRevision: number,
  changedObjectIds: string[] = [],
): AgentCircuitResponse {
  return {
    apiVersion: "2.0",
    requestId,
    operation: "transact",
    ok: true,
    applied: true,
    revision: fromRevision + 1,
    proposedRevision: fromRevision + 1,
    diff: {
      documentId: "main",
      fromRevision,
      toRevision: fromRevision + 1,
      editKinds: ["add_instance"],
      changedObjectIds,
    },
    diagnostics: [],
  };
}

export function errorResponse(
  requestId: string,
  operation: "snapshot" | "transact" | "render",
  code: string,
  message: string,
): AgentCircuitResponse {
  return {
    apiVersion: "2.0",
    requestId,
    operation,
    ok: false,
    error: { code, message },
    diagnostics: [],
  };
}

export function renderResponse(requestId: string): AgentCircuitResponse {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>', "utf8");
  return {
    apiVersion: "2.0",
    requestId,
    operation: "render",
    ok: true,
    revision: 5,
    artifact: {
      mediaType: "image/svg+xml",
      encoding: "base64",
      data: svg.toString("base64"),
      sha256: "b".repeat(64),
      byteLength: svg.byteLength,
      mode: "formal",
    },
    diagnostics: [],
  };
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
  baseUrl?: string;
}

export class FakeAgentHttp extends AgentHttpClient {
  readonly circuitCalls: RecordedCircuitCall[] = [];
  readonly claims: string[] = [];
  readonly resumes: Array<{ sessionId: string; connectorToken: string }> = [];
  readonly fileCalls: AgentFileResourceRequest[] = [];
  readonly disconnects: string[] = [];
  /** Replaceable per-test dispatch over recorded circuit calls. */
  circuitHandler: (call: RecordedCircuitCall) => Promise<AgentCircuitResponse>;
  private readonly claimHandler: NonNullable<FakeRelayOptions["claim"]>;
  private readonly resumeHandler: NonNullable<FakeRelayOptions["resume"]>;
  private readonly fileHandler: NonNullable<FakeRelayOptions["files"]>;

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
    this.fileHandler =
      options.files ??
      ((request) => ({
        apiVersion: "2.0",
        requestId: request.requestId,
        operation: "discard",
        ok: true,
        discarded: true,
      }));
    this.circuitHandler =
      options.circuit ??
      (async ({ request }) => {
        switch (request.operation) {
          case "capabilities":
            return capabilitiesResponse(request.requestId);
          case "snapshot":
            return snapshotResponse(request.requestId);
          case "render":
            return renderResponse(request.requestId);
          default:
            return errorResponse(
              request.requestId,
              "transact",
              "UNSUPPORTED_EDIT",
              "not scripted",
            );
        }
      });
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

  override async disconnect(sessionId: string): Promise<void> {
    this.disconnects.push(sessionId);
  }
}
