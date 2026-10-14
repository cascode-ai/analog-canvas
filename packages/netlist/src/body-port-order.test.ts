import { describe, expect, it } from "vitest";

import { subcircuitDescriptor } from "@icm/devices";
import { createEmptyProject, type CircuitProject } from "@icm/model";

import type { BodyPortOrder, GeneratedBody } from "./body-port-order.js";
import { createDesignNetlistExport } from "./export.js";
import type { NetlistFormat } from "./net-name-codec.js";

/**
 * One block inside Cell `dut`, each signal pin on a Cell Pin named `n_<port>`
 * so that no node shares its body port's name; the supplies meet nothing.
 */
function block(symbolId: string): CircuitProject {
  const project = createEmptyProject(`block-${symbolId}`, symbolId, "dut");
  const document = project.documents[0]!;
  document.netlist!.name = "dut";
  const descriptor = subcircuitDescriptor(symbolId)!;
  document.instances.push({
    id: "block",
    symbolId,
    reference: "X1",
    placement: null,
    netlist: {
      binding: { kind: "unresolved-subcircuit", name: descriptor.target },
      parameters: {},
    },
  });
  for (const port of descriptor.ports.filter((item) => !item.supply)) {
    const id = `pin-${port.name}`;
    const node = `n_${port.name}`;
    document.instances.push({ id, symbolId: "port", placement: null });
    document.nets.push({
      id: node,
      terminals: [
        { instanceId: id, pinName: "P" },
        { instanceId: "block", pinName: port.pinName ?? port.name },
      ],
    });
    document.netlist!.terminals.push({
      id: `terminal-${port.name}`,
      name: node,
      netId: node,
      direction: "inout",
      interfaceInstanceIds: [id],
    });
  }
  return project;
}

/** A transformer inside Cell `dut`, each pin on a Cell Pin. */
function transformer(): CircuitProject {
  const project = createEmptyProject("magnetic", "Magnetic", "dut");
  const document = project.documents[0]!;
  document.netlist!.name = "dut";
  document.instances.push({
    id: "device",
    symbolId: "xfmr",
    placement: null,
    reference: "X7",
    netlist: { parameters: { lp: "1n", ls: "4n", k: "0.8" } },
  });
  for (const [pin, node] of [
    ["P-", "pm"],
    ["P+", "pp"],
    ["S-", "sm"],
    ["S+", "sp"],
  ] as const) {
    document.instances.push({ id: node, symbolId: "port", placement: null });
    document.nets.push({
      id: node,
      terminals: [
        { instanceId: "device", pinName: pin },
        { instanceId: node, pinName: "P" },
      ],
    });
    document.netlist!.terminals.push({
      id: `terminal-${node}`,
      name: node,
      netId: node,
      direction: "inout",
      interfaceInstanceIds: [node],
    });
  }
  return project;
}

/**
 * The order RNL reads these bodies in: an op-amp as its macromodels do, a
 * transformer dotted end first, any other block signals first, supplies last.
 */
const rnlOrder: BodyPortOrder = ({ ports }) => {
  if (ports.includes("p_plus"))
    return ["p_plus", "p_minus", "s_plus", "s_minus"];
  if (ports.includes("VIP") && ports.includes("VOUT"))
    return ["VIP", "VIN", "VDD", "VSS", "VOUT"];
  const supplies: readonly string[] = ports.filter(
    (port) => port === "VDD" || port === "VSS",
  );
  return [...ports.filter((port) => !supplies.includes(port)), ...supplies];
};

function text(
  project: CircuitProject,
  format: NetlistFormat,
  bodyPortOrder?: BodyPortOrder,
): string {
  const result = createDesignNetlistExport(project, {
    format,
    ...(bodyPortOrder ? { bodyPortOrder } : {}),
  });
  expect(result.status, JSON.stringify(result.diagnostics)).toBe("ready");
  return result.status === "ready" ? result.file.text : "";
}

/**
 * What the file connects: each call's node keyed by the port of the body it
 * calls. Two files with equal answers are the same circuit, whatever order
 * their bodies list their ports in.
 */
function connections(file: string, format: NetlistFormat): Map<string, string> {
  const lines = file.split("\n");
  const bodies = new Map<string, string[]>();
  for (const line of lines) {
    const spice = /^\.subckt (\S+) (.*?)(?: params:.*)?$/.exec(line);
    const spectre = /^subckt (\S+) \((.*)\)$/.exec(line);
    const header = format === "spice" ? spice : spectre;
    if (header) bodies.set(header[1]!, header[2]!.split(" "));
  }
  const result = new Map<string, string>();
  for (const line of lines) {
    if (!/^X/.test(line)) continue;
    const tokens = line.replace(/[()]/g, "").split(" ");
    const master = tokens.findIndex(
      (token, index) => index > 0 && bodies.has(token),
    );
    const ports = bodies.get(tokens[master]!)!;
    const nodes = tokens.slice(1, master);
    expect(nodes).toHaveLength(ports.length);
    ports.forEach((port, index) =>
      result.set(`${tokens[0]}:${port}`, nodes[index]!),
    );
  }
  return result;
}

