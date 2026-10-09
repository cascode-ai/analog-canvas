// The graph hash of a netlist (#1560), for deduplicating a Season's Tasks
// and for the record #1524 excludes from its private test split.
//
// The netlist is read as the #1524 grader reads it
// (apps/editor/src/headless/grade.ts): a device–net bipartite graph with
// names ignored and hierarchy flattened, ground one fixed net and supplies
// a class of their own, a device typed by its kind, the ends of R, C, L and
// independent sources interchangeable, MOS drain and source interchangeable.
// Bodies and source polarity are left out, the coarsest reading the grader
// ever makes, so two netlists the grader calls equal always hash alike.
// The grader keeps those rules private; this file restates them and the
// Season build confirms every shared hash with the grader itself.
//
// The hash is colour refinement (1-WL) run until the partition is stable,
// then a digest of the colour multiset: isomorphic graphs always hash
// alike, and different circuits almost never collide.
import { createHash } from "node:crypto";

import { reviewedExternalBindingForMaster } from "@icm/devices";

import { compileSpiceSources } from "../../packages/spice/src/index.ts";

/** Names the algorithm, so a changed reading never matches an old hash. */
const HASH_PREFIX = "wl1:";

const GROUND = /^(?:0|gnd\w*|[ad]gnd\w*|vss\w*|[ad]vss\w*|ground)!?$/iu;
const SUPPLY = /^(?:[ad]?vdd\w*|[ad]?vcc\w*|vee\w*|vpwr)!?$/iu;
const SYMMETRIC = new Set(["resistor", "capacitor", "inductor"]);
const MAX_DEPTH = 64;
const DECLARED_KINDS = {
  nmos: "nmos",
  pmos: "pmos",
  npn: "npn",
  pnp: "pnp",
  d: "diode",
  njf: "njfet",
  pjf: "pjfet",
};

function netClassOf(name) {
  return GROUND.test(name) ? "ground" : SUPPLY.test(name) ? "supply" : "net";
}

function kindByName(name) {
  const lower = name.toLowerCase();
  if (/pfet|pmos|pch/u.test(lower)) return "pmos";
  if (/nfet|nmos|nch/u.test(lower)) return "nmos";
  if (lower.includes("pnp")) return "pnp";
  if (lower.includes("npn")) return "npn";
  return undefined;
}

/** Each terminal's role, or null for a body, which the hash leaves out. */
function roles(type, names, instance, undrawn = new Set()) {
  return instance.terminals.map((terminal) => {
    const name = (names[terminal.position] ?? terminal.name ?? "")
      .toLowerCase()
      .trim();
    if (undrawn.has(terminal.position)) return null;
    if (type === "nmos" || type === "pmos" || type === "mosfet") {
      if (name === "d" || name === "s") return "ds";
      if (name === "b") return null;
    }
    if ((type === "npn" || type === "pnp" || type === "bjt") && name === "s")
      return null;
    if (SYMMETRIC.has(type) || type === "vsource" || type === "isource")
      return "t";
    return name || `p${terminal.position}`;
  });
}

