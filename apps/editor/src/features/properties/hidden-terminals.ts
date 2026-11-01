// The terminals of a part that no pin of its symbol draws, which Properties
// and the Agent's set-terminal-net set to a Net (#1833): a block's supplies,
// a Circuit Component's supply mappings, and a reviewed device's own
// terminals, such as a substrate or an inductor's centre tap.
import type { CircuitProject, Instance } from "@icm/model";
import { resolveReviewedExternalBinding } from "@icm/devices";
import { blockSupplyTerminals } from "./gate-cell-target";

export interface HiddenTerminal {
  /** The pin its Net membership names. */
  readonly pinName: string;
  /** What Properties calls it, before "Net": VDD, Substrate, CT. */
  readonly label: string;
  /**
   * The rail a supply takes while no Net is chosen (Auto). A device's own
   * terminal has none: unset, it is unconnected.
   */
  readonly rail?: "VDD" | "VSS";
}

export function hiddenTerminals(
  project: CircuitProject,
  instance: Instance,
): HiddenTerminal[] {
  const binding = instance.netlist?.binding;
  const definition =
    binding?.kind === "external-subcircuit"
      ? project.externalSubcircuitDefinitions.find(
          (candidate) => candidate.id === binding.definitionId,
        )
      : undefined;
  // A Circuit Component's artwork has no pin for a supply it maps.
  const mapping = definition
    ? project.componentDefinitions?.find(
        (component) =>
          component.symbol.id === instance.symbolId &&
          component.circuitBinding?.definitionId === definition.id,
      )?.circuitBinding
    : undefined;
  if (definition && mapping)
    return mapping.terminals.flatMap((item) => {
      if (!("supply" in item)) return [];
      const terminal = definition.terminals.find(
        (candidate) => candidate.id === item.terminalId,
      );
      return terminal
        ? [{ pinName: terminal.name, label: terminal.name, rail: item.supply }]
        : [];
    });
  const supplies = (blockSupplyTerminals(project, instance) ?? []).map(
    (supply) => ({ pinName: supply, label: supply, rail: supply }),
  );
  const reviewed =
    definition && !definition.presentation
      ? resolveReviewedExternalBinding(
          definition.name,
          definition.terminals.map((terminal) => terminal.name),
          instance.symbolId,
        )
      : undefined;
  // A standard cell's rails are the gate's VDD and VSS above (#1450).
  const own = (reviewed?.terminals ?? []).flatMap((terminal) =>
    terminal.interaction === "property" && !terminal.supply
      ? [
          {
            pinName: terminal.pinName,
            label:
              terminal.role === "substrate" ? "Substrate" : terminal.targetName,
          },
        ]
      : [],
  );
  return [...supplies, ...own];
}
