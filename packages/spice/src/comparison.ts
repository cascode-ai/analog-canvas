import {
  reviewedExternalBindingForMaster,
  type ReviewedExternalDeviceBinding,
} from "@icm/devices";

import { canonicalSpiceNumber } from "./expression.js";
import type { CircuitCellIR, CircuitIR } from "./ir.js";

/** Kinds that change which devices exist or what they are wired to. */
export const TOPOLOGY_DIFFERENCE_KINDS = [
  "interface",
  "device",
  "target",
  "declaration",
  "connection",
  "scope",
] as const;
/** Kinds that leave the wiring alone. */
export const DETAIL_DIFFERENCE_KINDS = [
  "port-order",
  "binding",
  "parameter",
] as const;

export interface StructuralDifference {
  kind:
    | (typeof TOPOLOGY_DIFFERENCE_KINDS)[number]
    | (typeof DETAIL_DIFFERENCE_KINDS)[number];
  cell: string;
  object: string;
  expected: unknown;
  actual: unknown;
}
/** Checks besides topology; each is on unless set to false. */
export interface StructuralComparisonOptions {
  /** Port order, not only the port set. A figure does not fix it. */
  portOrder?: boolean | undefined;
  /** Literal device parameters. */
  parameters?: boolean | undefined;
  /** One device bound to the same name another way: model card or call. */
  bindings?: boolean | undefined;
  /** Off, .model bodies, .param and preserved statements are ignored
   * instead of making the result inconclusive. */
  declarations?: boolean | undefined;
}
export interface StructuralComparison {
  status: "equal" | "different" | "inconclusive";
  /** Devices and what they are wired to, alone. */
  topology: "equal" | "different" | "inconclusive";
  /** One line: the topology verdict, then the other differences by kind. */
  summary: string;
  differences: StructuralDifference[];
  reasons: string[];
  comparedCells: number;
}

type Instance = CircuitCellIR["instances"][number];

const PLAIN_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/iu;

/** The reviewed wrapper a card names, as a model card or a subcircuit call. */
function reviewedBinding(
  instance: Instance,
): ReviewedExternalDeviceBinding | undefined {
  const { target } = instance;
  const binding =
    target.kind === "model"
      ? reviewedExternalBindingForMaster(target.modelName)
      : target.kind === "external-subcircuit"
        ? reviewedExternalBindingForMaster(target.masterName)
        : undefined;
  return binding?.terminals.length === instance.terminals.length
    ? binding
    : undefined;
}

/** Exact decimal identity of a literal in SI units; null when it is none. */
function literal(instance: Instance, key: string, raw: string): string | null {
  const name = key.split("#")[0]!.toLowerCase();
  // A reviewed SKY130 wrapper takes geometry as plain micrometres; a model
  // card naming the same device takes metres.
  const micrometres =
    instance.target.kind === "external-subcircuit" &&
    reviewedBinding(instance)?.parameters.find(
      (parameter) => parameter.name.toLowerCase() === name,
    )?.targetUnit === "micrometre";
  return canonicalSpiceNumber(
    micrometres && PLAIN_NUMBER.test(raw.trim()) ? `${raw.trim()}u` : raw,
  );
}

/** What an absent parameter means: a reviewed wrapper's count defaults, the
 * one channel of a 20 V wrapper (#1486), and SPICE's parallel multiplier of 1. */
function absentLiteral(instance: Instance, key: string): string | null {
  const name = key.split("#")[0]!.toLowerCase();
  const binding = reviewedBinding(instance);
  const declared =
    binding?.parameters.find(
      (parameter) =>
        parameter.name.toLowerCase() === name &&
        parameter.targetUnit === undefined,
    )?.targetDefaultValue ??
    binding?.fixedParameters?.find(
      (parameter) => parameter.name.toLowerCase() === name,
    )?.value;
  if (declared !== undefined) return canonicalSpiceNumber(declared);
  return name === "m" ? canonicalSpiceNumber("1") : null;
}

