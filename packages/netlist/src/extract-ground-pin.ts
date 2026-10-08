// Ground as a Cell's own pin: whether a Cell takes one, what it is named,
// and where it sits among the Cell's pins.
import { foldNetName } from "@icm/model";
import { resolveDocumentLogicalNets } from "@icm/derived";
import type { SchematicDocument } from "@icm/model";
import { withNetlistPowerMarkerClaims } from "./extract-nets.js";
import { isDrawnSwitch } from "./extract-switch.js";

/** The formal pin name a Cell's ground takes, matching the Block libraries. */
export const GROUND_PORT_NAME = "VSS";

/**
 * Whether a Cell meets ground at all — its own node `0`, or any Cell it
 * instantiates that does.
 *
 * The answer has to be the same on both sides of a hierarchy call, and both
 * sides compute it from the Documents alone rather than from whichever cell
 * happened to be extracted first. A Cell that only passes ground through to a
 * child still needs the pin: otherwise the child's reference would have
 * nowhere to come from.
 */
export function cellReachesGround(
  document: SchematicDocument,
  documentsById: Map<string, SchematicDocument>,
  seen: Set<string> = new Set(),
): boolean {
  if (seen.has(document.id)) return false;
  seen.add(document.id);
  // Read the same Document the node names come from: a drawn Ground marker
  // that predates the persisted claim record is recovered by the export view,
  // and most drawings are exactly that. Asking the unrecovered Document would
  // answer "no ground" for a Cell whose nodes are about to be named `0`.
  const groundOfItsOwn = resolveDocumentLogicalNets(
    withNetlistPowerMarkerClaims(document),
  ).groups.some((group) => group.powerDomain === "ground");
  if (groundOfItsOwn) return true;
  // A drawn switch reads its control against ground, so its Cell needs one.
  if (document.instances.some((instance) => isDrawnSwitch(instance.symbolId)))
    return true;
  return document.instances.some((instance) => {
    const binding = instance.netlist?.binding;
    if (binding?.kind !== "subcircuit") return false;
    const child = documentsById.get(binding.childDocumentId);
    return child ? addsGroundPin(child, documentsById, seen) : false;
  });
}

/**
 * Whether a Cell printed as a subcircuit adds a ground pin of its own
 * making: it meets ground, and its author gave ground no pin. A caller passes
 * its ground only to such a pin. A call to a Cell whose author's GNDA was its
 * ground carried one node more than the Cell had pins.
 */
export function addsGroundPin(
  document: SchematicDocument,
  documentsById: Map<string, SchematicDocument>,
  seen: Set<string> = new Set(),
): boolean {
  if (!cellReachesGround(document, documentsById, seen)) return false;
  const logical = resolveDocumentLogicalNets(
    withNetlistPowerMarkerClaims(document),
  );
  return !(document.netlist?.terminals ?? []).some((terminal) => {
    const name = logical.byBaseNetId.get(terminal.netId)?.name;
    return name !== undefined && foldNetName(name) === foldNetName("0");
  });
}

/**
 * The name of the ground pin a Cell adds: VSS, as the Block libraries write
 * it, unless the Cell gives that name to another Net or Pin (#1353). A Cell
 * with ± supplies draws ground and a Port VSS, its negative supply; two pins
 * named VSS shorted the two inside the Cell and in every caller. Then GND, or
 * GND__2 and on, as an imported name is told apart from an authored one.
 * `taken` is the author's spelling of the name that was in the way. Both the
 * Cell and its callers read it from the Document.
 */
export function groundPinName(document: SchematicDocument): {
  name: string;
  taken?: string;
} {
  const names = new Map<string, string>();
  const logical = resolveDocumentLogicalNets(
    withNetlistPowerMarkerClaims(document),
  );
  const isGround = (name: string | undefined) =>
    name !== undefined && foldNetName(name) === foldNetName("0");
  for (const group of logical.groups)
    if (group.name && !isGround(group.name))
      names.set(foldNetName(group.name), group.name);
  for (const terminal of document.netlist?.terminals ?? [])
    names.set(foldNetName(terminal.name), terminal.name);
  // An imported node keeps its deck's name when nothing else names it.
  const pinned = new Set(
    (document.netlist?.terminals ?? []).map(
      (terminal) => logical.byBaseNetId.get(terminal.netId)?.id,
    ),
  );
  for (const evidence of document.connectivityEvidence) {
    if (evidence.kind !== "net-name-hint") continue;
    const group = logical.byBaseNetId.get(evidence.netId);
    if (group?.name || pinned.has(group?.id)) continue;
    if (!names.has(foldNetName(evidence.sourceName)))
      names.set(foldNetName(evidence.sourceName), evidence.sourceName);
  }
  const taken = names.get(foldNetName(GROUND_PORT_NAME));
  if (taken === undefined) return { name: GROUND_PORT_NAME };
  for (let index = 1; ; index += 1) {
    const name = index === 1 ? "GND" : `GND__${index}`;
    if (!names.has(foldNetName(name))) return { name, taken };
  }
}

/**
 * Where the ground pin sits in a Cell's interface: after the supplies the
 * author declared, so every Cell reads `VDD VSS …` the way the Block library
 * already writes it, and before the first signal.
 */
export function groundPortIndex(
  document: SchematicDocument,
  ports: readonly { id: string; name?: string }[],
): number {
  const logicalNets = resolveDocumentLogicalNets(document);
  let index = 0;
  for (const [position, port] of ports.entries()) {
    const domain = logicalNets.byBaseNetId.get(port.id)?.powerDomain;
    if (domain === "vdd" || port.name?.toUpperCase() === "VDD")
      index = position + 1;
  }
  return index;
}
