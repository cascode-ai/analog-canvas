// The IDs and References a paste gives the objects it creates.
import type { RouteBranch } from "@icm/model";
import { createdRouteChildIds } from "@icm/model";

/**
 * What a paste numbers: an identity without the `-copy-N` that earlier copies
 * chained onto it (`GND1-copy-2-copy-7`) or the `_N` of the paste it came
 * from (`R1_2`).
 */
function copyIdStem(id: string): string {
  return (
    (id.replace(/-copy-\d+(?:-\d+)?/gu, "") || id).replace(/_\d+$/u, "") || id
  );
}

/**
 * A pasted object is a new object, so a copy never grows its identity: every
 * object of one paste takes its stem and one shared ordinal, the first that
 * none of them finds taken (`R1` pastes as `R1_2`, and that as `R1_3`);
 * objects that share a stem take consecutive ones. The ordinal is shared
 * because identities derive from one another, `power-label-vdd1` belonging to
 * `VDD1`, and one suffix keeps such pairs; a label named after the object it
 * is anchored to is named after that object's copy. A copy never takes its
 * source's identity, even where that is free: the Edit Engine tells a clone
 * from its source by it.
 */
export function pastedIdentities(
  ids: readonly string[],
  routes: readonly RouteBranch[],
  owned: readonly { id: string; ownerId: string }[],
  occupied: ReadonlySet<string>,
  occupiedRouteChildren: ReadonlySet<string>,
): Map<string, string> {
  const stems = new Map<string, string[]>();
  for (const id of new Set(ids)) {
    const stem = copyIdStem(id);
    stems.set(stem, [...(stems.get(stem) ?? []), id]);
  }
  for (const members of stems.values()) members.sort();
  const fits = (pasted: ReadonlyMap<string, string>) =>
    [...pasted].every(
      ([id, candidate]) => candidate !== id && !occupied.has(candidate),
    ) &&
    // A Route's Leg and Bend IDs derive from its own; split Routes keep the
    // children of the Route they came from, so a freed Route ID can still
    // have its derived children in the Document.
    routes.every(
      (route) =>
        !createdRouteChildIds(pasted.get(route.id)!, route.legs.length).some(
          (child) => occupiedRouteChildren.has(child),
        ),
    );
  let pasted = new Map<string, string>();
  for (let ordinal = 2; pasted.size === 0 || !fits(pasted); ordinal += 1)
    pasted = new Map(
      [...stems].flatMap(([stem, members]) =>
        members.map((id, index) => [id, `${stem}_${ordinal + index}`] as const),
      ),
    );
  const taken = new Set(pasted.values());
  for (const { id, ownerId } of owned) {
    const owner = pasted.get(ownerId);
    const current = pasted.get(id);
    if (!owner || !current) continue;
    const prefix = id.slice(0, id.length - ownerId.length);
    const derived = !prefix.endsWith("-")
      ? null
      : id === `${prefix}${ownerId}`
        ? `${prefix}${owner}`
        : id === `${prefix}${ownerId.toLowerCase()}`
          ? `${prefix}${owner.toLowerCase()}`
          : null;
    if (!derived || derived === current) continue;
    if (derived === id || occupied.has(derived) || taken.has(derived)) continue;
    taken.delete(current);
    taken.add(derived);
    pasted.set(id, derived);
  }
  return pasted;
}

/** Allocate a sole authored Reference for schematic-only Instance kinds. */
export function nextUnconstrainedReference(
  current: string,
  sequence: number,
  occupied: ReadonlySet<string>,
  reserved: ReadonlySet<string>,
): string {
  const suffix = /^(.*?)(\d+)$/u.exec(current);
  const prefix = suffix?.[1] || `${current}-`;
  let ordinal = suffix ? Number(suffix[2]) + 1 : sequence + 1;
  while (true) {
    const digits = String(ordinal);
    const candidate = `${prefix.slice(0, Math.max(1, 128 - digits.length))}${digits}`;
    const folded = candidate.toLowerCase();
    if (!occupied.has(folded) && !reserved.has(folded)) return candidate;
    ordinal += 1;
  }
}