function targetName(instance: Instance): string | undefined {
  const { target } = instance;
  switch (target.kind) {
    case "model":
      return target.modelName.toLowerCase();
    case "subcircuit":
      return target.cellName.toLowerCase();
    case "external-subcircuit":
      return target.masterName.toLowerCase();
    default:
      return undefined;
  }
}

/** A .model card that only declares its type: `.model nch nmos`. */
function declaresTypeOnly(model: CircuitIR["models"][number]): boolean {
  return model.rawParameters.replace(/[()\s]/gu, "") === "";
}

function summarize(comparison: Omit<StructuralComparison, "summary">): string {
  if (comparison.status === "equal") return "equal";
  const phrase = (kinds: readonly StructuralDifference["kind"][]) => {
    const counts = kinds
      .map(
        (kind) =>
          [
            kind === "binding" ? "binding-style" : kind,
            comparison.differences.filter((d) => d.kind === kind).length,
          ] as const,
      )
      .filter(([, count]) => count > 0);
    const total = counts.reduce((sum, [, count]) => sum + count, 0);
    return total
      ? `${counts.map(([kind, count]) => `${count} ${kind}`).join(", ")} ${total === 1 ? "difference" : "differences"}`
      : "";
  };
  const topology = phrase(TOPOLOGY_DIFFERENCE_KINDS);
  const details = phrase(DETAIL_DIFFERENCE_KINDS);
  const unchecked = comparison.reasons.length;
  return [
    `topology ${comparison.topology}${topology ? `: ${topology}` : ""}`,
    details,
    unchecked
      ? `${unchecked} ${unchecked === 1 ? "item needs" : "items need"} manual comparison`
      : "",
  ]
    .filter(Boolean)
    .join("; ");
}

/** Reference/pin-identity comparison, not a simulator or graph isomorphism.
 * Reuses compiler IR, including global scope and ordered subcircuit terminals.
 * Local auto names do not matter; a Net is its sorted endpoint membership.
 */
