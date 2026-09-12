import { isSimulationInputPath } from "@icm/model";
import { unquoteSimulationToken } from "@icm/spice";
import type {
  SimulationSourceGraph,
  SimulationSourceDiagnostic,
} from "./simulation-source-graph.js";

/** The current executor collects one ASCII rawfile; its name comes from Code. */
export function nativeSourceCollection(graph: SimulationSourceGraph) {
  const paths = new Set<string>();
  const diagnostics: SimulationSourceDiagnostic[] = [];
  for (const item of graph.statements) {
    const statement = item.statement;
    if (
      statement.kind !== "control_command" ||
      statement.command.toLowerCase() !== "write"
    )
      continue;
    const path = unquoteSimulationToken(statement.arguments[0] ?? "");
    if (!path || /[${}]/u.test(path) || !isSimulationInputPath(path)) {
      diagnostics.push({
        code: "SIMULATION_NATIVE_COLLECTION_PATH",
        severity: "error",
        path: item.path,
        sourceRef: statement.sourceRef,
        message:
          "This executor needs an explicit, workspace-relative write path. Use one literal rawfile path for all collected plots; dynamic collection is not supported yet.",
      });
    } else paths.add(path);
  }
  if (paths.size > 1)
    diagnostics.push({
      code: "SIMULATION_NATIVE_COLLECTION_MULTIPLE",
      severity: "error",
      message:
        "This executor collects one rawfile. Write collected plots to the same path with set appendwrite; separate rawfile collection is not supported yet.",
    });
  return {
    collection: { rawfile: paths.values().next().value ?? null },
    diagnostics,
  };
}
