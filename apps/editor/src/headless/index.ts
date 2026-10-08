/**
 * The headless drawing workspace (#1498): the editor's own Agent host over
 * Project files, for Node. Bundled on its own (scripts/package-headless.mjs)
 * and loaded by the MCP's --local mode and the batch runner.
 */
export {
  createWorkspace,
  lockWorkspace,
  openLocalWorkspace,
  readWorkspace,
  writeWorkspace,
  workspaceProjectPath,
  WORKSPACE_LOCK_FILE,
  WORKSPACE_PROJECT_FILE,
  WORKSPACE_REFERENCE_FILE,
  type LocalWorkspace,
} from "./workspace";
/** The Processes a workspace can place new transistors in. */
export { NETLIST_PROFILE_IDS } from "../features/netlist-export/netlist-process-presets";
export {
  createLocalEditor,
  LOCAL_AGENT_SCOPES,
  type LocalEditor,
} from "./local-editor";
export {
  compareNetlists,
  workspaceNetlist,
  workspaceSvg,
  type NetlistComparison,
} from "./artifacts";
