import { reviewedExternalBindingForMaster } from "@icm/devices";
import {
  compileSpiceSources,
  type CircuitCellIR,
  type CircuitIR,
  type CircuitInstanceIR,
  type SpiceCompileResult,
} from "@icm/spice";

/**
 * Grade a netlist against a reference by its structure alone (#1524), for
 * batch redraws (#1498) and the schematic-to-netlist benchmark. Both are
 * read as device–net bipartite graphs, and the headline verdict is an exact
 * graph isomorphism under these rules:
 *
 * - Device, net, Cell and port names are ignored; hierarchy is flattened.
 * - Ground is one fixed net: 0, GND…, VSS…, AGND, DGND, ground. Supplies
 *   (VDD…, VCC…, AVDD, DVDD, VEE…, VPWR) are fixed too: a supply maps only
 *   to a supply.
 * - A device's type is its kind (resistor, nmos, pnp, …); model and master
 *   names only decide the kind.
 * - The ends of R, C and L are interchangeable, and those of independent
 *   sources too unless `sourcePolarity` is set (for a figure that marks it).
 * - MOS drain and source are interchangeable.
 * - Bodies (MOS bulk, BJT substrate, a PDK device's substrate terminal) are
 *   ignored when one side omits them: every body of that side is unwritten
 *   or on its conventional rail (n-channel on ground, p-channel on a
 *   supply), which is what an undrawn body exports to. Otherwise they count.
 *
 * `mode` is "strict" when the netlists are isomorphic even with drain and
 * source and every body held apart, "lenient" otherwise. The partial scores
 * are computed under the same rules as `exact`.
 */

export interface GradeOptions {
  /** "auto" (default) ignores bodies when one side omits them. */
  body?: "auto" | "compare" | "ignore";
  /** Count the polarity of independent sources. */
  sourcePolarity?: boolean;
  /** The root Cell of each side, when a netlist has several top Cells. */
  actualCell?: string;
  referenceCell?: string;
}

export interface NetlistGrade {
  exact: boolean;
  mode: "strict" | "lenient";
  /** F1 of the device-type multisets. */
  deviceTypeF1: number;
  /**
   * F1 of the connection multisets. A connection is a pair of device
   * terminals ("nmos.g~nmos.ds") on one ordinary net, a terminal on a rail
   * ("nmos.ds@ground"), or the only terminal on a net ("…@open").
   */
  connectionF1: number;
  details: GradeDetails;
}

export interface GradeDetails {
  /** Why the netlists could not be graded; the scores are then 0. */
  error?: string;
  /** Errors and unread statements; either keeps `exact` false. */
  problems: { actual: string[]; reference: string[] };
  bodies: "compared" | "ignored";
  sourcePolarity: boolean;
  devices: { actual: number; reference: number };
  nets: { actual: number; reference: number };
  /** Device types whose counts differ, as [actual, reference]. */
  deviceTypes: Record<string, [number, number]>;
  connections: { actual: number; reference: number; shared: number };
  /** Bodies were compared and are the only difference. */
  bodiesOnly?: boolean;
  /** The search ran out of budget, so `exact` is reported false. */
  budgetExceeded?: boolean;
}

type NetClass = "ground" | "supply" | "net";

interface Role {
  /** Role under the #1524 rules: drain and source share "ds". */
  role: string;
  /** Role with drain and source held apart. */
  strictRole: string;
  body: boolean;
}

interface Pin extends Role {
  net: string;
}

interface Device {
  type: string;
  channel?: "n" | "p";
  pins: Pin[];
}

interface Circuit {
  devices: Device[];
  netClass: Map<string, NetClass>;
}

const GROUND = /^(?:0|gnd\w*|[ad]gnd\w*|vss\w*|[ad]vss\w*|ground)!?$/iu;
const SUPPLY = /^(?:[ad]?vdd\w*|[ad]?vcc\w*|vee\w*|vpwr)!?$/iu;
const SYMMETRIC = new Set(["resistor", "capacitor", "inductor"]);
const N_CHANNEL = new Set(["nmos", "ndmos"]);
const P_CHANNEL = new Set(["pmos", "pdmos"]);
const MAX_DEVICES = 20_000;
const MAX_DEPTH = 64;
/** Node visits the isomorphism search may make before it gives up. */
const SEARCH_BUDGET = 20_000_000;

