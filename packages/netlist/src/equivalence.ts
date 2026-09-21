import { deviceDescriptor, resolveReviewedExternalBinding } from "@icm/devices";
import type { CircuitProject } from "@icm/model";
import { parseSpiceNumber } from "@icm/spice";
import { analyzeDesignNetlistForAuthoring } from "./extract.js";
import type {
  DesignNetlistIR,
  DesignNetlistInstance,
  DesignNetlistParameter,
} from "./ir.js";

export interface ElectricalGraph {
  labels: string[];
  edges: number[][];
  /** Candidate index only. Equality is NEVER evidence of equivalence. */
  bucket: string;
  /** Semantic identities for topology search only; exact duplicate labels stay intact. */
  topologyLabels?: string[];
}

export type ElectricalGraphResult =
  | { status: "ready"; graph: ElectricalGraph }
  | { status: "uncheckable"; reason: string };

function numericValue(raw: string): string | null {
  const parsed = parseSpiceNumber(raw);
  if (!parsed) return null;
  const match = /^([+-]?)((?:\d+(?:\.\d*)?|\.\d+))(?:e([+-]?\d+))?/iu.exec(
    raw.trim(),
  );
  if (!match) return null;
  const scales: Record<string, number> = {
    t: 12,
    g: 9,
    meg: 6,
    k: 3,
    m: -3,
    u: -6,
    n: -9,
    p: -12,
    f: -15,
    a: -18,
    mil: -7,
  };
  let digits = BigInt(match[2]!.replace(".", ""));
  if (parsed.suffix === "mil") digits *= 254n;
  if (digits === 0n) return "0";
  let exponent =
    BigInt(match[3] ?? "0") -
    BigInt(match[2]!.split(".")[1]?.length ?? 0) +
    BigInt(scales[parsed.suffix ?? ""] ?? 0);
  while (digits % 10n === 0n) {
    digits /= 10n;
    exponent++;
  }
  return `${match[1] === "-" ? "-" : ""}${digits}e${exponent}`;
}

