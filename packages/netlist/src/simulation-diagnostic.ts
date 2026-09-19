import type { NetlistDiagnostic } from "./ir.js";
import type { SimulationSourceDiagnostic } from "./source-file-graph.js";

/** Preserve native electrical evidence across both simulation compilers. */
export function simulationNetlistDiagnostic(
  item: NetlistDiagnostic,
): SimulationSourceDiagnostic {
  return {
    code: item.code,
    severity: item.code === "GENERATED_NET_NAME" ? "info" : item.severity,
    message: item.message,
    primary: {
      ...item.primary,
      hierarchyPath: [...item.primary.hierarchyPath],
    },
    field: [
      item.documentId,
      item.primary.kind === "instance" ? item.primary.objectId : undefined,
      item.parameter,
    ]
      .filter((part) => part !== undefined)
      .join("."),
  };
}