function netClassOf(name: string): NetClass {
  return GROUND.test(name) ? "ground" : SUPPLY.test(name) ? "supply" : "net";
}

/** The kind a model or master name spells, if it spells one. */
function kindByName(name: string): string | undefined {
  const lower = name.toLowerCase();
  if (/pfet|pmos|pch/u.test(lower)) return "pmos";
  if (/nfet|nmos|nch/u.test(lower)) return "nmos";
  if (lower.includes("pnp")) return "pnp";
  if (lower.includes("npn")) return "npn";
  return undefined;
}

/** `.model` types that name a device kind. */
const DECLARED_KINDS: Record<string, string> = {
  nmos: "nmos",
  pmos: "pmos",
  npn: "npn",
  pnp: "pnp",
  d: "diode",
  njf: "njfet",
  pjf: "pjfet",
};

/** Roles for a device read by its positional terminals. */
function positional(
  type: string,
  names: readonly string[],
  instance: CircuitInstanceIR,
  options: { sourcePolarity: boolean },
  undrawn: ReadonlySet<number> = new Set(),
): Role[] {
  return instance.terminals.map((terminal) => {
    const name = (names[terminal.position] ?? terminal.name ?? "")
      .toLowerCase()
      .trim();
    const role = (role: string, strictRole = role, body = false) => ({
      role,
      strictRole,
      body,
    });
    const own = name || `p${terminal.position}`;
    // A PDK device's substrate and supply terminals are not drawn.
    if (undrawn.has(terminal.position)) return role(own, own, true);
    if (type === "nmos" || type === "pmos" || type === "mosfet") {
      if (name === "d" || name === "s") return role("ds", name);
      if (name === "b") return role("b", "b", true);
    }
    if ((type === "npn" || type === "pnp" || type === "bjt") && name === "s")
      return role("s", "s", true);
    if (SYMMETRIC.has(type)) return role("t");
    if ((type === "vsource" || type === "isource") && !options.sourcePolarity)
      return role("t");
    return role(own);
  });
}

/** What one netlist instance is, and the role of each terminal. */
function classify(
  instance: CircuitInstanceIR,
  models: ReadonlyMap<string, string>,
  options: { sourcePolarity: boolean },
): Omit<Device, "pins"> & { roles: Role[] } {
  const { target } = instance;
  const typed = (
    type: string,
    names: readonly string[] = [],
    undrawn?: ReadonlySet<number>,
  ) => ({
    type,
    ...(N_CHANNEL.has(type)
      ? { channel: "n" as const }
      : P_CHANNEL.has(type)
        ? { channel: "p" as const }
        : {}),
    roles: positional(type, names, instance, options, undrawn),
  });
  switch (target.kind) {
    case "primitive": {
      const family = target.family.toLowerCase();
      if (family === "voltage-source") return typed("vsource", ["+", "-"]);
      if (family === "current-source") return typed("isource", ["+", "-"]);
      return typed(family);
    }
    case "model": {
      const model = target.modelName.toLowerCase();
      const declared = DECLARED_KINDS[models.get(model) ?? ""];
      const named = kindByName(model);
      // The compiler names a modelled device's terminals by its family.
      const names = instance.terminals.map((terminal) => terminal.name ?? "");
      const family = names.join(" ");
      if (family === "D G S B") {
        const first = model[0];
        return typed(
          declared ??
            named ??
            (first === "p" ? "pmos" : first === "n" ? "nmos" : "mosfet"),
          names,
        );
      }
      if (family.startsWith("C B E"))
        return typed(declared ?? named ?? "bjt", names);
      if (family === "A K") return typed("diode", names);
      if (family === "D G S") return typed(declared ?? "jfet", names);
      return typed(declared ?? `model:${model}`, names);
    }
    case "external-subcircuit": {
      const binding = reviewedExternalBindingForMaster(target.masterName);
      if (binding)
        return typed(
          binding.symbolId,
          binding.terminals.map((terminal) => terminal.pinName),
          new Set(
            binding.terminals.flatMap((terminal, position) =>
              terminal.interaction === "property" ? [position] : [],
            ),
          ),
        );
      const kind = kindByName(target.masterName);
      if (kind === "nmos" || kind === "pmos")
        return typed(kind, ["D", "G", "S", "B"]);
      if (kind === "npn" || kind === "pnp")
        return typed(kind, ["C", "B", "E", "S"]);
      return typed(`x:${target.masterName.toLowerCase()}`);
    }
    case "subcircuit":
      throw new Error("A subcircuit call is flattened, not classified");
    case "opaque":
      return typed(`opaque:${target.sourceName.toLowerCase()}`);
  }
}

