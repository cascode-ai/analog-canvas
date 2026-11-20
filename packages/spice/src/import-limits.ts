import { MAX_FORMAL_PARAMETERS, MAX_PART_TERMINALS } from "@icm/model";

import { diagnostic } from "./diagnostics.js";
import type { SpiceDiagnostic } from "./diagnostics.js";
import type { CircuitIR } from "./ir.js";

/**
 * Parts and Cells beyond what a Project holds, each named where it is, so
 * the import refuses them by name rather than as an invalid Project
 * (#2294).
 */
export function importLimitDiagnostics(ir: CircuitIR): SpiceDiagnostic[] {
  const found: SpiceDiagnostic[] = [];
  const refuse = (
    message: string,
    sourceRef: CircuitIR["cells"][number]["sourceRef"],
  ) =>
    found.push(
      diagnostic(
        "SPICE_IMPORT_LIMIT",
        "error",
        "import",
        `${message}, so the design cannot be imported as it is`,
        sourceRef,
      ),
    );
  for (const cell of ir.cells) {
    if (cell.parameters.length > MAX_FORMAL_PARAMETERS)
      refuse(
        `${cell.name} declares ${cell.parameters.length} parameters; a Cell takes at most ${MAX_FORMAL_PARAMETERS}`,
        cell.sourceRef,
      );
    for (const instance of cell.instances) {
      if (instance.terminals.length > MAX_PART_TERMINALS)
        refuse(
          `${instance.name} has ${instance.terminals.length} terminals; a part takes at most ${MAX_PART_TERMINALS}`,
          instance.sourceRef,
        );
      const parameters = Object.keys(instance.parameters).length;
      if (
        instance.target.kind === "external-subcircuit" &&
        parameters > MAX_FORMAL_PARAMETERS
      )
        refuse(
          `${instance.name} sets ${parameters} parameters of ${instance.target.masterName}; an external master takes at most ${MAX_FORMAL_PARAMETERS}`,
          instance.sourceRef,
        );
    }
  }
  return found;
}