describe("bodies printed in another port order", () => {
  it.each(["spice", "spectre"] as const)(
    "moves an op-amp body and its call together in %s",
    (format) => {
      const project = block("opamp");
      const before = text(project, format);
      const after = text(project, format, rnlOrder);
      expect(before).toContain(
        format === "spice"
          ? "X1 0 0 n_VIP n_VIN n_VOUT opamp"
          : "X1 (0 0 n_VIP n_VIN n_VOUT) opamp",
      );
      expect(after).toContain(
        format === "spice"
          ? "X1 n_VIP n_VIN 0 0 n_VOUT opamp"
          : "X1 (n_VIP n_VIN 0 0 n_VOUT) opamp",
      );
      expect(after).toContain(
        format === "spice"
          ? ".subckt opamp VIP VIN VDD VSS VOUT params:"
          : "subckt opamp (VIP VIN VDD VSS VOUT)",
      );
      expect(connections(after, format)).toEqual(connections(before, format));
    },
  );

  it.each(["spice", "spectre"] as const)(
    "moves a gate's supplies after its signals in %s",
    (format) => {
      const project = block("and-gate");
      const before = text(project, format);
      const after = text(project, format, rnlOrder);
      expect(after).not.toEqual(before);
      // A gate's open supplies become the Cell's own VDD and VSS pins.
      expect(after).toContain(
        format === "spice"
          ? "X1 n_A n_B n_Y VDD VSS and_gate"
          : "X1 (n_A n_B n_Y VDD VSS) and_gate",
      );
      expect(after).toContain(
        format === "spice"
          ? ".subckt and_gate A B Y VDD VSS params:"
          : "subckt and_gate (A B Y VDD VSS)",
      );
      expect(connections(after, format)).toEqual(connections(before, format));
    },
  );

  it.each(["spice", "spectre"] as const)(
    "moves a transformer's dotted ends first in %s",
    (format) => {
      const project = transformer();
      const before = text(project, format);
      const after = text(project, format, rnlOrder);
      expect(after).toContain(
        format === "spice"
          ? ".subckt xfmr p_plus p_minus s_plus s_minus params:"
          : "subckt xfmr (p_plus p_minus s_plus s_minus)",
      );
      expect(after).toContain(
        format === "spice" ? "X7 pp pm sp sm xfmr" : "X7 (pp pm sp sm) xfmr",
      );
      expect(connections(after, format)).toEqual(connections(before, format));
    },
  );

  it("offers only the bodies the netlist writes itself, with their callers", () => {
    const offered: GeneratedBody[] = [];
    text(block("opamp"), "spice", (body) => {
      offered.push(body);
      return null;
    });
    expect(offered).toEqual([
      {
        name: "opamp",
        ports: ["VDD", "VSS", "VIP", "VIN", "VOUT"],
        instanceIds: ["block"],
      },
    ]);
  });

  it.each(["spice", "spectre"] as const)(
    "keeps the file byte for byte when no body moves, in %s",
    (format) => {
      for (const project of [
        block("opamp"),
        block("and-gate"),
        transformer(),
      ]) {
        const before = text(project, format);
        expect(text(project, format, () => null)).toBe(before);
        expect(text(project, format, ({ ports }) => ports)).toBe(before);
      }
    },
  );

  it("refuses an order that is not a reordering of the body's ports", () => {
    expect(() =>
      createDesignNetlistExport(block("opamp"), {
        bodyPortOrder: () => ["VIP", "VIN", "VOUT"],
      }),
    ).toThrow(/not a reordering of opamp's ports/);
    expect(() =>
      createDesignNetlistExport(block("opamp"), {
        bodyPortOrder: () => ["VIP", "VIP", "VDD", "VSS", "VOUT"],
      }),
    ).toThrow(/not a reordering/);
    // A leading part of the ports is not the whole body either.
    expect(() =>
      createDesignNetlistExport(block("opamp"), {
        bodyPortOrder: () => ["VDD", "VSS", "VIP"],
      }),
    ).toThrow(/not a reordering/);
  });

  it("returns the IR it printed only when asked", () => {
    const project = block("opamp");
    const plain = createDesignNetlistExport(project);
    expect(plain.status === "ready" && "ir" in plain).toBe(false);
    const result = createDesignNetlistExport(project, {
      bodyPortOrder: rnlOrder,
      includeIr: true,
    });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    const call = result.ir!.cells[0]!.instances.find(
      (instance) => instance.id === "block",
    )!;
    expect(call.reference).toBe("X1");
    expect(call.nodes.map((node) => node.netName)).toEqual([
      "n_VIP",
      "n_VIN",
      "0",
      "0",
      "n_VOUT",
    ]);
  });
});