/** The root Cell's devices, every subcircuit call flattened into them. */
function flatten(
  ir: CircuitIR,
  root: string,
  options: { sourcePolarity: boolean },
): Circuit {
  const lower = (name: string) => name.toLowerCase();
  const cells = new Map(ir.cells.map((cell) => [lower(cell.name), cell]));
  const models = new Map(
    ir.models.map((model) => [lower(model.name), lower(model.modelType)]),
  );
  const devices: Device[] = [];
  const netClass = new Map<string, NetClass>();
  const key = (name: string, local: string) => {
    const cls = netClassOf(name);
    const id = cls === "ground" ? "ground" : local;
    netClass.set(id, cls);
    return id;
  };
  const expand = (
    cell: CircuitCellIR,
    path: string,
    ports: ReadonlyMap<string, string>,
    depth: number,
  ) => {
    if (depth > MAX_DEPTH)
      throw new Error(`Hierarchy deeper than ${MAX_DEPTH} levels`);
    const nets = new Map<string, string>();
    for (const net of cell.nets)
      nets.set(
        net.id,
        ports.get(net.id) ??
          key(
            net.name,
            net.scope === "global"
              ? `global:${lower(net.name)}`
              : `${path}/${lower(net.name)}`,
          ),
      );
    for (const instance of cell.instances) {
      const netOf = (netId: string) => nets.get(netId)!;
      if (instance.target.kind === "subcircuit") {
        const callee = cells.get(lower(instance.target.cellName));
        if (!callee)
          throw new Error(`Missing subcircuit ${instance.target.cellName}`);
        const bound = new Map<string, string>();
        for (const terminal of instance.terminals) {
          const port = callee.ports[terminal.position];
          if (port) bound.set(port.netId, netOf(terminal.netId));
        }
        expand(callee, `${path}/${lower(instance.name)}`, bound, depth + 1);
        continue;
      }
      if (devices.length >= MAX_DEVICES)
        throw new Error(`More than ${MAX_DEVICES} devices`);
      const { roles, ...kind } = classify(instance, models, options);
      devices.push({
        ...kind,
        pins: instance.terminals.map((terminal, index) => ({
          ...roles[index]!,
          net: netOf(terminal.netId),
        })),
      });
    }
  };
  const rootCell = cells.get(lower(root));
  if (!rootCell) throw new Error(`Missing root Cell ${root}`);
  expand(rootCell, "", new Map(), 0);
  return { devices, netClass };
}

/** Every body sits where an undrawn body would: unwritten or on its rail. */
function omitsBodies(circuit: Circuit): boolean {
  return circuit.devices.every((device) =>
    device.pins
      .filter((pin) => pin.body)
      .every((pin) => {
        const cls = circuit.netClass.get(pin.net);
        if (device.channel === "n") return cls === "ground";
        if (device.channel === "p") return cls === "supply";
        return cls === "ground" || cls === "supply";
      }),
  );
}

interface Graph {
  labels: string[];
  /** Per node: [neighbour, edge label]. Devices come first, then nets. */
  adjacency: [number, string][][];
  devices: number;
}

