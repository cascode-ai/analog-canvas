// Review's two netlists name their devices differently (the dataset's M3
// is our XM4). This matches devices by what they connect to, so choosing a
// line on one side lights its counterpart on the other. A reading aid: a
// tolerant parse of SPICE-like text, not an equivalence check.

export interface NetlistDevice {
  name: string;
  kind: string;
  pins: { role: string; net: string }[];
  /** Its line in the text, from 0. */
  line: number;
}

const GROUND = new Set(["0", "gnd", "gnd!", "vss", "vss!", "agnd", "dgnd"]);
const SUPPLY = new Set(["vdd", "vdd!", "vcc", "avdd", "vdda", "dvdd"]);

/** Ground and the positive supply are the only names both sides share. */
const netKey = (name: string) => {
  const lower = name.toLowerCase();
  return GROUND.has(lower) ? "#gnd" : SUPPLY.has(lower) ? "#vdd" : lower;
};

const channel = (model: string) =>
  /pfet|pmos|pch/u.test(model)
    ? "pmos"
    : /nfet|nmos|nch/u.test(model)
      ? "nmos"
      : null;

/** A subcircuit instance's kind from its model: a PDK device or a block. */
function instanceKind(model: string): string {
  const lower = model.toLowerCase();
  const mos = channel(lower);
  if (mos) return mos;
  if (/pnp/u.test(lower)) return "pnp";
  if (/npn/u.test(lower)) return "npn";
  if (/res/u.test(lower)) return "res";
  if (/cap/u.test(lower)) return "cap";
  if (/ind/u.test(lower)) return "ind";
  if (/diode/u.test(lower)) return "diode";
  return `x:${lower}`;
}

/** Roles of each kind's pins; MOS bulk and a BJT's substrate are left out. */
function rolesOf(kind: string, count: number): string[] {
  switch (kind) {
    case "nmos":
    case "pmos":
      // Drain and source are one role: datasets swap them freely.
      return ["ds", "g", "ds"];
    case "npn":
    case "pnp":
      return ["c", "b", "e"];
    case "res":
    case "cap":
    case "ind":
      return ["t", "t"];
    case "diode":
      return ["a", "k"];
    case "vcvs":
    case "vccs":
      return ["o+", "o-", "c+", "c-"];
    case "switch":
      return ["t", "t", "c+", "c-"];
    case "vsrc":
    case "isrc":
    case "bsrc":
    case "cccs":
    case "ccvs":
      return ["+", "-"];
    default:
      return Array.from({ length: count }, (_, index) => `p${index}`);
  }
}

/** One device line's kind and nets, or null for anything else. */
function parseDevice(text: string, line: number): NetlistDevice | null {
  const tokens = text
    .replace(/[()]/gu, " ")
    .trim()
    .split(/\s+/u)
    .filter((token) => token.length > 0);
  const name = tokens[0];
  if (!name) return null;
  const positional = tokens
    .slice(1)
    .filter((token) => !token.includes("=") && !token.endsWith(":"));
  const letter = name[0]!.toUpperCase();
  let kind: string;
  let nodes: string[];
  const take = (count: number) => positional.slice(0, count);
  switch (letter) {
    case "M": {
      nodes = take(4);
      kind =
        channel((positional[4] ?? "").toLowerCase()) ??
        ((positional[4] ?? "").toLowerCase().startsWith("p") ? "pmos" : "nmos");
      break;
    }
    case "Q":
      nodes = take(positional.length >= 5 ? 4 : 3);
      kind = /pnp/iu.test(positional[nodes.length] ?? "") ? "pnp" : "npn";
      break;
    case "R":
    case "C":
    case "L":
      nodes = take(2);
      kind = letter === "R" ? "res" : letter === "C" ? "cap" : "ind";
      break;
    case "D":
      nodes = take(2);
      kind = "diode";
      break;
    case "V":
    case "I":
    case "B":
      nodes = take(2);
      kind = letter === "V" ? "vsrc" : letter === "I" ? "isrc" : "bsrc";
      break;
    case "E":
    case "G":
      nodes = take(4);
      kind = letter === "E" ? "vcvs" : "vccs";
      break;
    case "F":
    case "H":
      nodes = take(2);
      kind = letter === "F" ? "cccs" : "ccvs";
      break;
    case "S":
      nodes = take(4);
      kind = "switch";
      break;
    case "X": {
      if (positional.length < 2) return null;
      const model = positional.at(-1)!;
      kind = instanceKind(model);
      nodes = positional.slice(0, -1);
      if (kind === "nmos" || kind === "pmos") nodes = nodes.slice(0, 4);
      break;
    }
    default:
      return null;
  }
  const roles = rolesOf(kind, nodes.length);
  return {
    name,
    kind,
    line,
    pins: roles
      .map((role, index) => ({ role, net: nodes[index] }))
      .filter((pin): pin is { role: string; net: string } => !!pin.net)
      .map((pin) => ({ role: pin.role, net: netKey(pin.net) })),
  };
}

