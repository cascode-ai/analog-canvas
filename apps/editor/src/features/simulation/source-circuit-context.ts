import type { CircuitProject, SimulationSourceInput } from "@icm/model";
import { inspectSimulationSourceGraph } from "@icm/netlist";

/** Static source dependencies, not a claim that a subcircuit was instantiated. */
export function sourceCircuitContext(
  project: CircuitProject,
  input: SimulationSourceInput,
) {
  const graph = inspectSimulationSourceGraph(input);
  const uncertain =
    graph.diagnostics.some((d) => d.severity === "error") ||
    graph.statements.some(
      ({ statement }) =>
        statement.kind === "control_command" &&
        ["source", "circbyline"].includes(statement.command.toLowerCase()),
    );
  const references = input.circuitBindings.filter((binding) =>
    graph.paths.includes(binding.path),
  );
  const documentIds = new Set<string>();
  const visit = (id: string) => {
    if (documentIds.has(id)) return;
    documentIds.add(id);
    for (const instance of project.documents.find((doc) => doc.id === id)
      ?.instances ?? []) {
      if (instance.netlist?.binding?.kind === "subcircuit")
        visit(instance.netlist.binding.childDocumentId);
    }
  };
  references.forEach((binding) => visit(binding.documentId));
  const overrides = graph.statements.some(
    ({ statement }) =>
      statement.kind === "control_command" &&
      ["alter", "altermod", "alterparam"].includes(
        statement.command.toLowerCase(),
      ),
  );
  return {
    documentIds,
    uncertain,
    label: uncertain
      ? "Circuit sources: check during Prepare"
      : references.length
        ? "Canvas source: " +
          references
            .map(
              (binding) =>
                `${project.documents.find((doc) => doc.id === binding.documentId)?.name ?? binding.documentId} (${binding.emission === "subcircuit" ? "subcircuit" : "top-level"})`,
            )
            .join(", ")
        : "Text circuit · no Canvas source",
    paths: [...new Set(graph.paths)].filter(
      (path) =>
        input.files.some((file) => file.path === path) ||
        references.some((binding) => binding.path === path),
    ),
    overrides,
  };
}
