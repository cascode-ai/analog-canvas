import { parseSpiceNumber } from "./expression.js";
import type { CircuitCellIR, CircuitIR } from "./ir.js";

export interface StructuralDifference {
  kind:
    "interface" | "device" | "target" | "parameter" | "connection" | "scope";
  cell: string;
  object: string;
  expected: unknown;
  actual: unknown;
}
export interface StructuralComparison {
  status: "equal" | "different" | "inconclusive";
  differences: StructuralDifference[];
  reasons: string[];
  comparedCells: number;
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
): StructuralComparison {
  const differences: StructuralDifference[] = [];
  const reasons = new Set<string>();
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
    if (
      ir.unresolvedStatements.length ||
      ir.preservedStatements.length ||
      ir.parameters.length ||
      ir.models.length
    )
      reasons.add(
        `${label}: declarations, model bodies or preserved statements need manual comparison`,
      );
  }
  const seen = new Set<string>();
  const pair = (an: string, en: string, ancestors: Set<string>) => {
    const key = JSON.stringify([lower(an), lower(en)]);
    if (ancestors.has(key)) {
      reasons.add("Recursive hierarchy is unsupported");
      return;
    }
    if (seen.has(key)) return;
    seen.add(key);
    const a = actual.cells.find((c) => lower(c.name) === lower(an));
    const e = expected.cells.find((c) => lower(c.name) === lower(en));
    if (!a || !e) {
      reasons.add(`Missing comparison Cell: ${!a ? an : en}`);
      return;
    }
    if (++comparedCells > 128) {
      reasons.add("Comparison exceeds 128 Cells");
      return;
    }
    if (a.parameters.length || e.parameters.length)
      reasons.add(`${en}: parameterized hierarchy needs manual comparison`);
    // Formal names identify endpoints; order remains part of the exported ABI.
    difference(
      "interface",
      en,
      "ports",
      a.ports.map((p) => lower(p.name)),
      e.ports.map((p) => lower(p.name)),
    );
    const project = (cell: CircuitCellIR) => {
      const nodes = new Map<string, string[]>();
      const endpoints = new Map<string, string>();
      const add = (endpoint: string, netId: string) => {
        const list = nodes.get(netId) ?? [];
        list.push(endpoint);
        nodes.set(netId, list);
        endpoints.set(endpoint, netId);
      };
      const devices = new Map<string, CircuitCellIR["instances"][number]>();
      for (const instance of cell.instances) {
        const name = lower(instance.name);
        if (devices.has(name))
          reasons.add(`${cell.name}: duplicate Reference ${name}`);
        devices.set(name, instance);
        for (const pin of instance.terminals)
          add(`${name}:${pin.position}`, pin.netId);
      }
      for (const p of cell.ports) add(`port:${lower(p.name)}`, p.netId);
      return { devices, endpoints, nodes };
    };
    const ap = project(a),
      ep = project(e);
    const target = (instance: CircuitCellIR["instances"][number]) => {
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
          reasons.add(`${en}/${instance.name}: opaque device`);
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
      difference("target", en, ref, target(ai), target(ei));
      if (ai.target.kind === "subcircuit" && ei.target.kind === "subcircuit")
        pair(
          ai.target.cellName,
          ei.target.cellName,
          new Set([...ancestors, key]),
        );
      for (const param of new Set([
        ...Object.keys(ai.parameters),
        ...Object.keys(ei.parameters),
      ])) {
        const av = ai.parameters[param]?.rawText,
          ev = ei.parameters[param]?.rawText;
        const avn = av === undefined ? null : parseSpiceNumber(av);
        const evn = ev === undefined ? null : parseSpiceNumber(ev);
        if (
          (av !== undefined && (!avn || !Number.isFinite(avn.value))) ||
          (ev !== undefined && (!evn || !Number.isFinite(evn.value)))
        ) {
          reasons.add(
            `${en}/${ref}/${param}: expression or nonliteral value needs manual comparison`,
          );
          continue;
        }
        difference(
          "parameter",
          en,
          `${ref}.${param}`,
          avn?.value ?? null,
          evn?.value ?? null,
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
  // Known differences may be useful even when other parts were uncheckable.
  return {
    status: reasons.size
      ? "inconclusive"
      : differences.length
        ? "different"
        : "equal",
    differences,
    reasons: [...reasons],
    comparedCells,
  };
}
