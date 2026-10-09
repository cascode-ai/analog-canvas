// Cell findings read once node names are final: MOS bodies on a default or
// another supply, and p-substrate terminals above a negative supply.
import { foldNetName } from "@icm/model";
import {
  drawnNegativeSupplyNet,
  mosBodiesOffSourceSupply,
  mosBulkKind,
  type PlacedMosBodies,
} from "@icm/derived";
import type { SchematicDocument } from "@icm/model";
import { reviewedExternalBindingById } from "@icm/devices";
import type {
  DesignNetlistCell,
  DesignNetlistInstance,
  NetlistDiagnostic,
} from "./ir.js";
import { implicitSupplyNetId } from "./implicit-mos-supplies.js";
import { diagnostic } from "./extract-common.js";
import type { CellNetContext } from "./extract-nets.js";

/**
 * The hidden p-substrate terminals left on ground in a Cell that draws a
 * negative supply (#1530): an NPN's S, a poly resistor's or varactor's B, an
 * inductor's SUB. The PDK ties them all to the one p-substrate, which belongs
 * on the lowest supply. An NPN whose collector swings below ground then
 * forward-biases its collector-substrate junction, and a run counts a current
 * no circuit draws. A part the Process binds after the rail is drawn takes
 * the rail; one bound before it took ground, and is named here. A SKY130 PNP
 * has no such terminal: its wrapper ties the substrate to its collector.
 */
export function reportSubstratesAboveNegativeSupply(
  document: SchematicDocument,
  context: CellNetContext,
  instances: readonly DesignNetlistInstance[],
  diagnostics: NetlistDiagnostic[],
): void {
  const negative = drawnNegativeSupplyNet(document, context.logicalNets);
  const supply = negative ? context.nameByNetId.get(negative.id) : undefined;
  if (!supply) return;
  const ground = context.nameByAuthoredName.get(foldNetName("0")) ?? "0";
  const terminals = instances.flatMap((instance) =>
    (
      reviewedExternalBindingById(instance.reviewedExternalBindingId)
        ?.terminals ?? []
    ).flatMap((terminal) => {
      const node = instance.nodes.find(
        (item) => item.pinName === terminal.targetName,
      );
      return terminal.role === "substrate" &&
        terminal.interaction === "property" &&
        (node?.netName === ground || node?.netName === "0")
        ? [{ instance, pinName: terminal.pinName }]
        : [];
    }),
  );
  if (!terminals.length) return;
  const names = terminals
    .map(
      ({ instance, pinName }) =>
        `${document.instances.find((item) => item.id === instance.id)?.reference ?? instance.reference}.${pinName}`,
    )
    .sort((left, right) => left.localeCompare(right, "en", { numeric: true }));
  const one = names.length === 1;
  diagnostic(
    diagnostics,
    document.id,
    "PDK_SUBSTRATE_ABOVE_NEGATIVE_SUPPLY",
    `${one ? `${names[0]} is a p-substrate terminal` : `${partList(names)} are p-substrate terminals`} on ground, while this Cell draws ${supply}, its negative supply. The substrate belongs on the lowest supply: an NPN collector below it forward-biases. Set ${one ? "its" : "their"} Substrate Net to ${supply}`,
    [...new Set(terminals.map(({ instance }) => instance.id))],
    "warning",
  );
}

/** `M1`, `M1 and M2`, `M1, M2 and M3`; a long list ends in a count. */
export function partList(names: readonly string[]): string {
  const shown =
    names.length > 8
      ? [...names.slice(0, 7), `${names.length - 7} more`]
      : names;
  return shown.length === 1
    ? shown[0]!
    : `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)!}`;
}

/**
 * Which MOS bodies took a supply this export added to the Cell, and which pin
 * that supply became (#1302). A body with no Net takes the conventional VDD or
 * ground, and a Cell that draws neither gets it as a new Cell Pin, VDD and
 * VSS together. That is the documented default, yet it added a fourth
 * terminal nobody drew without a word: an LDO's pass device got a VDD pin
 * where its body was meant to be the input. Information, as a generated Net
 * name is: the netlist and every gate stay as they were.
 */