function graphOf(
  circuit: Circuit,
  rules: { strict: boolean; bodies: boolean },
): Graph {
  const labels = circuit.devices.map((device) => `device:${device.type}`);
  const adjacency: [number, string][][] = circuit.devices.map(() => []);
  const netIndex = new Map<string, number>();
  for (const [index, device] of circuit.devices.entries()) {
    const roles = new Map<string, string[]>();
    for (const pin of device.pins) {
      if (pin.body && !rules.bodies) continue;
      roles.set(pin.net, [
        ...(roles.get(pin.net) ?? []),
        rules.strict ? pin.strictRole : pin.role,
      ]);
    }
    for (const [net, list] of roles) {
      let node = netIndex.get(net);
      if (node === undefined) {
        node = labels.length;
        netIndex.set(net, node);
        labels.push(`net:${circuit.netClass.get(net)}`);
        adjacency.push([]);
      }
      const label = list.sort().join("+");
      adjacency[index]!.push([node, label]);
      adjacency[node]!.push([index, label]);
    }
  }
  return { labels, adjacency, devices: circuit.devices.length };
}

class SearchBudgetExceeded extends Error {}

/**
 * Exact graph isomorphism by colour refinement with individualisation: the
 * two graphs are refined together, and where a colour class still holds
 * several nodes, one of them is pinned to each candidate in turn.
 */
function isomorphic(left: Graph, right: Graph): boolean {
  const size = left.labels.length;
  if (size !== right.labels.length || left.devices !== right.devices)
    return false;
  const adjacency = [
    ...left.adjacency,
    ...right.adjacency.map((edges) =>
      edges.map(([node, label]): [number, string] => [node + size, label]),
    ),
  ];
  let budget = SEARCH_BUDGET;
  // Both graphs hold each colour equally often.
  const balanced = (colours: readonly number[]) => {
    const count = new Map<number, number>();
    for (let node = 0; node < size; node += 1)
      count.set(colours[node]!, (count.get(colours[node]!) ?? 0) + 1);
    for (let node = size; node < 2 * size; node += 1) {
      const remaining = (count.get(colours[node]!) ?? 0) - 1;
      if (remaining < 0) return false;
      count.set(colours[node]!, remaining);
    }
    return true;
  };
  const refine = (start: readonly number[]): number[] | null => {
    let colours = [...start];
    let classes = new Set(colours).size;
    for (;;) {
      budget -= colours.length;
      if (budget < 0) throw new SearchBudgetExceeded();
      const signatures = colours.map(
        (colour, node) =>
          `${colour}|${adjacency[node]!.map(
            ([next, label]) => `${label}:${colours[next]}`,
          )
            .sort()
            .join(",")}`,
      );
      const ids = new Map(
        [...new Set(signatures)].sort().map((text, id) => [text, id]),
      );
      const next = signatures.map((text) => ids.get(text)!);
      if (!balanced(next)) return null;
      if (ids.size === classes) return next;
      classes = ids.size;
      colours = next;
    }
  };
  const verify = (colours: readonly number[]) => {
    const partner = new Map<number, number>();
    for (let node = size; node < 2 * size; node += 1)
      partner.set(colours[node]!, node);
    const image = (node: number) => partner.get(colours[node]!)!;
    for (let node = 0; node < size; node += 1) {
      const mine = adjacency[node]!.map(
        ([next, label]) => `${image(next)}:${label}`,
      ).sort();
      const theirs = adjacency[image(node)]!.map(
        ([next, label]) => `${next}:${label}`,
      ).sort();
      if (mine.join(",") !== theirs.join(",")) return false;
    }
    return true;
  };
  const search = (colours: number[]): boolean => {
    const members = new Map<number, number[]>();
    for (let node = 0; node < size; node += 1) {
      const list = members.get(colours[node]!) ?? [];
      list.push(node);
      members.set(colours[node]!, list);
    }
    // The smallest class that still holds several nodes, lowest colour first.
    let pick: number | undefined;
    for (const [colour, nodes] of members) {
      const current = pick === undefined ? 0 : members.get(pick)!.length;
      if (
        nodes.length > 1 &&
        (pick === undefined ||
          nodes.length < current ||
          (nodes.length === current && colour < pick))
      )
        pick = colour;
    }
    if (pick === undefined) return verify(colours);
    const node = members.get(pick)![0]!;
    const fresh = colours.reduce((top, colour) => Math.max(top, colour), 0) + 1;
    for (let candidate = size; candidate < 2 * size; candidate += 1) {
      if (colours[candidate] !== pick) continue;
      const pinned = [...colours];
      pinned[node] = fresh;
      pinned[candidate] = fresh;
      const refined = refine(pinned);
      if (refined && search(refined)) return true;
    }
    return false;
  };
  const labels = [...new Set([...left.labels, ...right.labels])].sort();
  const refined = refine(
    [...left.labels, ...right.labels].map((label) => labels.indexOf(label)),
  );
  return refined !== null && search(refined);
}