/**
 * The circuit's devices: those outside any `.subckt`, else those of the
 * last one (the top cell, after the blocks it uses). Continuation lines join
 * their line; comments and dot cards are skipped.
 */
export function netlistDevices(text: string): NetlistDevice[] {
  const lines = text.split(/\r?\n/u);
  const outside: NetlistDevice[] = [];
  let block: NetlistDevice[] | null = null;
  let last: NetlistDevice[] = [];
  let pending: { text: string; line: number } | null = null;
  const flush = () => {
    if (!pending) return;
    const device = parseDevice(pending.text, pending.line);
    if (device) (block ?? outside).push(device);
    pending = null;
  };
  lines.forEach((raw, line) => {
    const text = raw.trim();
    if (text.startsWith("+")) {
      if (pending) pending.text += ` ${text.slice(1)}`;
      return;
    }
    flush();
    if (!text || text.startsWith("*") || text.startsWith("//")) return;
    const card = text.toLowerCase();
    if (card.startsWith(".subckt")) block = [];
    else if (card.startsWith(".ends")) {
      if (block) last = block;
      block = null;
    } else if (!text.startsWith(".")) pending = { text, line };
  });
  flush();
  return outside.length > 0 ? outside : last;
}

/**
 * Pairs the two sides' devices, left name to right name. Colour refinement
 * over devices and nets gives each device a signature of its neighbourhood;
 * devices alone in their signature on both sides pair, and a tie (such as a
 * differential pair's halves) is broken in name order, then refined again so
 * the rest follows that choice. What still differs pairs by coarser
 * signatures, last by kind alone.
 */