export function reportDefaultBodySupplies(
  document: SchematicDocument,
  context: CellNetContext,
  ports: DesignNetlistCell["ports"],
  diagnostics: NetlistDiagnostic[],
): void {
  const added = (["VDD", "0"] as const).flatMap((supply) => {
    const net = document.nets.find(
      (candidate) => candidate.id === implicitSupplyNetId(document.id, supply),
    );
    const group = net ? context.logicalNets.byBaseNetId.get(net.id) : undefined;
    // A Net the author drew joined it: the Cell had this supply already.
    if (!net || group?.baseNetIds.length !== 1) return [];
    const pin = ports.find(
      (port) => context.logicalNets.byBaseNetId.get(port.id)?.id === group.id,
    );
    if (!pin) return [];
    const bodies = net.terminals.flatMap((terminal) => {
      if (terminal.pinName !== "B") return [];
      const instance = document.instances.find(
        (candidate) => candidate.id === terminal.instanceId,
      );
      return instance && mosBulkKind(instance)
        ? [{ id: instance.id, name: instance.reference ?? instance.id }]
        : [];
    });
    bodies.sort((left, right) =>
      left.name.localeCompare(right.name, "en", { numeric: true }),
    );
    return [{ supply, pin: pin.name, bodies }];
  });
  for (const { supply, pin, bodies } of added) {
    if (!bodies.length) continue;
    // VDD and ground come as a pair; say so when the other one has no body.
    const companion = added.find(
      (other) => other.supply !== supply && !other.bodies.length,
    );
    const one = bodies.length === 1;
    const subject = one
      ? `${bodies[0]!.name}'s body has no Net and takes`
      : `The bodies of ${partList(bodies.map((body) => body.name))} have no Net and take`;
    const taken =
      supply === "VDD"
        ? `the conventional ${pin}, added to this Cell's pins${companion ? ` with ${companion.pin}` : ""}`
        : `the conventional ground, added to this Cell's pins as ${pin}${companion ? `, with ${companion.pin}` : ""}`;
    diagnostic(
      diagnostics,
      document.id,
      "MOS_BODY_DEFAULT_SUPPLY",
      `${subject} ${taken}; connect ${one ? "its B pin" : "a B pin"} to choose another body`,
      bodies.map((body) => body.id),
      "info",
    );
  }
}

/**
 * A MOS whose body follows a default onto one supply while its source is on
 * another supply of the same domain (#1336): a level shifter's VDDH PMOS with
 * its body on the Cell's PMOS default VDDL, forward-biased when VDDH is the
 * higher supply. The drawing holds no voltages, and most such bodies sit on
 * the higher supply on purpose, so this is a question, not a warning; a body
 * wired explicitly is the answer and is never asked about. A body with no Net
 * is asked about the same way: a Cell with two supplies has no default to
 * give it, and the conventional VDD or ground it takes then need not be its
 * source's.
 */
export function reportBodiesOffSourceSupply(
  document: SchematicDocument,
  context: CellNetContext,
  placedBodies: PlacedMosBodies | undefined,
  diagnostics: NetlistDiagnostic[],
): void {
  // Node 0 reads as ground.
  const spoken = (node: string) => (node === "0" ? "ground" : node);
  for (const item of mosBodiesOffSourceSupply(
    document,
    context.logicalNets,
    placedBodies,
  )) {
    const bodyNode = context.nameByNetId.get(item.bodyNet.id);
    const sourceNode = context.nameByNetId.get(item.sourceNet.id);
    if (!bodyNode || !sourceNode || bodyNode === sourceNode) continue;
    const body = spoken(bodyNode);
    const source = spoken(sourceNode);
    const kind = mosBulkKind(item.instance)!.toUpperCase();
    const follows =
      item.status === "conventional"
        ? `has no Net and takes the conventional ${body}`
        : item.status === "instance-override"
          ? `keeps the ${kind} default it was copied with, ${body}`
          : `follows the Cell's ${kind} default ${body}`;
    diagnostic(
      diagnostics,
      document.id,
      "MOS_BODY_OTHER_SUPPLY",
      `${item.instance.reference ?? item.instance.id}'s body ${follows}; its source is on ${source}. Connect its B pin to ${source} if that is the body you mean`,
      [item.instance.id],
      "info",
    );
  }
}