function multisetF1(
  left: ReadonlyMap<string, number>,
  right: ReadonlyMap<string, number>,
): { f1: number; left: number; right: number; shared: number } {
  const total = (map: ReadonlyMap<string, number>) =>
    [...map.values()].reduce((sum, count) => sum + count, 0);
  let shared = 0;
  for (const [item, count] of left)
    shared += Math.min(count, right.get(item) ?? 0);
  const sizes = total(left) + total(right);
  return {
    f1: sizes === 0 ? 1 : (2 * shared) / sizes,
    left: total(left),
    right: total(right),
    shared,
  };
}

function deviceTypes(circuit: Circuit): Map<string, number> {
  const counts = new Map<string, number>();
  for (const device of circuit.devices)
    counts.set(device.type, (counts.get(device.type) ?? 0) + 1);
  return counts;
}

/** The connection multiset `connectionF1` compares (see NetlistGrade). */
function connections(circuit: Circuit, bodies: boolean): Map<string, number> {
  const terminals = new Map<string, Map<string, number>>();
  for (const device of circuit.devices)
    for (const pin of device.pins) {
      if (pin.body && !bodies) continue;
      const counts = terminals.get(pin.net) ?? new Map<string, number>();
      const name = `${device.type}.${pin.role}`;
      counts.set(name, (counts.get(name) ?? 0) + 1);
      terminals.set(pin.net, counts);
    }
  const items = new Map<string, number>();
  const add = (item: string, count: number) => {
    if (count > 0) items.set(item, (items.get(item) ?? 0) + count);
  };
  for (const [net, counts] of terminals) {
    const cls = circuit.netClass.get(net)!;
    const names = [...counts.keys()].sort();
    const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
    if (cls !== "net")
      for (const name of names) add(`${name}@${cls}`, counts.get(name)!);
    else if (total === 1) add(`${names[0]}@open`, 1);
    else
      for (const [index, first] of names.entries()) {
        const count = counts.get(first)!;
        add(`${first}~${first}`, (count * (count - 1)) / 2);
        for (const second of names.slice(index + 1))
          add(`${first}~${second}`, count * counts.get(second)!);
      }
  }
  return items;
}

async function compile(text: string): Promise<SpiceCompileResult> {
  const run = (source: string) =>
    compileSpiceSources(
      [{ path: "netlist.cir", bytes: new TextEncoder().encode(source) }],
      "netlist.cir",
    );
  const given = await run(text);
  // SPICE reads the first line as a title. An answer that starts with its
  // first device or .subckt line would lose it; a real title reads as none.
  const first = text.split(/\r?\n/u, 1)[0]!.trim();
  if (!first || first.startsWith("*")) return given;
  const titled = await run(`*\n${text}`);
  const count = (result: SpiceCompileResult) =>
    result.ir?.cells.reduce((sum, cell) => sum + cell.instances.length, 0) ?? 0;
  return titled.successful &&
    (!given.successful || count(titled) > count(given))
    ? titled
    : given;
}

function problemsOf(result: SpiceCompileResult): string[] {
  return [
    ...result.diagnostics
      .filter((diagnostic) => diagnostic.severity === "error")
      .map((diagnostic) => diagnostic.message),
    ...(result.ir?.unresolvedStatements.map(
      (statement) => `Unread statement: ${statement.rawText.trim()}`,
    ) ?? []),
  ];
}

function rootOf(ir: CircuitIR, named: string | undefined): string {
  if (named) return named;
  // Top-level devices are the circuit; a Cell nobody calls is a definition.
  if (ir.topCells.includes("__flat__")) return "__flat__";
  if (ir.topCells.length === 1) return ir.topCells[0]!;
  throw new Error(
    ir.topCells.length
      ? `several top Cells (${ir.topCells.join(", ")}); name the root`
      : "no devices",
  );
}

