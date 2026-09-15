import {
  readSimulationExperimentConfig,
  type ProjectSimulationFolder,
  type SimulationExpression,
  type SimulationSourceExpression,
} from "@icm/model";
import {
  inspectSimulationSourceGraph,
  inspectVacaskSourceGraph,
} from "@icm/netlist";

/** Archive presentation can read historical expressions; it is not an authoring protocol. */
export type SimulationPresentationExpression =
  SimulationExpression | SimulationSourceExpression;
export interface SimulationPresentationOutput {
  id: string;
  label: string;
  expression: SimulationPresentationExpression;
}
export function sourcePresentation(folder: ProjectSimulationFolder) {
  const parsed = readSimulationExperimentConfig(folder);
  const root = folder.input.circuitBindings.find(
    (binding) => binding.emission === "top-level",
  );
  let swept = false;
  const kinds = new Set(
    parsed.ok && parsed.authority === "code"
      ? inspectVacaskSourceGraph(folder.input).statements.flatMap(
          ({ statement }) => {
            const tokens = statement.tokens;
            const kind =
              tokens[0]?.value === "analysis" ? tokens[2]?.value : undefined;
            if (tokens[0]?.value === "sweep") {
              swept = true;
              return [];
            }
            const label = kind === "op" && swept ? "dc" : kind;
            swept = false;
            return label && ["op", "dc", "ac", "tran", "noise"].includes(label)
              ? [label.toUpperCase()]
              : [];
          },
        )
      : inspectSimulationSourceGraph(folder.input).statements.flatMap(
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
    folderId: folder.id,
    folderName: folder.name,
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