function classify(instance, models) {
  const { target } = instance;
  const typed = (type, names = [], undrawn) => ({
    type,
    roles: roles(type, names, instance, undrawn),
  });
  switch (target.kind) {
    case "primitive": {
      const family = target.family.toLowerCase();
      if (family === "voltage-source") return typed("vsource");
      if (family === "current-source") return typed("isource");
      return typed(family);
    }
    case "model": {
      const model = target.modelName.toLowerCase();
      const declared = DECLARED_KINDS[models.get(model) ?? ""];
      const named = kindByName(model);
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
    case "opaque":
      return typed(`opaque:${target.sourceName.toLowerCase()}`);
    default:
      throw new Error(`Unexpected instance target ${target.kind}`);
  }
}

/** The root Cell's devices with every subcircuit call flattened in. */
function flatten(ir, root) {
  const lower = (name) => name.toLowerCase();
  const cells = new Map(ir.cells.map((cell) => [lower(cell.name), cell]));
  const models = new Map(
    ir.models.map((model) => [lower(model.name), lower(model.modelType)]),
  );
  const devices = [];
  const netClass = new Map();
  const key = (name, local) => {
    const cls = netClassOf(name);
    const id = cls === "ground" ? "ground" : local;
    netClass.set(id, cls);
    return id;
  };
  const expand = (cell, path, ports, depth) => {
    if (depth > MAX_DEPTH)
      throw new Error(`Hierarchy deeper than ${MAX_DEPTH} levels`);
    const nets = new Map();
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
      if (instance.target.kind === "subcircuit") {
        const callee = cells.get(lower(instance.target.cellName));
        if (!callee)
          throw new Error(`Missing subcircuit ${instance.target.cellName}`);
        const bound = new Map();
        for (const terminal of instance.terminals) {
          const port = callee.ports[terminal.position];
          if (port) bound.set(port.netId, nets.get(terminal.netId));
        }
        expand(callee, `${path}/${lower(instance.name)}`, bound, depth + 1);
        continue;
      }
      const device = classify(instance, models);
      devices.push({
        type: device.type,
        pins: instance.terminals.map((terminal, index) => ({
          role: device.roles[index],
          net: nets.get(terminal.netId),
        })),
      });
    }
  };
  const rootCell = cells.get(lower(root));
  if (!rootCell) throw new Error(`Missing root Cell ${root}`);
  expand(rootCell, "", new Map(), 0);
  return { devices, netClass };
}

function rootOf(ir) {
  if (ir.topCells.includes("__flat__")) return "__flat__";
  if (ir.topCells.length === 1) return ir.topCells[0];
  throw new Error(
    ir.topCells.length
      ? `several top Cells (${ir.topCells.join(", ")})`
      : "no devices",
  );
}

const digest = (text, length = 64) =>
  createHash("sha256").update(text).digest("hex").slice(0, length);

/**
 * The graph hash of a SPICE netlist, `wl1:` and 64 hex digits. Throws when
 * the netlist cannot be read as a circuit.
 *
 * @param {string} text
 * @returns {Promise<string>}
 */
export async function netlistGraphHash(text) {
  const result = await compileSpiceSources(
    [{ path: "netlist.cir", bytes: new TextEncoder().encode(text) }],
    "netlist.cir",
  );
  if (!result.ir) throw new Error("The netlist could not be read");
  const circuit = flatten(result.ir, rootOf(result.ir));
  // Devices first, then nets; each edge is labelled by the roles a device
  // has on that net ("ds+ds" for a MOS with drain and source tied).
  const labels = circuit.devices.map((device) => `device:${device.type}`);
  const adjacency = circuit.devices.map(() => []);
  const netIndex = new Map();
  for (const [index, device] of circuit.devices.entries()) {
    const byNet = new Map();
    for (const pin of device.pins) {
      if (pin.role === null) continue;
      byNet.set(pin.net, [...(byNet.get(pin.net) ?? []), pin.role]);
    }
    for (const [net, list] of byNet) {
      let node = netIndex.get(net);
      if (node === undefined) {
        node = labels.length;
        netIndex.set(net, node);
        labels.push(`net:${circuit.netClass.get(net)}`);
        adjacency.push([]);
      }
      const label = list.sort().join("+");
      adjacency[index].push([node, label]);
      adjacency[node].push([index, label]);
    }
  }
  let colours = labels.map((label) => digest(label, 16));
  let classes = new Set(colours).size;
  for (let round = 0; round <= labels.length; round += 1) {
    const next = colours.map((colour, node) =>
      digest(
        `${colour}|${adjacency[node]
          .map(([other, label]) => `${label}:${colours[other]}`)
          .sort()
          .join(",")}`,
        16,
      ),
    );
    const count = new Set(next).size;
    colours = next;
    if (count === classes) break;
    classes = count;
  }
  return `${HASH_PREFIX}${digest([...colours].sort().join("\n"))}`;
}
