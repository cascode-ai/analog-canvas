// A coupled inductor's Properties: which end carries its dot, and each
// coupling it is in, keyed by the coupling's name.
import {
  couplableInductorPins,
  couplesInstances,
  inductorCouplingsOf,
  isCouplableInductor,
  nextInductorCouplingName,
} from "@icm/derived";
import type { SchematicEdit } from "@icm/edit-engine";
import type { InductorCoupling, SchematicDocument } from "@icm/model";

type Instance = SchematicDocument["instances"][number];

export interface InductorCouplingEntryCode {
  /** The other inductor's Instance ID. */
  with: string;
  k: string;
  arrow: boolean;
}

export interface InductorCouplingPropertyContext {
  pins: readonly [string, string];
  /** Its dotted end: what its couplings say, or its first pin. */
  dot: string;
  couplings: Readonly<Record<string, InductorCouplingEntryCode>>;
  /** The other inductors of the Cell, labelled by Reference. */
  partners: readonly { value: string; label: string }[];
}

export interface InductorCouplingPropertyValue {
  dot?: string;
  coupling?: Record<string, InductorCouplingEntryCode>;
}

function memberOf(coupling: InductorCoupling, instanceId: string) {
  return coupling.members.find((member) => member.instanceId === instanceId);
}

function partnerOf(coupling: InductorCoupling, instanceId: string) {
  return coupling.members.find((member) => member.instanceId !== instanceId)!;
}

/** The dotted end an inductor's couplings give it, else its first pin. */
function inductorDotPin(
  document: SchematicDocument,
  instance: Instance,
): string | null {
  const pins = couplableInductorPins(instance.symbolId);
  if (!pins) return null;
  const first = inductorCouplingsOf(document, instance.id)[0];
  return (first && memberOf(first, instance.id)?.dotPin) ?? pins[0];
}

export function inductorCouplingPropertyContext(
  document: SchematicDocument,
  instance: Instance,
): InductorCouplingPropertyContext | undefined {
  const pins = couplableInductorPins(instance.symbolId);
  if (!pins) return undefined;
  return {
    pins,
    dot: inductorDotPin(document, instance)!,
    couplings: Object.fromEntries(
      inductorCouplingsOf(document, instance.id).map((coupling) => [
        coupling.name,
        {
          with: partnerOf(coupling, instance.id).instanceId,
          k: coupling.k,
          arrow: coupling.arrow !== false,
        },
      ]),
    ),
    partners: document.instances
      .filter(
        (candidate) =>
          candidate.id !== instance.id && isCouplableInductor(candidate),
      )
      .map((candidate) => ({
        value: candidate.id,
        label: candidate.reference ?? candidate.id,
      })),
  };
}

