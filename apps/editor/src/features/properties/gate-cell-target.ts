// What Properties shows for a Library part that may be bound to a Cell of its
// Project (#1450) or to one of its external definitions (#1928).
import type { CircuitProject, Instance } from "@icm/model";
import {
  bindsExternalByPartPins,
  bindsProjectCell,
  libraryPartBinding,
  subcircuitDescriptor,
} from "@icm/devices";
import { gateCellTargets, gateExternalTargets } from "@icm/edit-engine";

/** The name of the Cell or definition a part is bound to, as its model shows it. */
export function gateCellTargetName(
  project: CircuitProject,
  instance: Instance,
): string | undefined {
  return libraryPartBinding(project, instance)?.name;
}

/** The Cells whose Pins fit a part drawn in this Cell; none for another part. */
export function gateCellChoices(
  project: CircuitProject,
  documentId: string,
  instance: Instance,
): string[] {
  if (!instance.netlist || !bindsProjectCell(instance.symbolId)) return [];
  return gateCellTargets(project, documentId, instance.symbolId).map(
    (cell) => cell.netlist.name,
  );
}

/** The external definitions whose ports fit a part; none for another part. */
export function gateExternalChoices(
  project: CircuitProject,
  instance: Instance,
): string[] {
  if (!instance.netlist || !bindsExternalByPartPins(project, instance.symbolId))
    return [];
  return gateExternalTargets(project, instance.symbolId).map(
    (definition) => definition.name,
  );
}

/**
 * A block's VDD and VSS rows. A part bound to a Cell or definition has those
 * it has Pins for: one that takes a supply globally has no Net to choose.
 */
export function blockSupplyTerminals(
  project: CircuitProject,
  instance: Instance,
): ("VDD" | "VSS")[] | undefined {
  const supplies = subcircuitDescriptor(
    instance.symbolId,
    project,
  )?.ports.flatMap((port) => (port.supply ? [port.supply] : []));
  const bound = libraryPartBinding(project, instance);
  return bound
    ? supplies?.filter((supply) =>
        bound.match.pins.some((pin) => pin.supply === supply),
      )
    : supplies;
}
