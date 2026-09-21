import {
  electricalGraphTopologySimilarity,
  matchElectricalGraphs,
  matchElectricalTopologies,
  topologyGraph,
  type ElectricalGraph,
  type ElectricalDeviceOrigin,
} from "./equivalence.js";

export interface DeviceCorrespondence {
  source: ElectricalDeviceOrigin;
  target: ElectricalDeviceOrigin;
  parameterSimilarity: number;
}
export interface TopologyCorrespondence {
  exact: boolean;
  netlistMatch: "equal" | "different" | "unknown";
  similarity: number;
  structureSimilarity: number;
  parameterSimilarity: number;
  matchedDevices: number;
  sourceDevices: number;
  targetDevices: number;
  pairs: DeviceCorrespondence[];
  /** Search stopped at its work budget; pairs remain valid, not necessarily maximal. */
  limited: boolean;
}

// Structural evidence dominates; parameters can never rescue an unmatched device.
export const TOPOLOGY_STRUCTURE_WEIGHT = 0.85;
type Device = {
  vertex: number;
  type: string;
  pins: { role: string; net: number }[];
  parameters: Map<string, [string, string]>;
  model: string;
};
function devices(graph: ElectricalGraph): Device[] {
  const topology = topologyGraph(graph);
  return graph.labels.flatMap((label, vertex) => {
    if (!label.startsWith('["device"')) return [];
    const value = JSON.parse(label) as [
      string,
      string,
      string,
      string | null,
      string,
      unknown[],
    ];
    const parameters = new Map<string, [string, string]>(
      JSON.parse(value[4] ?? "[]"),
    );
    // External formal defaults participate alongside instance overrides.
    for (const [name, raw] of (value[5] ?? []) as [string, string | null][])
      if (!parameters.has(name) && raw) {
        const defaults = JSON.parse(raw) as [string, [string, string]][];
        if (defaults[0]) parameters.set(name, defaults[0][1]);
      }
    return [
      {
        vertex,
        type: topology.labels[vertex]!,
        parameters,
        model: JSON.stringify([value[1], value[2], value[3]]),
        pins: graph.edges[vertex]!.map((pin) => ({
          role: topology.labels[pin]!,
          net: graph.edges[pin]!.find((index) => index !== vertex)!,
        })).sort((a, b) => a.role.localeCompare(b.role) || a.net - b.net),
      },
    ];
  });
}
function parameterValueSimilarity(
  a: [string, string] | undefined,
  b: [string, string] | undefined,
): number {
  if (!a || !b) return 0;
  if (a[0] === b[0] && a[1] === b[1]) return 1;
  if (a[0] !== "number" || b[0] !== "number") return 0;
  const left = Number(a[1]),
    right = Number(b[1]);
  if (
    !Number.isFinite(left) ||
    !Number.isFinite(right) ||
    Math.sign(left) !== Math.sign(right)
  )
    return 0;
  const maximum = Math.max(Math.abs(left), Math.abs(right));
  return maximum ? Math.min(Math.abs(left), Math.abs(right)) / maximum : 0;
}
function parameterSimilarity(a: Device, b: Device): number {
  const names = new Set([...a.parameters.keys(), ...b.parameters.keys()]);
  const score = names.size
    ? [...names].reduce(
        (sum, name) =>
          sum +
          parameterValueSimilarity(
            a.parameters.get(name),
            b.parameters.get(name),
          ),
        0,
      ) / names.size
    : 1;
  return score * 0.8 + Number(a.model === b.model) * 0.2;
}

/** Candidate pin permutations preserve every role. Only passive 2-pin parts
 * have interchangeable terminals; black boxes remain positional. */
function pinOptions(a: Device, b: Device): number[][] {
  if (
    a.pins.length !== b.pins.length ||
    a.pins.some((pin, index) => pin.role !== b.pins[index]!.role)
  )
    return [];
  const normal = b.pins.map((pin) => pin.net);
  return a.pins.length === 2 &&
    a.pins[0]!.role === "pin:passive" &&
    a.pins[1]!.role === "pin:passive"
    ? [normal, [...normal].reverse()]
    : [normal];
}

/** An induced correspondence of devices and their incident nets. A shared net
 * on one side must be shared on the other, and distinct nets cannot collapse.
 * Budget exhaustion can only reduce coverage; it cannot produce a false match. */
