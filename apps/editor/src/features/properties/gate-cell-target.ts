// What Properties shows for a Library gate that may be bound to a Cell of
// its Project (#1450).
import type { CircuitProject, Instance } from "@icm/model";
import {
  gateCellBinding,
  isLibraryLogicGate,
  subcircuitDescriptor,
} from "@icm/devices";
import { gateCellTargets } from "@icm/edit-engine";

/** The name of the Cell a gate is bound to, as its model shows it. */
export function gateCellTargetName(
  project: CircuitProject,
  instance: Instance,
): string | undefined {
  return gateCellBinding(project, instance)?.cell.netlist?.name;
}

/** The Cells whose Pins fit a gate drawn in this Cell; none for another part. */
export function gateCellChoices(
  project: CircuitProject,
  documentId: string,
  instance: Instance,
): string[] {
  if (!instance.netlist || !isLibraryLogicGate(instance.symbolId)) return [];
  return gateCellTargets(project, documentId, instance.symbolId).map(
    (cell) => cell.netlist.name,
  );
}

/**
 * A block's VDD and VSS rows. A gate bound to a Cell has those its Cell has
 * Pins for: a Cell that takes a supply globally has no Net to choose.
 */
export function blockSupplyTerminals(
  project: CircuitProject,
  instance: Instance,
): ("VDD" | "VSS")[] | undefined {
  const supplies = subcircuitDescriptor(
    instance.symbolId,
    project,
  )?.ports.flatMap((port) => (port.supply ? [port.supply] : []));
  const bound = gateCellBinding(project, instance);
  return bound
    ? supplies?.filter((supply) =>
        bound.match.pins.some((pin) => pin.supply === supply),
      )
    : supplies;
}
