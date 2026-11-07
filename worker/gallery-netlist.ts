import { createDesignNetlistExport } from "@icm/netlist";
import { parseProject } from "@icm/project-protocol";

/**
 * A stored Project's SPICE netlist, or why it cannot be written. `instances`
 * names each top-level device's first line (from 0), as the editor's
 * Project Code locates them, so a reader can find it in the drawing.
 */
export function spiceNetlistOf(projectText: string):
  | {
      format: "spice";
      text: string;
      instances: { instanceId: string; line: number }[];
    }
  | { format: "spice"; blocked: string[] } {
  try {
    const project = parseProject(projectText);
    const result = createDesignNetlistExport(project, {
      format: "spice",
      includeLocations: true,
    });
    if (result.status === "blocked")
      return {
        format: "spice",
        blocked: result.diagnostics
          .filter((diagnostic) => diagnostic.severity === "error")
          .map((diagnostic) => diagnostic.message),
      };
    const text = result.file.text;
    return {
      format: "spice",
      text,
      instances: result.locations.instances
        .filter((place) => place.documentId === project.topDocumentId)
        .map((place) => ({
          instanceId: place.instanceId,
          line: text.slice(0, place.startOffset).split("\n").length - 1,
        })),
    };
  } catch (error) {
    return {
      format: "spice",
      blocked: [error instanceof Error ? error.message : String(error)],
    };
  }
}