function partialCorrespondence(
  source: Device[],
  target: Device[],
  maxWork: number,
) {
  const reverse = source.length > target.length;
  const left = reverse ? target : source,
    right = reverse ? source : target;
  const options = new Map(
    left.map((device) => [
      device.vertex,
      right
        .filter(
          (other) =>
            device.type === other.type && pinOptions(device, other).length,
        )
        .sort(
          (a, b) =>
            parameterSimilarity(device, b) - parameterSimilarity(device, a) ||
            a.vertex - b.vertex,
        ),
    ]),
  );
  const order = [...left].sort(
    (a, b) =>
      options.get(a.vertex)!.length - options.get(b.vertex)!.length ||
      b.pins.length - a.pins.length ||
      a.vertex - b.vertex,
  );
  const netMap = new Map<number, number>(),
    netReverse = new Map<number, number>(),
    used = new Set<number>();
  const matched: [Device, Device][] = [];
  let best: [Device, Device][] = [];
  let bestScore = -1,
    work = 0,
    limited = false;
  const visit = (index: number, score: number): void => {
    if (++work > maxWork) {
      limited = true;
      return;
    }
    if (
      matched.length > best.length ||
      (matched.length === best.length && score > bestScore)
    ) {
      best = [...matched];
      bestScore = score;
    }
    if (
      index === order.length ||
      matched.length + order.length - index < best.length ||
      (best.length === left.length && bestScore >= left.length - 1e-9)
    )
      return;
    const device = order[index]!;
    for (const candidate of options.get(device.vertex)!) {
      if (++work > maxWork) {
        limited = true;
        return;
      }
      if (used.has(candidate.vertex)) continue;
      for (const pins of pinOptions(device, candidate)) {
        const added: [number, number][] = [];
        let valid = true;
        for (let pin = 0; pin < pins.length; pin++) {
          const from = device.pins[pin]!.net,
            to = pins[pin]!;
          if (
            (netMap.has(from) && netMap.get(from) !== to) ||
            (netReverse.has(to) && netReverse.get(to) !== from)
          ) {
            valid = false;
            break;
          }
          if (!netMap.has(from)) {
            netMap.set(from, to);
            netReverse.set(to, from);
            added.push([from, to]);
          }
        }
        if (valid) {
          used.add(candidate.vertex);
          matched.push([device, candidate]);
          visit(index + 1, score + parameterSimilarity(device, candidate));
          matched.pop();
          used.delete(candidate.vertex);
        }
        for (const [from, to] of added) {
          netMap.delete(from);
          netReverse.delete(to);
        }
        if (limited) return;
      }
    }
    visit(index + 1, score);
  };
  // Large inputs still get a verified greedy witness. The old depth guard
  // returned no correspondence at all above 256 devices. Keep the same net
  // bijection/pin-role rules without recursive backtracking and label the
  // result limited: coverage is useful evidence, never an optimality claim.
  if (order.length > 256) {
    for (const device of order) {
      let accepted = false;
      for (const candidate of options.get(device.vertex)!) {
        if (++work > maxWork) break;
        if (used.has(candidate.vertex)) continue;
        for (const pins of pinOptions(device, candidate)) {
          const added: [number, number][] = [];
          let valid = true;
          for (let index = 0; index < pins.length; index++) {
            const from = device.pins[index]!.net,
              to = pins[index]!;
            if (
              (netMap.has(from) && netMap.get(from) !== to) ||
              (netReverse.has(to) && netReverse.get(to) !== from)
            ) {
              valid = false;
              break;
            }
            if (!netMap.has(from)) {
              netMap.set(from, to);
              netReverse.set(to, from);
              added.push([from, to]);
            }
          }
          if (valid) {
            matched.push([device, candidate]);
            used.add(candidate.vertex);
            accepted = true;
            break;
          }
          for (const [from, to] of added) {
            netMap.delete(from);
            netReverse.delete(to);
          }
        }
        if (accepted) break;
      }
      if (work > maxWork) break;
    }
    return {
      mapping: reverse
        ? matched.map(([a, b]): [Device, Device] => [b, a])
        : matched,
      limited: true,
    };
  }
  visit(0, 0);
  return {
    mapping: reverse ? best.map(([a, b]): [Device, Device] => [b, a]) : best,
    limited,
  };
}

export function compareTopologyCorrespondence(
  a: ElectricalGraph,
  b: ElectricalGraph,
  maxWork = 40_000,
): TopologyCorrespondence {
  const left = devices(a),
    right = devices(b);
  const byLeft = new Map(left.map((device) => [device.vertex, device]));
  const byRight = new Map(right.map((device) => [device.vertex, device]));
  const exactNetlist = matchElectricalGraphs(a, b, maxWork);
  const topology =
    exactNetlist.status === "equal"
      ? exactNetlist
      : matchElectricalTopologies(a, b, maxWork, (i, j) => {
          const from = byLeft.get(i),
            to = byRight.get(j);
          return from && to ? parameterSimilarity(from, to) : 0;
        });
  let mapping: [Device, Device][];
  let limited = topology.status === "unknown";
  if (topology.status === "equal")
    mapping = left.map((device) => [
      device,
      byRight.get(topology.mapping[device.vertex]!)!,
    ]);
  else {
    const partial = partialCorrespondence(left, right, maxWork);
    mapping = partial.mapping;
    limited ||= partial.limited;
  }
  const coverage =
    left.length + right.length
      ? (2 * mapping.length) / (left.length + right.length)
      : 0;
  const structureSimilarity =
    topology.status === "equal"
      ? 1
      : Math.min(
          0.99,
          coverage * (0.8 + 0.2 * electricalGraphTopologySimilarity(a, b)),
        );
  const paramScore = mapping.length
    ? mapping.reduce(
        (sum, [from, to]) => sum + parameterSimilarity(from, to),
        0,
      ) / mapping.length
    : 0;
  const sourceOrigins = new Map(
    a.deviceOrigins?.map((origin) => [origin.vertex, origin]),
  );
  const targetOrigins = new Map(
    b.deviceOrigins?.map((origin) => [origin.vertex, origin]),
  );
  return {
    exact: topology.status === "equal",
    netlistMatch: exactNetlist.status,
    similarity:
      exactNetlist.status === "equal"
        ? 1
        : Math.min(
            0.999,
            structureSimilarity *
              (TOPOLOGY_STRUCTURE_WEIGHT +
                (1 - TOPOLOGY_STRUCTURE_WEIGHT) * paramScore),
          ),
    structureSimilarity,
    parameterSimilarity: paramScore,
    matchedDevices: mapping.length,
    sourceDevices: left.length,
    targetDevices: right.length,
    limited,
    pairs: mapping.flatMap(([from, to]) => {
      const source = sourceOrigins.get(from.vertex),
        target = targetOrigins.get(to.vertex);
      return source && target
        ? [
            {
              source,
              target,
              parameterSimilarity: parameterSimilarity(from, to),
            },
          ]
        : [];
    }),
  };
}