/**
 * Grade `actual` against `reference`, both SPICE or structural Spectre (read
 * with `structuralSpice`). See the rules at the top of this file.
 */
export async function gradeNetlists(
  actual: string,
  reference: string,
  options: GradeOptions = {},
): Promise<NetlistGrade> {
  const sourcePolarity = options.sourcePolarity ?? false;
  const body = options.body ?? "auto";
  const [left, right] = await Promise.all([
    compile(structuralSpice(actual).text),
    compile(structuralSpice(reference).text),
  ]);
  const problems = { actual: problemsOf(left), reference: problemsOf(right) };
  const ungraded = (error: string): NetlistGrade => ({
    exact: false,
    mode: "lenient",
    deviceTypeF1: 0,
    connectionF1: 0,
    details: {
      error,
      problems,
      bodies: body === "compare" ? "compared" : "ignored",
      sourcePolarity,
      devices: { actual: 0, reference: 0 },
      nets: { actual: 0, reference: 0 },
      deviceTypes: {},
      connections: { actual: 0, reference: 0, shared: 0 },
    },
  });
  const read = (
    result: SpiceCompileResult,
    cell: string | undefined,
    side: string,
  ): Circuit | string => {
    if (!result.ir) return `The ${side} could not be read`;
    try {
      return flatten(result.ir, rootOf(result.ir, cell), { sourcePolarity });
    } catch (error) {
      return `The ${side}: ${(error as Error).message}`;
    }
  };
  const drawn = read(left, options.actualCell, "netlist");
  if (typeof drawn === "string") return ungraded(drawn);
  const expected = read(right, options.referenceCell, "reference netlist");
  if (typeof expected === "string") return ungraded(expected);

  const bodies =
    body === "compare" ||
    (body === "auto" && !omitsBodies(drawn) && !omitsBodies(expected));
  const types = [deviceTypes(drawn), deviceTypes(expected)] as const;
  const typeScore = multisetF1(...types);
  const connectionScore = multisetF1(
    connections(drawn, bodies),
    connections(expected, bodies),
  );
  const differing: Record<string, [number, number]> = {};
  for (const type of [
    ...new Set([...types[0].keys(), ...types[1].keys()]),
  ].sort()) {
    const counts: [number, number] = [
      types[0].get(type) ?? 0,
      types[1].get(type) ?? 0,
    ];
    if (counts[0] !== counts[1]) differing[type] = counts;
  }
  const lenient = { strict: false, bodies };
  const graphs = [graphOf(drawn, lenient), graphOf(expected, lenient)] as const;
  const details: GradeDetails = {
    problems,
    bodies: bodies ? "compared" : "ignored",
    sourcePolarity,
    devices: {
      actual: drawn.devices.length,
      reference: expected.devices.length,
    },
    nets: {
      actual: graphs[0].labels.length - graphs[0].devices,
      reference: graphs[1].labels.length - graphs[1].devices,
    },
    deviceTypes: differing,
    connections: {
      actual: connectionScore.left,
      reference: connectionScore.right,
      shared: connectionScore.shared,
    },
  };
  const same = (rules: { strict: boolean; bodies: boolean }) =>
    isomorphic(graphOf(drawn, rules), graphOf(expected, rules));
  let exact = false;
  let mode: NetlistGrade["mode"] = "lenient";
  try {
    exact = isomorphic(...graphs);
    if (exact && same({ strict: true, bodies: true })) mode = "strict";
    if (!exact && bodies)
      details.bodiesOnly = same({ strict: false, bodies: false });
  } catch (error) {
    if (!(error instanceof SearchBudgetExceeded)) throw error;
    details.budgetExceeded = true;
  }
  return {
    exact: exact && !problems.actual.length && !problems.reference.length,
    mode,
    deviceTypeF1: typeScore.f1,
    connectionF1: connectionScore.f1,
    details,
  };
}