export function matchDevices(
  left: readonly NetlistDevice[],
  right: readonly NetlistDevice[],
): Map<string, string> {
  const sides = [left, right] as const;
  const pairs = new Map<string, string>();
  const labels = [new Map<string, number>(), new Map<string, number>()];
  const order = (a: NetlistDevice, b: NetlistDevice) =>
    a.name.localeCompare(b.name, "en", { numeric: true });

  /** Each side's device colours after `rounds` rounds, ids shared by both. */
  const colours = (rounds: number): [number[], number[]] => {
    const intern = new Map<string, number>();
    const id = (key: string) => {
      let value = intern.get(key);
      if (value === undefined) intern.set(key, (value = intern.size));
      return value;
    };
    const devices = sides.map((devs, side) =>
      devs.map((device) =>
        id(`${device.kind}#${labels[side]!.get(device.name) ?? ""}`),
      ),
    );
    const nets = sides.map((devs) => {
      const colour = new Map<string, number>();
      for (const device of devs)
        for (const pin of device.pins)
          colour.set(pin.net, id(pin.net.startsWith("#") ? pin.net : "net"));
      return colour;
    });
    for (let round = 0; round < rounds; round += 1) {
      const next = sides.map((devs, side) =>
        devs.map((device, index) =>
          id(
            `${devices[side]![index]}|${device.pins
              .map((pin) => `${pin.role}:${nets[side]!.get(pin.net)}`)
              .sort()
              .join(",")}`,
          ),
        ),
      );
      sides.forEach((devs, side) => {
        const touching = new Map<string, string[]>();
        devs.forEach((device, index) => {
          for (const pin of device.pins)
            touching.set(pin.net, [
              ...(touching.get(pin.net) ?? []),
              `${next[side]![index]}@${pin.role}`,
            ]);
        });
        for (const [net, around] of touching)
          nets[side]!.set(
            net,
            id(`${nets[side]!.get(net)}|${around.sort().join(",")}`),
          );
      });
      devices[0] = next[0]!;
      devices[1] = next[1]!;
    }
    return [devices[0]!, devices[1]!];
  };

  const pair = (a: NetlistDevice, b: NetlistDevice) => {
    pairs.set(a.name, b.name);
    labels[0]!.set(a.name, pairs.size);
    labels[1]!.set(b.name, pairs.size);
  };
  const unpaired = (rounds: number) => {
    const [l, r] = colours(rounds);
    const groups = new Map<number, [NetlistDevice[], NetlistDevice[]]>();
    const add = (side: 0 | 1, device: NetlistDevice, colour: number) => {
      const group = groups.get(colour) ?? [[], []];
      group[side].push(device);
      groups.set(colour, group);
    };
    left.forEach((device, index) => {
      if (!pairs.has(device.name)) add(0, device, l[index]!);
    });
    const taken = new Set(pairs.values());
    right.forEach((device, index) => {
      if (!taken.has(device.name)) add(1, device, r[index]!);
    });
    return [...groups.values()].filter(([a, b]) => a.length && b.length);
  };

  const depth = Math.min(8, left.length + right.length);
  for (let guard = 0; guard < left.length + right.length; guard += 1) {
    const groups = unpaired(depth);
    if (groups.length === 0) break;
    const lone = groups.filter(([a, b]) => a.length === 1 && b.length === 1);
    if (lone.length > 0) for (const [[a], [b]] of lone) pair(a!, b!);
    else {
      const [a, b] = groups[0]!;
      pair([...a].sort(order)[0]!, [...b].sort(order)[0]!);
    }
  }
  // What differs: coarser neighbourhoods, then kind alone.
  for (const rounds of [2, 1, 0])
    for (const [a, b] of unpaired(rounds)) {
      const sortedA = [...a].sort(order);
      const sortedB = [...b].sort(order);
      for (let index = 0; index < Math.min(a.length, b.length); index += 1)
        pair(sortedA[index]!, sortedB[index]!);
    }
  return pairs;
}

/**
 * Devices one netlist holds twice over: alike in kind and in everything
 * they connect to, such as a differential pair's halves or a current
 * mirror's two sides, by the same colour refinement. Pairs only; devices on
 * the very same nets (in parallel) are not twins.
 */
export function structuralTwins(
  devices: readonly NetlistDevice[],
  rounds = 6,
): [NetlistDevice, NetlistDevice][] {
  const intern = new Map<string, number>();
  const id = (key: string) => {
    let value = intern.get(key);
    if (value === undefined) intern.set(key, (value = intern.size));
    return value;
  };
  let colours = devices.map((device) => id(device.kind));
  const nets = new Map<string, number>();
  for (const device of devices)
    for (const pin of device.pins)
      nets.set(pin.net, id(pin.net.startsWith("#") ? pin.net : "net"));
  for (let round = 0; round < rounds; round += 1) {
    colours = devices.map((device, index) =>
      id(
        `${colours[index]}|${device.pins
          .map((pin) => `${pin.role}:${nets.get(pin.net)}`)
          .sort()
          .join(",")}`,
      ),
    );
    const touching = new Map<string, string[]>();
    devices.forEach((device, index) => {
      for (const pin of device.pins)
        touching.set(pin.net, [
          ...(touching.get(pin.net) ?? []),
          `${colours[index]}@${pin.role}`,
        ]);
    });
    for (const [net, around] of touching)
      nets.set(net, id(`${nets.get(net)}|${around.sort().join(",")}`));
  }
  const groups = new Map<number, NetlistDevice[]>();
  devices.forEach((device, index) =>
    groups.set(colours[index]!, [
      ...(groups.get(colours[index]!) ?? []),
      device,
    ]),
  );
  const netsOf = (device: NetlistDevice) =>
    device.pins
      .map((pin) => pin.net)
      .sort()
      .join(",");
  return [...groups.values()]
    .filter(
      (group): group is [NetlistDevice, NetlistDevice] =>
        group.length === 2 && netsOf(group[0]!) !== netsOf(group[1]!),
    )
    .map(([a, b]) => [a, b]);
}
