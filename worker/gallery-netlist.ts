import { createDesignNetlistExport } from "@icm/netlist";
import { parseProject } from "@icm/project-protocol";

/** A stored Project's SPICE netlist, or why it cannot be written. */
export function spiceNetlistOf(
  projectText: string,
): { format: "spice"; text: string } | { format: "spice"; blocked: string[] } {
  try {
    const result = createDesignNetlistExport(parseProject(projectText), {
      format: "spice",
    });
    return result.status === "blocked"
      ? {
          format: "spice",
          blocked: result.diagnostics
            .filter((diagnostic) => diagnostic.severity === "error")
            .map((diagnostic) => diagnostic.message),
        }
      : { format: "spice", text: result.file.text };
  } catch (error) {
    return {
      format: "spice",
      blocked: [error instanceof Error ? error.message : String(error)],
    };
  }
}