/** Shown only once the inductor is coupled; an uncoupled one may add them. */
export function inductorCouplingPropertyValue(
  context: InductorCouplingPropertyContext | undefined,
): InductorCouplingPropertyValue {
  if (!context || !Object.keys(context.couplings).length) return {};
  return {
    dot: context.dot,
    coupling: structuredClone(context.couplings) as Record<
      string,
      InductorCouplingEntryCode
    >,
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function parseInductorCouplingProperties(
  decoded: Record<string, unknown>,
  instanceId: string,
  context: InductorCouplingPropertyContext | undefined,
): InductorCouplingPropertyValue {
  if (!context) {
    for (const key of ["dot", "coupling"])
      if (key in decoded)
        throw new Error(`${key} is only available for an inductor`);
    return {};
  }
  const shown = Object.keys(context.couplings).length > 0;
  const value: InductorCouplingPropertyValue = {};
  if ("dot" in decoded) {
    if (typeof decoded.dot !== "string" || !context.pins.includes(decoded.dot))
      throw new Error(
        `dot must be ${context.pins.map((pin) => JSON.stringify(pin)).join(" or ")}`,
      );
    value.dot = decoded.dot;
  } else if (shown) throw new Error("dot is required for a coupled inductor");
  if (!("coupling" in decoded)) {
    if (shown) throw new Error("coupling is required for a coupled inductor");
    return value;
  }
  if (!isRecord(decoded.coupling))
    throw new Error("coupling must be an object keyed by coupling name");
  const partners = new Set(context.partners.map((partner) => partner.value));
  const names = new Set<string>();
  const coupled = new Set<string>();
  value.coupling = {};
  for (const [rawName, entry] of Object.entries(decoded.coupling)) {
    const name = rawName.trim();
    const path = `coupling.${rawName}`;
    if (!name || name.length > 64)
      throw new Error("Each coupling name must be 1 to 64 characters");
    if (names.has(name.toLowerCase()))
      throw new Error(`Two couplings are named ${name}`);
    names.add(name.toLowerCase());
    if (!isRecord(entry)) throw new Error(`${path} must be an object`);
    const unknown = Object.keys(entry).find(
      (key) => !["with", "k", "arrow"].includes(key),
    );
    if (unknown)
      throw new Error(`${path}.${unknown} is not a supported property`);
    if (
      typeof entry.with !== "string" ||
      entry.with === instanceId ||
      !partners.has(entry.with)
    )
      throw new Error(`${path}.with must select another inductor of this Cell`);
    if (coupled.has(entry.with))
      throw new Error(`Two couplings join the same pair of inductors`);
    coupled.add(entry.with);
    if (typeof entry.k !== "string" || !entry.k.trim() || entry.k.length > 256)
      throw new Error(`${path}.k must be a nonempty value such as "0.9"`);
    if (typeof entry.arrow !== "boolean")
      throw new Error(`${path}.arrow must be true or false`);
    value.coupling[name] = {
      with: entry.with,
      k: entry.k.trim(),
      arrow: entry.arrow,
    };
  }
  return value;
}

/** IDs for new couplings, clear of every object the Document holds. */
function couplingIdAllocator(document: SchematicDocument) {
  const occupied = new Set(
    [
      ...document.instances,
      ...document.nets,
      ...document.routes,
      ...document.junctions,
      ...document.noConnects,
      ...document.annotations,
      ...document.connectivityEvidence,
      ...document.layoutGroups,
      ...document.constraints,
      ...(document.inductorCouplings ?? []),
      ...(document.drafting?.objects ?? []),
    ].map((object) => object.id),
  );
  return (first: string, second: string) => {
    const base = `coupling-${first}-${second}`;
    let id = base;
    for (let suffix = 2; occupied.has(id); suffix++) id = `${base}-${suffix}`;
    occupied.add(id);
    return id;
  };
}

function sameCoupling(left: InductorCoupling, right: InductorCoupling) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Bring the document's couplings of this inductor to what its Properties say.
 * An entry keeps the coupling of its name; a renamed key keeps the coupling
 * to the same inductor; a removed entry removes its coupling and a new one
 * couples the two. Every coupling of the inductor dots the same end.
 */
export function planInductorCouplingEdits(
  document: SchematicDocument,
  instance: Instance,
  value: InductorCouplingPropertyValue,
): SchematicEdit[] {
  if (value.dot === undefined && value.coupling === undefined) return [];
  const pins = couplableInductorPins(instance.symbolId);
  if (!pins) return [];
  const current = inductorCouplingsOf(document, instance.id);
  const dot = value.dot ?? inductorDotPin(document, instance)!;
  const entries = Object.entries(value.coupling ?? {});
  const wanted = value.coupling
    ? entries
    : current.map(
        (coupling) =>
          [
            coupling.name,
            {
              with: partnerOf(coupling, instance.id).instanceId,
              k: coupling.k,
              arrow: coupling.arrow !== false,
            },
          ] as const,
      );
  const claimed = new Set<InductorCoupling>();
  const byName = new Map(current.map((coupling) => [coupling.name, coupling]));
  const matched = wanted.map(([name]) => {
    const named = byName.get(name);
    if (named && !claimed.has(named)) {
      claimed.add(named);
      return named;
    }
    return undefined;
  });
  wanted.forEach(([, entry], index) => {
    if (matched[index]) return;
    const renamed = current.find(
      (coupling) =>
        !claimed.has(coupling) &&
        partnerOf(coupling, instance.id).instanceId === entry.with,
    );
    if (renamed) {
      claimed.add(renamed);
      matched[index] = renamed;
    }
  });
  const instances = new Map(document.instances.map((item) => [item.id, item]));
  const edits: SchematicEdit[] = current
    .filter((coupling) => !claimed.has(coupling))
    .map((coupling) => ({
      kind: "remove_inductor_coupling",
      couplingId: coupling.id,
    }));
  const freshId = couplingIdAllocator(document);
  wanted.forEach(([name, entry], index) => {
    const existing = matched[index];
    const partner = instances.get(entry.with);
    if (!partner) return;
    const partnerDot =
      (existing && partnerOf(existing, instance.id).instanceId === entry.with
        ? partnerOf(existing, instance.id).dotPin
        : undefined) ?? inductorDotPin(document, partner)!;
    const self = { instanceId: instance.id, dotPin: dot };
    const other = { instanceId: entry.with, dotPin: partnerDot };
    const coupling: InductorCoupling = {
      id: existing?.id ?? freshId(instance.id, entry.with),
      name,
      // An existing record keeps its member order.
      members:
        existing && existing.members[0].instanceId !== instance.id
          ? [other, self]
          : [self, other],
      k: entry.k,
      ...(entry.arrow ? {} : { arrow: false as const }),
    };
    if (!existing || !sameCoupling(existing, coupling))
      edits.push({ kind: "set_inductor_coupling", coupling });
  });
  return edits;
}

/**
 * "Couple inductors": exactly two selected inductors not yet coupled become
 * one coupling, named the next free TFn with k 1, each dotted at the end its
 * other couplings already dot (else its first pin), its arrow shown.
 */
export function planCoupleInductors(
  document: SchematicDocument,
  instanceIds: readonly string[],
): SchematicEdit | null {
  if (new Set(instanceIds).size !== 2) return null;
  const selected = document.instances.filter((instance) =>
    instanceIds.includes(instance.id),
  );
  if (selected.length !== 2 || !selected.every(isCouplableInductor))
    return null;
  const [first, second] = selected as [Instance, Instance];
  const couplings = document.inductorCouplings ?? [];
  if (
    couplings.some((coupling) =>
      couplesInstances(coupling, first.id, second.id),
    )
  )
    return null;
  return {
    kind: "set_inductor_coupling",
    coupling: {
      id: couplingIdAllocator(document)(first.id, second.id),
      name: nextInductorCouplingName(couplings.map((item) => item.name)),
      members: [
        { instanceId: first.id, dotPin: inductorDotPin(document, first)! },
        { instanceId: second.id, dotPin: inductorDotPin(document, second)! },
      ],
      k: "1",
    },
  };
}
