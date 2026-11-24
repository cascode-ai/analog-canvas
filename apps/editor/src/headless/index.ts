/**
 * The headless drawing workspace (#1498): the editor's own Agent host over
 * Project files, for Node. Bundled on its own (scripts/package-headless.mjs)
 * and loaded by the MCP's --local mode and the batch runner
 * (scripts/draw-batch.mjs), which grades drawings with `gradeNetlists`.
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
  LOCAL_FIGURE_ARTIFACTS,
  type LocalEditor,
} from "./local-editor";
/** A Project file's text as the editor reads it. */
export { parseProject } from "@icm/project-protocol";
/** An SVG's text faces embedded, so it draws the same everywhere (#2427). */
export { embedFormalSvgFontsHeadless } from "@icm/exporters/headless-raster";
export {
  compareNetlists,
  savedWorkspaceNetlist,
  workspaceNetlist,
  workspaceSvg,
  type NetlistComparison,
} from "./artifacts";
/** A Gallery testbench checked on this machine (scripts/gallery-sim-verify.mjs). */
export {
  localSimulationCheck,
  LOCAL_SG13G2_MODELS_ID,
  LOCAL_SG13G2_PROFILE_ID,
  LOCAL_SIMULATION_MODELS_ID,
  LOCAL_SIMULATION_PROFILE_ID,
  sg13g2Startup,
  type LocalSimulationCheck,
  type LocalSimulator,
} from "./simulation-check";
export {
  gradeNetlists,
  structuralSpice,
  type GradeDetails,
  type GradeOptions,
  type NetlistGrade,
} from "./grade";
