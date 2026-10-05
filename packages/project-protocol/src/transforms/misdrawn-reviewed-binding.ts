import {
  deviceDescriptor,
  resolveReviewedExternalBinding,
  reviewedExternalBindingSupportsSymbol,
} from "@icm/devices";
import type { CircuitProject } from "@icm/model";

/**
 * Return a part bound to a reviewed PDK device drawn for another symbol to the
 * ideal device its own symbol stands for.
 *
 * From 2026-10-01 (#1272) until #1298 the SKY130 varactor
 * `sky130_fd_pr__cap_var_lvt` was offered to the Variable Capacitor. Its
 * terminals name the plain capacitor's pins 1 and 2 (and a substrate B set in
 * Properties), while a Var Cap's pins are P1 and P2, so a bound Var Cap could
 * be neither wired nor exported, and every Project edit was refused while one
 * existed. A Var Cap is a generic tunable capacitor and takes no reviewed
 * model, so it opens as an ideal Var Cap again.
 *
 * Only a part that could never work is touched: one drawn as a built-in ideal
 * device whose pins the reviewed device's drawn terminals are not. What the
 * binding added goes — the binding itself, the device's parameters (`w`, `l`,
 * `vm`) and its Net memberships at pins the symbol does not have (the
 * substrate). Its wires, labels and any authored `value` stay. No value is
 * invented: the binding removed the Var Cap's value when it was set, and the
 * netlist asks for one until the author enters it. The definition stays, as
 * clearing a model leaves it.
 *
 * This runs on every load rather than as a numbered migration step, like the
 * bound format override repair: a reviewed device drawn with a symbol whose
 * pins it lacks is never valid, whichever version or client wrote the file.
 */
export function repairMisdrawnReviewedBindings(
  project: CircuitProject,
): CircuitProject {
  const definitions = new Map(
    project.externalSubcircuitDefinitions.map((definition) => [
      definition.id,
      definition,
    ]),
  );
  let repaired: CircuitProject | undefined;
  for (const [documentIndex, document] of project.documents.entries()) {
    for (const [instanceIndex, instance] of document.instances.entries()) {
      const binding = instance.netlist?.binding;
      if (binding?.kind !== "external-subcircuit") continue;
      const definition = definitions.get(binding.definitionId);
      if (!definition || definition.presentation) continue;
      const reviewed = resolveReviewedExternalBinding(
        definition.name,
        definition.terminals.map((terminal) => terminal.name),
      );
      if (
        !reviewed ||
        reviewedExternalBindingSupportsSymbol(reviewed, instance.symbolId)
      )
        continue;
      const device = deviceDescriptor(instance.symbolId, project);
      if (device?.targetPolicy !== "builtin") continue;
      const devicePins = new Set(device.pinOrder);
      if (
        reviewed.terminals.every(
          (terminal) =>
            terminal.interaction !== "canvas" ||
            devicePins.has(terminal.pinName),
        )
      )
        continue;

      repaired ??= structuredClone(project);
      const target = repaired.documents[documentIndex]!;
      const part = target.instances[instanceIndex]!;
      const ownParameters = new Set(
        device.parameters.map((parameter) => parameter.name.toLowerCase()),
      );
      part.netlist = {
        ...part.netlist!,
        binding: { kind: "primitive", deviceClass: device.deviceClass },
        parameters: Object.fromEntries(
          Object.entries(part.netlist!.parameters).filter(([name]) =>
            ownParameters.has(name.toLowerCase()),
          ),
        ),
      };
      const bindingPins = new Set(
        reviewed.terminals.map((terminal) => terminal.pinName.toLowerCase()),
      );
      for (const net of target.nets) {
        net.terminals = net.terminals.filter(
          (terminal) =>
            terminal.instanceId !== part.id ||
            devicePins.has(terminal.pinName) ||
            !bindingPins.has(terminal.pinName.toLowerCase()),
        );
      }
    }
  }
  return repaired ?? project;
}