/**
 * Why `grade` came out as it did, in a sentence or two for a person. It says
 * only what the grade establishes: device or connection counts that differ
 * prove a difference, an exhausted search proves nothing, and lines the
 * reader could not take leave the rest of the comparison unsettled.
 */
export function explainGrade({ exact, details }: NetlistGrade): string {
  if (exact) return "The netlists are equivalent.";
  const unread = (["actual", "reference"] as const).flatMap((side) =>
    details.problems[side].length
      ? [
          `The ${side === "actual" ? "netlist" : "reference"} has errors or unread statements: ${details.problems[side].join("; ")}.`,
        ]
      : [],
  );
  if (details.error)
    return [
      `The netlists were not compared. ${details.error}.`,
      ...unread,
    ].join(" ");
  const difference = structuralDifference(details);
  if (difference) return [...unread, difference].join(" ");
  // Unread lines alone keep a grade from exact; with them, matching counts
  // do not say whether the rest is the same circuit.
  if (unread.length) return unread.join(" ");
  return "The same devices make the same connections, but they form a different circuit: no renaming of nets turns one into the other.";
}

/** What the counts and the search settle, or null when they settle nothing. */
function structuralDifference(details: GradeDetails): string | null {
  const types = Object.entries(details.deviceTypes);
  if (types.length)
    return `The device counts differ: ${types
      .map(
        ([type, [actual, reference]]) =>
          `${type}, ${actual} in the netlist and ${reference} in the reference`,
      )
      .join("; ")}.`;
  if (details.bodiesOnly)
    return "Only the transistor bodies are connected differently, and here the bodies count.";
  const { actual, reference, shared } = details.connections;
  if (shared < actual || shared < reference)
    return `The connections differ: the netlist makes ${shared} of the reference's ${reference} connections and ${actual - shared} that the reference does not.`;
  if (details.budgetExceeded)
    return "The search for a match ran out of budget before it could decide, so whether the netlists are equivalent is inconclusive.";
  return null;
}

/** Spectre statements that run or configure, not instances. */
const SPECTRE_CONTROL = new Set([
  "ac",
  "alter",
  "altergroup",
  "dc",
  "envlp",
  "hb",
  "info",
  "montecarlo",
  "noise",
  "options",
  "pac",
  "pnoise",
  "pss",
  "pxf",
  "pz",
  "save",
  "set",
  "sp",
  "stb",
  "sweep",
  "tran",
  "xf",
]);

