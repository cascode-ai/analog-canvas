import { agentRazaviAuthoringCatalog } from "./agent-authoring-catalog.generated.js";
import { agentKitFiles, agentKitVersion } from "./agent-docs.generated.js";

// Node-side consumers (local MCP helper) read the same catalog object the Kit
// serializes, so there is exactly one generated catalog source.
export { agentRazaviAuthoringCatalog };

/**
 * Small, provider-neutral operating material for an Agent that has no checkout
 * of this repository. The Kit has no Project data, credentials, or mutation
 * surface: it teaches a browser Agent how to use the existing session API and
 * the reviewed built-in authoring facts it needs before a first Snapshot has
 * any instances.
 */

export const AGENT_OPERATING_KIT_FORMAT = "icm-agent-kit-v1";
export const AGENT_OPERATING_KIT_VERSION = agentKitVersion;

export interface AgentOperatingKitFile {
  path: string;
  content: string;
}

export interface AgentOperatingKit {
  format: typeof AGENT_OPERATING_KIT_FORMAT;
  version: typeof AGENT_OPERATING_KIT_VERSION;
  files: readonly AgentOperatingKitFile[];
}

export const agentOperatingKit: AgentOperatingKit = {
  format: AGENT_OPERATING_KIT_FORMAT,
  version: AGENT_OPERATING_KIT_VERSION,
  files: agentKitFiles,
};
