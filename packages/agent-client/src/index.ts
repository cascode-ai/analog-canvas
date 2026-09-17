/**
 * Node-only Agent-side Helper over the four-operation Agent API (ADR 0007).
 * These modules import Node built-ins and are not part of any browser bundle.
 */
export {
  connectionTransition,
  ConnectionTracker,
  type AgentConnectionState,
  type ConnectionEvent,
  type ConnectionSnapshot,
} from "./connection-state.js";
export {
  CONNECTOR_FILE_VERSION,
  ConnectorStore,
  defaultConnectorFilePath,
  type StoredConnectorCredential,
} from "./connector-store.js";
export {
  AgentSessionError,
  networkFailure,
  transportFailure,
} from "./errors.js";
export type { AgentFailureCategory } from "./errors.js";
export {
  AgentHttpClient,
  type AgentHttpClientOptions,
  type ClaimSuccess,
} from "./http-client.js";
export {
  SnapshotCache,
  changedObjectIds,
  countDiagnostics,
  snapshotSummary,
  type CachedSnapshot,
  type SnapshotSummary,
} from "./snapshot-cache.js";
export {
  AgentSessionClient,
  type AgentSessionClientOptions,
  type ApplyActionsReport,
  type ConnectReport,
  type StatusReport,
} from "./session-client.js";
export {
  ActionCompileError,
  compileActions,
  type CompiledTransaction,
  type CompileContext,
  type SchematicEdit,
  type WireIntent,
} from "./authoring-helper.js";
export {
  AuthoringActionSchema,
  ObjectRefSchema,
  type AuthoringAction,
  type ObjectRef,
} from "./authoring-actions.js";
