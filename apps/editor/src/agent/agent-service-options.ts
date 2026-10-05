import {
  AGENT_FILE_RESOURCE_MAX_BYTES,
  AGENT_SIMULATION_MAX_TIMEOUT_MS,
  type AgentCircuitHostServiceOptions,
  type AgentOperationHost,
  type AgentPermissions,
  type AgentSessionScope,
} from "@icm/agent-adapter";

/** What a paired session may do, as its granted scopes say. */
export function permissionsFromScopes(
  scopes: readonly AgentSessionScope[],
): AgentPermissions {
  return {
    snapshot: scopes.includes("circuit.snapshot"),
    render: scopes.includes("circuit.render"),
    sourceSpans: scopes.includes("circuit.source-spans"),
    semanticControl: scopes.includes("editor.semantic-control"),
    edit: {
      geometry: scopes.includes("circuit.edit.geometry"),
      connectivity: scopes.includes("circuit.edit.connectivity"),
      presentation: scopes.includes("circuit.edit.presentation"),
    },
  };
}

/**
 * How the editor serves one paired session: the circuit host, the
 * permissions its scopes grant, and the File, Simulation and Project
 * resources it hosts beside the four Circuit operations. The session hook
 * and the tests that run an Agent client against the real editor build the
 * service from these same options.
 */
export function agentCircuitServiceOptions(options: {
  sessionId: string;
  host: AgentOperationHost;
  scopes: readonly AgentSessionScope[];
  files: boolean;
  simulation: boolean;
  projects: boolean;
}): AgentCircuitHostServiceOptions {
  return {
    agentId: `web-agent:${options.sessionId}`,
    host: options.host,
    permissions: permissionsFromScopes(options.scopes),
    ...(options.files
      ? {
          fileResource: {
            path: "/api/agent/sessions/{sessionId}/files" as const,
            operations: [
              "download",
              "stage",
              "inspect",
              "discard",
              "request-approval",
              "open",
              "simulation-input",
              "import-cell",
            ] as const,
            maxBytes: AGENT_FILE_RESOURCE_MAX_BYTES,
            humanApprovalOperations: ["request-approval"] as const,
          },
          ...(options.simulation
            ? {
                simulationResource: {
                  path: "/api/agent/sessions/{sessionId}/simulation" as const,
                  operations: [
                    "capabilities",
                    "prepare",
                    "start",
                    "read",
                    "cancel",
                    "export",
                    "prepare-batch",
                    "start-batch",
                    "read-batch",
                    "cancel-batch",
                    "prepare-sweep",
                  ] as const,
                  analyses: ["op", "dc", "ac", "tran", "noise"] as const,
                  maxTimeoutMs: AGENT_SIMULATION_MAX_TIMEOUT_MS,
                  synchronous: false as const,
                },
              }
            : {}),
          ...(options.projects
            ? {
                projectResource: {
                  path: "/api/agent/sessions/{sessionId}/projects" as const,
                  operations: [
                    "list-projects",
                    "workspace",
                    "list-cells",
                    "import-cell",
                    "list-gallery",
                    "read-gallery-entry",
                    "read-gallery-entries",
                    "read-project-code",
                    "replace-project-code",
                    "read-netlist",
                    "replace-netlist",
                  ] as const,
                  importMode: "project-local-copy" as const,
                },
              }
            : {}),
        }
      : {}),
  };
}
