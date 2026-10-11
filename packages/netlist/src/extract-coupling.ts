// Coupled inductors: each Cell's couplings as `K` elements over its own
// inductor cards, and the node order that gives those cards their dots.
import { couplableInductorPins } from "@icm/derived";
import type { SchematicDocument } from "@icm/model";
import { parseSpiceNumber } from "@icm/spice";
import type {
  DesignNetlistCell,
  DesignNetlistCoupling,
  DesignNetlistInstance,
  NetlistDiagnostic,
} from "./ir.js";
import { diagnostic } from "./extract-common.js";
import type { NetlistFormat } from "./net-name-codec.js";
import { signedControlGain } from "./controlled-current.js";

/**
 * The Cell's couplings, with each coupled inductor's card turned to start at
 * its dotted node. An inductor in several couplings is turned by its first
 * one; a later coupling dotting the other end prints its k negated, which
 * reads the same to SPICE.
 */
export function extractInductorCouplings(
  document: SchematicDocument,
  instances: DesignNetlistInstance[],
  diagnostics: NetlistDiagnostic[],
): DesignNetlistCoupling[] {
  const couplings = document.inductorCouplings ?? [];
  if (!couplings.length) return [];
  const sources = new Map(
    document.instances.map((instance) => [instance.id, instance]),
  );
  const cards = new Map(instances.map((card) => [card.id, card]));
  const dotted = new Map<string, string>();
  const extracted: DesignNetlistCoupling[] = [];
  for (const coupling of couplings) {
    const members = coupling.members.map((member) => {
      const source = sources.get(member.instanceId);
      const card = cards.get(member.instanceId);
      const pins = source ? couplableInductorPins(source.symbolId) : null;
      return card &&
        pins?.includes(member.dotPin) &&
        card.invocationKind === "primitive" &&
        card.deviceClass === "inductor"
        ? { member, card }
        : null;
    });
    if (members.some((member) => member === null)) {
      const missing = coupling.members.filter(
        (_member, index) => members[index] === null,
      );
      diagnostic(
        diagnostics,
        document.id,
        "INDUCTOR_COUPLING_MEMBER_INVALID",
        `Coupling ${coupling.name} needs two inductors of this Cell; ${missing
          .map(
            (member) =>
              sources.get(member.instanceId)?.reference ?? member.instanceId,
          )
          .join(" and ")} cannot be coupled`,
        [coupling.id, ...missing.map((member) => member.instanceId)],
      );
      continue;
    }
    const k = parseSpiceNumber(coupling.k.trim());
    if (k && Math.abs(k.value) > 1)
      diagnostic(
        diagnostics,
        document.id,
        "INDUCTOR_COUPLING_OUT_OF_RANGE",
        `Coupling ${coupling.name}'s k=${coupling.k} lies outside -1 to 1`,
        [coupling.id],
        "error",
        "k",
      );
    let polarity: 1 | -1 = 1;
    for (const { member, card } of members as NonNullable<
      (typeof members)[number]
    >[]) {
      const fixed = dotted.get(card.id);
      if (fixed === undefined) {
        dotted.set(card.id, member.dotPin);
        const first = card.nodes.findIndex(
          (node) => node.pinName === member.dotPin,
        );
        if (first > 0) card.nodes = [...card.nodes].reverse();
      } else if (fixed !== member.dotPin) polarity = polarity === 1 ? -1 : 1;
    }
    extracted.push({
      id: coupling.id,
      reference: coupling.name,
      inductorIds: [
        coupling.members[0].instanceId,
        coupling.members[1].instanceId,
      ],
      k: coupling.k.trim(),
      polarity,
    });
  }
  return extracted;
}

/**
 * Give each coupling its printed name once the dialect has named the cards:
 * SPICE reads a `K` element, so a name that does not start with K gains one;
 * Spectre names the instance as written. Never one a card already uses.
 */
export function projectCouplingReferences(
  cell: DesignNetlistCell,
  format: NetlistFormat,
): void {
  if (!cell.couplings?.length) return;
  const used = new Set(
    cell.instances.map((instance) => instance.reference.toLowerCase()),
  );
  for (const coupling of cell.couplings) {
    const name = coupling.reference.replace(/[^A-Za-z0-9_]/gu, "_");
    const base =
      format === "spice" && !/^k/iu.test(name)
        ? `K${name}`
        : /^[A-Za-z_]/u.test(name)
          ? name
          : `K${name}`;
    let reference = base;
    for (let suffix = 2; used.has(reference.toLowerCase()); suffix++)
      reference = `${base}_${suffix}`;
    used.add(reference.toLowerCase());
    coupling.reference = reference;
  }
}

/** k as printed: the authored text, negated when the dots disagree. */
export function printedCouplingValue(
  coupling: DesignNetlistCoupling,
  format: NetlistFormat,
): string {
  if (coupling.polarity === 1) return coupling.k;
  if (!parseSpiceNumber(coupling.k))
    return signedControlGain(coupling.k, -1, format);
  return coupling.k.startsWith("-")
    ? coupling.k.slice(1)
    : `-${coupling.k.replace(/^\+/u, "")}`;
}