function parameters(values: DesignNetlistParameter[]): string {
  return JSON.stringify(
    values
      .map(({ name, rawValue }) => {
        // References inside behavioral expressions cannot be renamed as strings.
        if (/(?:\b[vi]\s*\(|@)/iu.test(rawValue))
          throw new Error("Behavioral references need manual comparison");
        const number = numericValue(rawValue);
        return [
          name,
          number !== null ? ["number", number] : ["text", rawValue.trim()],
        ];
      })
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  );
}

/** Layout-free graph of the emitted devices, with paramless hierarchy expanded. */
export function electricalGraphFromIR(
  ir: DesignNetlistIR,
  sourceSymbols: ReadonlyMap<DesignNetlistInstance, string> = new Map(),
): ElectricalGraphResult {
  try {
    const labels: string[] = [];
    const topologyLabels: string[] = [];
    const adjacency: Set<number>[] = [];
    const parent: number[] = [];
    const vertex = (label: string, topology = topologyLabel(label)) => {
      if (labels.length >= 3000)
        throw new Error("Circuit exceeds the comparison size limit");
      const id = labels.length;
      labels.push(label);
      topologyLabels.push(topology);
      adjacency.push(new Set());
      parent.push(id);
      return id;
    };
    const root = (id: number): number => {
      if (parent[id] !== id) parent[id] = root(parent[id]!);
      return parent[id]!;
    };
    const join = (a: number, b: number) => {
      parent[root(a)] = root(b);
    };
    const edge = (a: number, b: number) => {
      adjacency[a]!.add(b);
      adjacency[b]!.add(a);
    };
    const globals = new Map<string, number>();
    const cells = new Map(ir.cells.map((cell) => [cell.name, cell]));
    const externalMasters = new Map(
      (ir.externalMasters ?? []).map((master) => [master.name, master]),
    );
    const expand = (
      cell: DesignNetlistIR["cells"][number],
      ports: number[] | null,
      ancestors: Set<string>,
    ) => {
      if (ancestors.has(cell.id) || ancestors.size > 32)
        throw new Error("Recursive hierarchy needs manual comparison");
      if (cell.formalParameters?.length)
        throw new Error("Parameterized hierarchy needs manual comparison");
      const path = new Set([...ancestors, cell.id]);
      const local = new Map<string, number>();
      const globalNames = new Set(
        cell.nets
          .filter((net) => net.scope === "global")
          .map((net) => net.name),
      );
      const net = (name: string) => {
        const cache = globalNames.has(name) ? globals : local;
        let id = cache.get(name);
        if (id === undefined) {
          id = vertex("net");
          cache.set(name, id);
          if (cache === globals) edge(id, vertex(`global:${name}`));
        }
        return id;
      };
      cell.ports.forEach((port, index) => {
        const id = net(port.netName);
        if (ports) {
          if (ports[index] === undefined)
            throw new Error("Incomplete hierarchy interface");
          join(id, ports[index]!);
        } else {
          // Keep the ordered external contract, but ignore signal spelling.
          const supply = /^(VDD|VSS)$/iu.test(port.name)
            ? port.name.toUpperCase()
            : "signal";
          edge(id, vertex(`port:${index}:${supply}`));
        }
      });
      for (const instance of cell.instances) {
        const child =
          instance.deviceClass === "hierarchical" && instance.target
            ? cells.get(instance.target)
            : undefined;
        if (child) {
          if (instance.parameters.length)
            throw new Error("Parameterized hierarchy needs manual comparison");
          expand(
            child,
            child.ports.map((port) => {
              const node = instance.nodes.find(
                (item) => item.pinName === port.name,
              );
              if (!node) throw new Error("Incomplete hierarchy interface");
              return net(node.netName);
            }),
            path,
          );
          continue;
        }
        const reviewed =
          instance.invocationKind === "subcircuit" && instance.target
            ? resolveReviewedExternalBinding(
                instance.target,
                instance.nodes.map((node) => node.pinName),
              )
            : undefined;
        const symbol = reviewed?.symbolId ?? sourceSymbols.get(instance);
        const descriptor = symbol ? deviceDescriptor(symbol) : undefined;
        const topologyClass = reviewed?.deviceClass ?? instance.deviceClass;
        const topologyTarget =
          topologyClass === "mos" && descriptor?.mosBulkClass
            ? descriptor.mosBulkClass
            : topologyClass === "bjt" && (symbol === "npn" || symbol === "pnp")
              ? symbol
              : instance.target;
        const device = vertex(
          JSON.stringify([
            "device",
            instance.deviceClass,
            instance.invocationKind,
            instance.target,
            parameters(instance.parameters),
            instance.target
              ? (externalMasters
                  .get(instance.target)
                  ?.formalParameters.map((parameter) => [
                    parameter.name,
                    parameter.defaultValue === undefined
                      ? null
                      : parameters([
                          {
                            name: parameter.name,
                            rawValue: parameter.defaultValue,
                          },
                        ]),
                  ])
                  .sort() ?? [])
              : [],
          ]),
          topologyLabel(
            JSON.stringify([
              "device",
              topologyClass,
              reviewed ? "primitive" : instance.invocationKind,
              topologyTarget,
            ]),
          ),
        );
        const symmetric =
          instance.invocationKind === "primitive" &&
          ["resistor", "capacitor", "inductor"].includes(instance.deviceClass);
        instance.nodes.forEach((node, index) => {
          // External black boxes bind by position; MOS D/G/S/B are distinct.
          const pin = vertex(
            `pin:${symmetric ? "passive" : instance.invocationKind === "subcircuit" ? index : node.pinName}`,
            reviewed
              ? topologyLabel(`pin:${reviewed.terminals[index]!.pinName}`)
              : topologyLabel(
                  `pin:${symmetric ? "passive" : instance.invocationKind === "subcircuit" ? index : node.pinName}`,
                ),
          );
          edge(device, pin);
          edge(pin, net(node.netName));
        });
      }
    };
    const top = ir.cells.find((cell) => cell.id === ir.topCellId);
    if (!top) throw new Error("Missing top-level circuit");
    expand(top, null, new Set());
    if (!labels.some((label) => label.startsWith('["device"')))
      throw new Error("No netlist devices to compare");
    const roots = labels.flatMap((_, id) => (root(id) === id ? [id] : []));
    const indices = new Map(roots.map((id, index) => [id, index]));
    const edges = roots.map(() => new Set<number>());
    adjacency.forEach((neighbors, from) => {
      const a = indices.get(root(from))!;
      for (const to of neighbors) edges[a]!.add(indices.get(root(to))!);
    });
    const compactLabels = roots.map((id) => labels[id]!);
    return {
      status: "ready",
      graph: {
        labels: compactLabels,
        topologyLabels: roots.map((id) => topologyLabels[id]!),
        edges: edges.map((neighbors) => [...neighbors].sort((a, b) => a - b)),
        bucket: JSON.stringify(
          compactLabels
            .map((label, index) => [label, edges[index]!.size])
            .sort(),
        ),
      },
    };
  } catch (error) {
    return {
      status: "uncheckable",
      reason:
        error instanceof Error
          ? error.message
          : "Cannot extract electrical structure",
    };
  }
}

export function projectElectricalGraph(
  project: CircuitProject,
): ElectricalGraphResult {
  const result = analyzeDesignNetlistForAuthoring(project, {
    format: "spectre",
    groundPin: "pin",
  });
  // Unset model/value fields are part of an abstract netlist, not guesses at a
  // PDK. Compare unset with unset only; never substitute the viewer's preset.
  const errors = result.diagnostics.filter(
    (item) =>
      item.severity === "error" &&
      !["MISSING_MODEL_TARGET", "MISSING_REQUIRED_PARAMETER"].includes(
        item.code,
      ),
  );
  if (!result.ir || errors.length)
    return {
      status: "uncheckable",
      reason: errors[0]?.message ?? "No usable netlist",
    };
  const sourceSymbols = new Map<DesignNetlistInstance, string>();
  for (const cell of result.ir.cells) {
    const document = project.documents.find((item) => item.id === cell.id);
    for (const instance of cell.instances) {
      const source = document?.instances.find(
        (item) => item.id === instance.id,
      );
      if (source) sourceSymbols.set(instance, source.symbolId);
      if (!instance.target && source) {
        const descriptor = deviceDescriptor(source.symbolId);
        if (descriptor?.targetPolicy === "required-model") {
          // In particular, an unbound PMOS must never match an unbound NMOS.
          instance.target = `unset:${descriptor.mosBulkClass ?? source.symbolId}`;
        }
      }
    }
  }
  return electricalGraphFromIR(result.ir, sourceSymbols);
}

/** Exact colored-graph bijection. A budget exhaustion is explicitly unknown. */
export function compareElectricalGraphs(
  a: ElectricalGraph,
  b: ElectricalGraph,
  maxSteps = 100_000,
): "equal" | "different" | "unknown" {
  if (a.bucket !== b.bucket) return "different";
  const n = a.labels.length;
  const palette = (values: string[]) => {
    const sorted = [...new Set(values)].sort();
    const ids = new Map(sorted.map((value, index) => [value, index]));
    return values.map((value) => ids.get(value)!);
  };
  let colors = palette([...a.labels, ...b.labels]);
  const edges = [
    ...a.edges,
    ...b.edges.map((neighbors) => neighbors.map((id) => id + n)),
  ];
  for (let pass = 0; pass < n; pass++) {
    const next = palette(
      colors.map((color, id) =>
        JSON.stringify([
          color,
          edges[id]!.map((neighbor) => colors[neighbor]!).sort((x, y) => x - y),
        ]),
      ),
    );
    const stable = new Set(next).size === new Set(colors).size;
    colors = next;
    if (stable) break;
  }
  const histogram = (items: number[]) =>
    JSON.stringify([...items].sort((x, y) => x - y));
  if (histogram(colors.slice(0, n)) !== histogram(colors.slice(n)))
    return "different";
  const candidates = a.labels.map((_, i) =>
    b.labels.flatMap((_, j) => (colors[i] === colors[n + j] ? [j] : [])),
  );
  const mapped = new Map<number, number>();
  const used = new Set<number>();
  const neighbors = b.edges.map((items) => new Set(items));
  let steps = 0;
  let work = 0;
  const search = (): boolean | null => {
    if (++steps > maxSteps) return null;
    if (mapped.size === n) return true;
    let source = -1;
    let choices: number[] | null = null;
    for (let i = 0; i < n; i++) {
      if (mapped.has(i)) continue;
      const viable = candidates[i]!.filter((j) => {
        if (++work > maxSteps * 20) return false;
        return (
          !used.has(j) &&
          [...mapped].every(([from, to]) => {
            if (++work > maxSteps * 20) return false;
            return a.edges[i]!.includes(from) === neighbors[j]!.has(to);
          })
        );
      });
      if (work > maxSteps * 20) return null;
      if (!viable.length) return false;
      if (!choices || viable.length < choices.length) {
        source = i;
        choices = viable;
      }
      if (choices.length === 1) break;
    }
    for (const target of choices!) {
      mapped.set(source, target);
      used.add(target);
      const result = search();
      if (result !== false) return result;
      mapped.delete(source);
      used.delete(target);
    }
    return false;
  };
  const result = search();
  return result === null ? "unknown" : result ? "equal" : "different";
}

function topologyLabel(label: string): string {
  // A topology search asks where the circuit reaches the outside world, not
  // what an author called that boundary or whether they drew it as a Port,
  // VDD/VSS power symbol, or another global rail. Exact duplicate checking
  // deliberately keeps those interface contracts; topology matching does not.
  if (label.startsWith("port:") || label.startsWith("global:"))
    return "terminal";
  if (label.startsWith("pin:")) {
    const pin = label.slice("pin:".length).toLowerCase();
    const aliases: Record<string, string> = {
      drain: "d",
      gate: "g",
      source: "s",
      bulk: "b",
      body: "b",
      collector: "c",
      base: "b",
      emitter: "e",
    };
    return `pin:${aliases[pin] ?? pin}`;
  }
  if (!label.startsWith('["device"')) return label;
  try {
    const value = JSON.parse(label) as unknown[];
    const deviceClass = String(value[1] ?? "");
    const target = String(value[3] ?? "").toLowerCase();
    const polarity =
      deviceClass === "mos"
        ? /(?:^|[^a-z])(?:pmos|pfet|p-fet)|unset:pmos/u.test(target)
          ? "p"
          : /(?:^|[^a-z])(?:nmos|nfet|n-fet)|unset:nmos/u.test(target)
            ? "n"
            : `model:${target}`
        : deviceClass === "bjt"
          ? target.includes("pnp")
            ? "pnp"
            : target.includes("npn")
              ? "npn"
              : `model:${target}`
          : deviceClass === "hierarchical"
            ? value[3]
            : null;
    // Models and values are exact-duplicate evidence, but not topology. Keep
    // the emitted device class, invocation kind and recognizable transistor
    // polarity so differently sized/modelled NMOS stages remain close without
    // making a complementary PMOS stage identical.
    return JSON.stringify(["device", deviceClass, value[2], polarity]);
  } catch {
    return label;
  }
}

function topologyGraph(graph: ElectricalGraph): ElectricalGraph {
  const labels = graph.topologyLabels ?? graph.labels.map(topologyLabel);
  return {
    labels,
    edges: graph.edges,
    bucket: JSON.stringify(
      labels.map((label, index) => [label, graph.edges[index]!.length]).sort(),
    ),
  };
}

/**
 * Exact graph isomorphism after removing author-facing names and interface
 * representation. Device classes, transistor polarity, pin roles and actual
 * connectivity remain structural evidence.
 */
export function compareElectricalTopologies(
  a: ElectricalGraph,
  b: ElectricalGraph,
  maxSteps = 100_000,
): "equal" | "different" | "unknown" {
  return compareElectricalGraphs(topologyGraph(a), topologyGraph(b), maxSteps);
}

function multisetDice(
  left: readonly number[],
  right: readonly number[],
): number {
  if (left.length + right.length === 0) return 1;
  const counts = new Map<number, number>();
  for (const item of left) counts.set(item, (counts.get(item) ?? 0) + 1);
  let shared = 0;
  for (const item of right) {
    const remaining = counts.get(item) ?? 0;
    if (remaining === 0) continue;
    shared++;
    counts.set(item, remaining - 1);
  }
  return (2 * shared) / (left.length + right.length);
}

/**
 * Layout/name/interface-independent topology closeness in [0, 1].
 *
 * This is ranking evidence, never equivalence evidence. Exact duplicate
 * decisions belong to compareElectricalTopologies. The score compares
 * device/pin/external-terminal populations and two rounds of their electrical
 * neighborhoods, while deliberately ignoring model and parameter values,
 * names, top-level port order, and port-versus-global representation.
 */
export function electricalGraphTopologySimilarity(
  a: ElectricalGraph,
  b: ElectricalGraph,
): number {
  const leftSize = a.labels.length;
  const labels = [...topologyGraph(a).labels, ...topologyGraph(b).labels];
  const edges = [
    ...a.edges,
    ...b.edges.map((neighbors) =>
      neighbors.map((neighbor) => neighbor + leftSize),
    ),
  ];
  const palette = (values: readonly string[]) => {
    const sorted = [...new Set(values)].sort();
    const ids = new Map(sorted.map((value, index) => [value, index]));
    return values.map((value) => ids.get(value)!);
  };
  let colors = palette(
    labels.map((label, index) => JSON.stringify([label, edges[index]!.length])),
  );
  const scores = [
    multisetDice(colors.slice(0, leftSize), colors.slice(leftSize)),
  ];
  for (let round = 0; round < 2; round++) {
    colors = palette(
      colors.map((color, index) =>
        JSON.stringify([
          color,
          edges[index]!.map((neighbor) => colors[neighbor]!).sort(
            (x, y) => x - y,
          ),
        ]),
      ),
    );
    scores.push(
      multisetDice(colors.slice(0, leftSize), colors.slice(leftSize)),
    );
  }
  return scores[0]! * 0.2 + scores[1]! * 0.3 + scores[2]! * 0.5;
}
