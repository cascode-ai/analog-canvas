// The terminals of a part that no pin of its symbol draws, which Properties
// and the Agent's set-terminal-net set to a Net (#1833): a block's supplies,
// a Circuit Component's supply mappings, and a reviewed device's own
// terminals, such as a substrate or an inductor's centre tap. A pin its
// variant hides counts, as an op-amp's VDD while its supply pins are hidden.
import type { CircuitProject, Instance } from "@icm/model";
import {
  resolveExternalTerminalBindings,
  subcircuitDescriptor,
} from "@icm/devices";
import { drawnPinNames, type SymbolResolver } from "@icm/symbols";
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
  resolver: SymbolResolver,
): HiddenTerminal[] {
  const resolved = resolver.resolve(
    instance.symbolId,
    instance.symbolVariantId,
  );
  const drawn = new Set(resolved ? drawnPinNames(resolved) : []);
  const binding = instance.netlist?.binding;
  const definition =
    binding?.kind === "external-subcircuit"
      ? project.externalSubcircuitDefinitions.find(
          (candidate) => candidate.id === binding.definitionId,
        )
      : undefined;
  const external = definition
    ? resolveExternalTerminalBindings(
        definition,
        instance.symbolId,
        project.componentDefinitions?.find(
          (component) => component.symbol.id === instance.symbolId,
        ),
      )
    : undefined;
  if (external?.source === "component")
    return external.terminals.flatMap(({ pinName, supply }) =>
      drawn.has(pinName)
        ? []
        : [{ pinName, label: pinName, ...(supply ? { rail: supply } : {}) }],
    );
  const supplies = (blockSupplyTerminals(project, instance) ?? []).flatMap(
    (supply) =>
      drawn.has(supply)
        ? []
        : [{ pinName: supply, label: supply, rail: supply }],
  );
  // A standard cell's rails are the gate's VDD and VSS above (#1450).
  const own = (external?.terminals ?? []).flatMap((terminal) =>
    terminal.interaction === "property" &&
    !terminal.supply &&
    !drawn.has(terminal.pinName)
      ? [
          {
            pinName: terminal.pinName,
            label:
              terminal.role === "substrate" ? "Substrate" : terminal.targetName,
          },
        ]
      : [],
  );
  // A fully differential op-amp's VOCM while its pin is hidden (#2443).
  const optional = (
    subcircuitDescriptor(instance.symbolId)?.ports ?? []
  ).flatMap((port) =>
    port.optional && !drawn.has(port.pinName)
      ? [{ pinName: port.pinName, label: port.pinName }]
      : [],
  );
  return [...supplies, ...own, ...optional];
}
