import {
  readSimulationExperimentConfig,
  type ProjectSimulationSetup,
  type SimulationExpression,
  type SimulationSourceExpression,
} from "@icm/model";
import { inspectSimulationSourceGraph } from "@icm/netlist";

/** Archive presentation can read historical expressions; it is not an authoring protocol. */
export type SimulationPresentationExpression =
  SimulationExpression | SimulationSourceExpression;
export interface SimulationPresentationOutput {
  id: string;
  label: string;
  expression: SimulationPresentationExpression;
}
export function sourcePresentation(setup: ProjectSimulationSetup) {
  const parsed = readSimulationExperimentConfig(setup);
  const root = setup.input.circuitBindings.find(
    (binding) => binding.emission === "top-level",
  );
  const kinds = new Set(
    inspectSimulationSourceGraph(setup.input).statements.flatMap(
      ({ statement }) => {
        const command =
          statement.kind === "control_command"
            ? statement.command
            : statement.kind === "directive"
              ? statement.name.replace(/^\./u, "")
              : "";
        return ["op", "ac", "dc", "tran", "noise"].includes(
          command.toLowerCase(),
        )
          ? [command.toUpperCase()]
          : [];
      },
    ),
  );
  return {
    setupId: setup.id,
    setupName: setup.name,
    analysisLabel: [...kinds].join(" + ") || "Native program",
    outputs: parsed.ok ? parsed.config.outputs : [],
    ...(root ? { rootDocumentId: root.documentId } : {}),
  };
}
export function presentationDependencies(
  expression: SimulationPresentationExpression,
): Array<
  Extract<SimulationPresentationExpression, { kind: "voltage" | "current" }>
> {
  if (expression.kind === "voltage" || expression.kind === "current")
    return [expression];
  if ("operand" in expression)
    return presentationDependencies(expression.operand);
  if ("left" in expression)
    return [
      ...presentationDependencies(expression.left),
      ...presentationDependencies(expression.right),
    ];
  return [];
}