const GROUPED_INSTANCE = /^\s*[A-Za-z_][^\s(]*\s*\([^)]*\)\s*[A-Za-z_]\w*/u;
const PLAIN_ELEMENT = /^\s*[A-Za-z][^\s(]*\s+[^\s(=]+\s+[^\s(=]+/u;

/** Spectre if it says so, or writes most instances as `name (nodes) master`. */
function isSpectre(text: string): boolean {
  if (/^\s*simulator\s+lang\s*=\s*spectre\b/imu.test(text)) return true;
  if (/^\s*\.(?:subckt|ends|model|end)\b/imu.test(text)) return false;
  let grouped = 0;
  let plain = 0;
  for (const line of text.split(/\r?\n/u)) {
    if (GROUPED_INSTANCE.test(line)) grouped += 1;
    else if (PLAIN_ELEMENT.test(line)) plain += 1;
  }
  return grouped > plain;
}

/**
 * SPICE for a netlist that may be structural Spectre, as the AnalogGenie
 * dataset writes it (`M0 (D G S B) nmos4`, `R0 (a b) resistor`, often with no
 * value). Only structure is kept: devices, nodes, model and master names,
 * `subckt` blocks, model kinds, and an instance's `name=value` parameters.
 * A passive or source without a value gets 1 or DC 0, which no grade reads.
 * SPICE comes back unchanged.
 */
export function structuralSpice(text: string): {
  text: string;
  from: "spice" | "spectre";
} {
  if (!isSpectre(text)) return { text, from: "spice" };
  const lines = text
    .replace(/\\\r?\n/gu, " ")
    .split(/\r?\n/u)
    .map((line) => line.replace(/\/\/.*$/u, "").trim());
  const out = ["* Structural SPICE read from Spectre"];
  // A model statement declares a master's kind: `model nch bsim4 type=n`.
  const declared = new Map<string, string>();
  for (const line of lines) {
    const match = /^model\s+(\S+)\s+(\S+)(.*)$/iu.exec(line);
    if (!match) continue;
    const name = match[1]!;
    const type = /\btype\s*=\s*(\w+)/iu.exec(match[3]!)?.[1]?.toLowerCase();
    const kind =
      match[2]!.toLowerCase() === "diode"
        ? "d"
        : type === "n"
          ? "nmos"
          : type === "p"
            ? "pmos"
            : type === "npn" || type === "pnp"
              ? type
              : undefined;
    if (!kind) continue;
    declared.set(name.toLowerCase(), kind);
    out.push(`.model ${name} ${kind}`);
  }
  for (const line of lines) {
    if (!line || line.startsWith("*")) continue;
    const words = line.split(/\s+/u);
    const head = words[0]!.toLowerCase();
    if (
      ["simulator", "model", "parameters", "include", "ahdl_include"].includes(
        head,
      )
    )
      continue;
    if (head === "global") {
      out.push(`.global ${words.slice(1).join(" ")}`);
      continue;
    }
    const subckt =
      /^(?:inline\s+)?subckt\s+([^\s(]+)\s*\(?([^)]*)\)?\s*$/iu.exec(line);
    if (subckt) {
      out.push(`.subckt ${subckt[1]} ${subckt[2]!.trim()}`.trim());
      continue;
    }
    if (head === "ends") {
      out.push(".ends");
      continue;
    }
    // name (nodes) master params, or name nodes master params.
    const grouped = /^(\S+?)\s*\(([^)]*)\)\s*(\S+)\s*(.*)$/u.exec(line);
    let name: string, nodes: string[], master: string, rest: string[];
    if (grouped) {
      name = grouped[1]!;
      nodes = grouped[2]!.trim().split(/\s+/u).filter(Boolean);
      master = grouped[3]!;
      rest = grouped[4]!.split(/\s+/u).filter(Boolean);
    } else {
      const assignment = words.findIndex((word) => word.includes("="));
      const positions = assignment === -1 ? words : words.slice(0, assignment);
      if (positions.length < 3) continue;
      name = positions[0]!;
      nodes = positions.slice(1, -1);
      master = positions.at(-1)!;
      rest = assignment === -1 ? [] : words.slice(assignment);
    }
    const lower = master.toLowerCase();
    if (SPECTRE_CONTROL.has(lower)) continue;
    const parameters = rest.filter((word) => word.includes("="));
    const value = (key: string, fallback: string) =>
      parameters
        .find((word) => word.toLowerCase().startsWith(`${key}=`))
        ?.slice(key.length + 1) ?? fallback;
    const element = (letter: string) =>
      name[0]?.toUpperCase() === letter ? name : `${letter}${name}`;
    const kind = declared.get(lower) ?? kindByName(master);
    const two = nodes.length === 2 ? nodes.join(" ") : undefined;
    if (lower === "resistor" && two)
      out.push(`${element("R")} ${two} ${value("r", "1")}`);
    else if (lower === "capacitor" && two)
      out.push(`${element("C")} ${two} ${value("c", "1")}`);
    else if (lower === "inductor" && two)
      out.push(`${element("L")} ${two} ${value("l", "1")}`);
    else if ((lower === "vsource" || lower === "isource") && two)
      out.push(
        `${element(lower === "vsource" ? "V" : "I")} ${two} DC ${value("dc", "0")}`,
      );
    else if ((lower === "diode" || kind === "d") && two)
      out.push(`${element("D")} ${two} ${master}`);
    else if ((kind === "nmos" || kind === "pmos") && nodes.length === 4)
      out.push([element("M"), ...nodes, master, ...parameters].join(" "));
    else if (
      (kind === "npn" || kind === "pnp") &&
      (nodes.length === 3 || nodes.length === 4)
    )
      out.push([element("Q"), ...nodes, master, ...parameters].join(" "));
    else out.push([element("X"), ...nodes, master, ...parameters].join(" "));
  }
  return { text: `${out.join("\n")}\n`, from: "spectre" };
}
