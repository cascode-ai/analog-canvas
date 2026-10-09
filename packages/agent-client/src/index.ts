/**
 * Node-only Agent-side Helper over the four-operation Agent API (Agent rationale).
 * These modules import Node built-ins and are not part of any browser bundle.
 */
export {
  ConnectorStore,
  defaultConnectorFilePath,
  type StoredConnectorCredential,
} from "./connector-store.js";
export { AgentSessionError } from "./errors.js";
export {
  AgentHttpClient,
  type AgentRelayOperation,
  type AgentRequestTiming,
  type ClaimSuccess,
} from "./http-client.js";
export { changedObjectIds, type CachedSnapshot } from "./snapshot-cache.js";
export { AgentSessionClient } from "./session-client.js";
export { type ApplyActionsReport } from "./session-receipts.js";
/** @public An applied report's `placed` entries, named in declarations. */
export type { PlacedPart } from "./session-receipts.js";
export { AuthoringActionSchema } from "@icm/agent-adapter/authoring";
export { WorkspaceBindingStore } from "./workspace-binding-store.js";