export function compareCircuitIR(
  actual: CircuitIR,
  expected: CircuitIR,
  actualRoot: string,
  expectedRoot = actualRoot,
  options: StructuralComparisonOptions = {},
): StructuralComparison {
  const differences: StructuralDifference[] = [];
  const reasons = new Set<string>();
  // Uncertainty about which devices exist or how they connect; unchecked
  // parameter values leave the topology verdict alone.
  let topologyUnchecked = false;
  const structural = (reason: string) => {
    reasons.add(reason);
    topologyUnchecked = true;
  };
  let comparedCells = 0;
  const lower = (s: string) => s.toLowerCase();
  const same = (a: unknown, b: unknown) =>
    JSON.stringify(a) === JSON.stringify(b);
  const difference = (
    kind: StructuralDifference["kind"],
    cell: string,
    object: string,
    a: unknown,
    e: unknown,
  ) => {
    if (!same(a, e))
      differences.push({ kind, cell, object, expected: e, actual: a });
  };
  for (const [label, ir] of [
    ["actual", actual],
    ["expected", expected],
  ] as const) {
    if (ir.unresolvedStatements.length)
      structural(`${label}: unparsed statements need manual comparison`);
    if (options.declarations === false) continue;
    // A title line and .end say nothing about the circuit; nearly every
    // file has them, and they made every comparison inconclusive.
    const preserved = ir.preservedStatements.some(
      (statement) =>
        !(
          statement.kind === "directive" &&
          (statement.name === "title" || statement.name === "end")
        ),
    );
    // Conditionals and includes can add devices; bodies and .param cannot.
    if (preserved)
      structural(
        `${label}: declarations, model bodies or preserved statements need manual comparison`,
      );
    else if (
      ir.parameters.length ||
      ir.models.some((model) => !declaresTypeOnly(model))
    )
      reasons.add(
        `${label}: declarations, model bodies or preserved statements need manual comparison`,
      );
  }
  // A model both sides declare must be the same kind of device.
  const actualModels = new Map(
    actual.models.map((model) => [lower(model.name), lower(model.modelType)]),
  );
  for (const model of expected.models) {
    const type = actualModels.get(lower(model.name));
    if (type !== undefined)
      difference(
        "declaration",
        expectedRoot,
        `model ${lower(model.name)}`,
        type,
        lower(model.modelType),
      );
  }
  const seen = new Set<string>();
  const pair = (an: string, en: string, ancestors: Set<string>) => {
    const key = JSON.stringify([lower(an), lower(en)]);
    if (ancestors.has(key)) {
      structural("Recursive hierarchy is unsupported");
      return;
    }
    if (seen.has(key)) return;
    seen.add(key);
    const a = actual.cells.find((c) => lower(c.name) === lower(an));
    const e = expected.cells.find((c) => lower(c.name) === lower(en));
    if (!a || !e) {
      structural(`Missing comparison Cell: ${!a ? an : en}`);
      return;
    }
    if (++comparedCells > 128) {
      structural("Comparison exceeds 128 Cells");
      return;
    }
    if (
      options.parameters !== false &&
      (a.parameters.length || e.parameters.length)
    )
      reasons.add(`${en}: parameterized hierarchy needs manual comparison`);
    // Formal names identify endpoints; order is the exported ABI, which a
    // figure does not fix, so it is its own kind.
    const actualPorts = a.ports.map((p) => lower(p.name));
    const expectedPorts = e.ports.map((p) => lower(p.name));
    if (!same(actualPorts.toSorted(), expectedPorts.toSorted()))
      difference("interface", en, "ports", actualPorts, expectedPorts);
    else if (options.portOrder !== false)
      difference("port-order", en, "ports", actualPorts, expectedPorts);
    const devicesOf = (cell: CircuitCellIR) => {
      const devices = new Map<string, Instance>();
      for (const instance of cell.instances) {
        const name = lower(instance.name);
        if (devices.has(name))
          structural(`${cell.name}: duplicate Reference ${name}`);
        devices.set(name, instance);
      }
      return devices;
    };
    const actualDevices = devicesOf(a);
    const expectedDevices = devicesOf(e);
    // Devices pair by card name, then by Instance reference: an export writes
    // a Reference bound to a subcircuit as a call, so XM1 is M1 bound another
    // way, not a second device. A reference shared by several leftovers stays
    // unpaired rather than guessed.
    const partner = new Map<string, string>();
    for (const name of actualDevices.keys())
      if (expectedDevices.has(name)) partner.set(name, name);
    const referenceOf = (name: string, instance: Instance) =>
      (instance.target.kind === "subcircuit" ||
        instance.target.kind === "external-subcircuit") &&
      name.length > 1 &&
      name.startsWith("x")
        ? name.slice(1)
        : name;
    const leftovers = (devices: Map<string, Instance>, paired: Set<string>) => {
      const byReference = new Map<string, string[]>();
      for (const [name, instance] of devices) {
        if (paired.has(name)) continue;
        const reference = referenceOf(name, instance);
        byReference.set(reference, [
          ...(byReference.get(reference) ?? []),
          name,
        ]);
      }
      return byReference;
    };
    const expectedLeftovers = leftovers(
      expectedDevices,
      new Set(partner.values()),
    );
    for (const [reference, names] of leftovers(
      actualDevices,
      new Set(partner.keys()),
    )) {
      const partners = expectedLeftovers.get(reference);
      if (names.length === 1 && partners?.length === 1)
        partner.set(names[0]!, partners[0]!);
    }
    // A call to a Cell both sides define with the same port names reaches
    // them by name, so a reordered Cell does not rewire its callers.
    const pinNames = new Map<Instance, string[]>();
    for (const [actualName, expectedName] of partner) {
      const ai = actualDevices.get(actualName)!;
      const ei = expectedDevices.get(expectedName)!;
      if (ai.target.kind !== "subcircuit" || ei.target.kind !== "subcircuit")
        continue;
      const actualCell = ai.target.cellName;
      const expectedCell = ei.target.cellName;
      const ac = actual.cells.find((c) => lower(c.name) === lower(actualCell));
      const ec = expected.cells.find(
        (c) => lower(c.name) === lower(expectedCell),
      );
      const aNames = ac?.ports.map((p) => lower(p.name)) ?? [];
      const eNames = ec?.ports.map((p) => lower(p.name)) ?? [];
      if (
        ac &&
        ec &&
        new Set(aNames).size === aNames.length &&
        same(aNames.toSorted(), eNames.toSorted())
      ) {
        pinNames.set(ai, aNames);
        pinNames.set(ei, eNames);
      }
    }
    const project = (
      cell: CircuitCellIR,
      devices: Map<string, Instance>,
      nameOf: (name: string) => string,
      turned: ReadonlySet<Instance> = new Set(),
    ) => {
      const nodes = new Map<string, string[]>();
      const endpoints = new Map<string, string>();
      const add = (endpoint: string, netId: string) => {
        const list = nodes.get(netId) ?? [];
        list.push(endpoint);
        nodes.set(netId, list);
        endpoints.set(endpoint, netId);
      };
      const named = new Map<string, Instance>();
      for (const [name, instance] of devices) {
        const canonical = nameOf(name);
        named.set(canonical, instance);
        const pins = pinNames.get(instance);
        for (const pin of instance.terminals) {
          const position = turned.has(instance)
            ? 1 - pin.position
            : pin.position;
          add(`${canonical}:${pins?.[position] ?? position}`, pin.netId);
        }
      }
      for (const p of cell.ports) add(`port:${lower(p.name)}`, p.netId);
      return { devices: named, endpoints, nodes };
    };
    // A paired device goes by the reference's name on both sides.
    const actualName = (name: string) => partner.get(name) ?? name;
    const ep = project(e, expectedDevices, (name) => name);
    const members = (
      projection: ReturnType<typeof project>,
      endpoint: string,
    ): ReadonlySet<string> => {
      const id = projection.endpoints.get(endpoint);
      return new Set(id ? (projection.nodes.get(id) ?? []) : []);
    };
    // How far the wiring is from the expected one: for every endpoint, the
    // endpoints it shares a Net with on one side and not on the other. A
    // Net that only some of its devices' turns would fix still gets closer.
    const mismatched = (projection: ReturnType<typeof project>) => {
      let count = 0;
      for (const endpoint of new Set([
        ...projection.endpoints.keys(),
        ...ep.endpoints.keys(),
      ])) {
        const actualMembers = members(projection, endpoint);
        const expectedMembers = members(ep, endpoint);
        for (const member of actualMembers)
          if (!expectedMembers.has(member)) count += 1;
        for (const member of expectedMembers)
          if (!actualMembers.has(member)) count += 1;
      }
      return count;
    };
    // R, C and L have no polarity: `R1 a b` and `R1 b a` are one resistor
    // (#1296). Each such device is turned end for end where that brings the
    // wiring closer to the expected one, one device at a time until no turn
    // helps, so a chain of them settles from its ends inward.
    const turned = new Set<Instance>();
    const unpolarized = [...partner]
      .map(([an, en]) => [actualDevices.get(an)!, expectedDevices.get(en)!])
      .filter(([ai, ei]) =>
        [ai, ei].every(
          (instance) =>
            instance!.target.kind === "primitive" &&
            ["resistor", "capacitor", "inductor"].includes(
              lower(instance!.target.family),
            ) &&
            instance!.terminals.length === 2,
        ),
      )
      .map(([ai]) => ai!);
    let ap = project(a, actualDevices, actualName, turned);
    let misses = mismatched(ap);
    for (let pass = 0; misses > 0 && pass < 8; pass += 1) {
      let improved = false;
      for (const instance of unpolarized) {
        if (turned.has(instance)) turned.delete(instance);
        else turned.add(instance);
        const candidate = project(a, actualDevices, actualName, turned);
        const candidateMisses = mismatched(candidate);
        if (candidateMisses < misses) {
          ap = candidate;
          misses = candidateMisses;
          improved = true;
        } else if (turned.has(instance)) turned.delete(instance);
        else turned.add(instance);
      }
      if (!improved) break;
    }
    const target = (instance: Instance) => {
      const t = instance.target;
      switch (t.kind) {
        case "primitive":
          return [t.kind, lower(t.family)];
        case "model":
          return [t.kind, lower(t.modelName)];
        case "subcircuit":
          return [t.kind, lower(t.cellName)];
        case "external-subcircuit":
          return [t.kind, lower(t.masterName)];
        default:
          structural(`${en}/${instance.name}: opaque device`);
          return [t.kind, lower(t.sourceName)];
      }
    };
    for (const ref of new Set([...ap.devices.keys(), ...ep.devices.keys()])) {
      const ai = ap.devices.get(ref),
        ei = ep.devices.get(ref);
      if (!ai || !ei) {
        difference("device", en, ref, Boolean(ai), Boolean(ei));
        continue;
      }
      const actualTarget = target(ai);
      const expectedTarget = target(ei);
      if (!same(actualTarget, expectedTarget)) {
        const name = targetName(ai);
        // The same model or subcircuit name, bound as a card or a call.
        if (name !== undefined && name === targetName(ei)) {
          if (options.bindings !== false)
            difference("binding", en, ref, ai.target.kind, ei.target.kind);
        } else difference("target", en, ref, actualTarget, expectedTarget);
      }
      if (ai.target.kind === "subcircuit" && ei.target.kind === "subcircuit")
        pair(
          ai.target.cellName,
          ei.target.cellName,
          new Set([...ancestors, key]),
        );
      if (options.parameters === false) continue;
      for (const param of new Set([
        ...Object.keys(ai.parameters),
        ...Object.keys(ei.parameters),
      ])) {
        const av = ai.parameters[param]?.rawText,
          ev = ei.parameters[param]?.rawText;
        const avn =
          av === undefined ? absentLiteral(ai, param) : literal(ai, param, av);
        const evn =
          ev === undefined ? absentLiteral(ei, param) : literal(ei, param, ev);
        if (
          (av !== undefined && avn === null) ||
          (ev !== undefined && evn === null)
        ) {
          reasons.add(
            `${en}/${ref}/${param}: expression, nonliteral or over-budget literal needs manual comparison`,
          );
          continue;
        }
        // Compare exact decimal identities, but retain source evidence instead
        // of reporting rounded values (which could even look equal).
        if (avn !== evn)
          difference(
            "parameter",
            en,
            `${ref}.${param}`,
            av ?? null,
            ev ?? null,
          );
      }
    }
    for (const endpoint of new Set([
      ...ap.endpoints.keys(),
      ...ep.endpoints.keys(),
    ])) {
      const aid = ap.endpoints.get(endpoint),
        eid = ep.endpoints.get(endpoint);
      difference(
        "connection",
        en,
        endpoint,
        aid ? [...(ap.nodes.get(aid) ?? [])].sort() : null,
        eid ? [...(ep.nodes.get(eid) ?? [])].sort() : null,
      );
      const scope = (cell: CircuitCellIR, id: string | undefined) => {
        const net = cell.nets.find((n) => n.id === id);
        return net?.scope === "global"
          ? ["global", lower(net.name)]
          : net
            ? ["local"]
            : null;
      };
      difference("scope", en, endpoint, scope(a, aid), scope(e, eid));
    }
  };
  pair(actualRoot, expectedRoot, new Set());
  const topologyDiffers = differences.some((d) =>
    (TOPOLOGY_DIFFERENCE_KINDS as readonly string[]).includes(d.kind),
  );
  // Known differences may be useful even when other parts were uncheckable.
  const comparison = {
    status: reasons.size
      ? "inconclusive"
      : differences.length
        ? "different"
        : "equal",
    topology: topologyUnchecked
      ? "inconclusive"
      : topologyDiffers
        ? "different"
        : "equal",
    differences,
    reasons: [...reasons],
    comparedCells,
  } satisfies Omit<StructuralComparison, "summary">;
  return { ...comparison, summary: summarize(comparison) };
}
