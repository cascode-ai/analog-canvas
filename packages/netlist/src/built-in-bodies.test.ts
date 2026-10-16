import { describe, expect, it } from "vitest";

import {
  IDEAL_COMPARATOR_TARGET,
  builtInSubcircuitDescriptors,
  subcircuitDescriptor,
} from "@icm/devices";
import { createEmptyProject, type CircuitProject } from "@icm/model";
import { convertNetlist, importSpiceSources } from "@icm/spice";

import type { BodyPortOrder } from "./body-port-order.js";
import { findBuiltInBodies } from "./built-in-bodies.js";
import { createDesignNetlistExport } from "./export.js";
import type { NetlistFormat } from "./net-name-codec.js";

/**
 * One block inside Cell `dut`, bound as a placed block is, each signal pin
 * on a Cell Pin named `n_<port>`; each of `supplies` is bound to a Cell Pin
 * of its own the same way, and any other supply to nothing.
 */
function block(
  symbolId: string,
  parameters: Record<string, string> = {},
  supplies: readonly ("VDD" | "VSS")[] = [],
): CircuitProject {
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
      binding: {
        kind: "unresolved-subcircuit",
        name:
          descriptor.target === "comparator"
            ? IDEAL_COMPARATOR_TARGET
            : descriptor.target,
      },
      parameters,
    },
  });
  for (const port of descriptor.ports) {
    const pinName = port.pinName ?? port.supply;
    if (port.supply && !supplies.includes(port.supply)) continue;
    const id = `pin-${port.name}`;
    const node = `n_${port.name}`;
    document.instances.push({ id, symbolId: "port", placement: null });
    document.nets.push({
      id: node,
      terminals: [
        { instanceId: id, pinName: "P" },
        { instanceId: "block", pinName },
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

function exported(
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

/** A file as the SPICE / SCS import brings it in, its built-in bodies found. */
async function imported(
  text: string,
  format: NetlistFormat,
): Promise<CircuitProject> {
  const found = findBuiltInBodies(text, format);
  let source = text;
  if (format === "spectre") {
    const converted = convertNetlist({
      text: found.text,
      source: "spectre",
      target: "spice",
      fragment: true,
    });
    if (converted.status === "blocked")
      throw new Error(JSON.stringify(converted.issues));
    source = converted.text;
  }
  const path = format === "spice" ? "circuit.sp" : "circuit.scs";
  const result = await importSpiceSources(
    [{ path, bytes: new TextEncoder().encode(source) }],
    path,
    {},
    { builtInBodies: found.bodies },
  );
  expect(result.successful, JSON.stringify(result.diagnostics)).toBe(true);
  return result.project!;
}

/** The block a project imported from `dut` holds. */
const importedBlock = (project: CircuitProject) =>
  project.documents
    .find((document) => document.netlist?.name === "dut")!
    .instances.find((instance) => instance.reference === "X1")!;

/** The order RNL reads bodies in: an op-amp as its macromodels do. */
const rnlOrder: BodyPortOrder = ({ ports }) =>
  ports.includes("VIP") && ports.includes("VOUT")
    ? ["VIP", "VIN", "VDD", "VSS", "VOUT"]
    : [
        ...ports.filter((port) => port !== "VDD" && port !== "VSS"),
        ...ports.filter((port) => port === "VDD" || port === "VSS"),
      ];

/** Each built-in target once, drawn with its first Symbol. */
const blocks = builtInSubcircuitDescriptors.filter(
  (descriptor, index, all) =>
    all.findIndex((other) => other.target === descriptor.target) === index,
);

describe("built-in bodies on import", () => {
  it.each(
    blocks.flatMap((descriptor) =>
      (["spice", "spectre"] as const).map(
        (format) => [descriptor.symbolId, format] as const,
      ),
    ),
  )(
    "imports a call of %s's body (%s) as the block, which exports as before",
    async (symbolId, format) => {
      const text = exported(block(symbolId), format);
      const call = /^X1 .*?(\S+)$/mu.exec(text.replace(/[()]/gu, ""))![1]!;
      const printed = new RegExp(`^\\.?subckt ${call}\\b`, "mu").test(text);
      const found = findBuiltInBodies(text, format);
      expect(found.bodies.map((body) => body.name)).toEqual(
        printed ? [call] : [],
      );
      // A Spectre export leaves some bodies to the reader's libraries.
      if (!printed) return;
      expect(found.text.split("\n")).toHaveLength(text.split("\n").length);
      const project = await imported(text, format);
      expect(
        project.documents.map((document) => document.netlist?.name),
      ).toEqual(["dut"]);
      expect(importedBlock(project).symbolId).toBe(symbolId);
      expect(exported(project, format)).toBe(text);
    },
  );

  it.each([
    ["icm_opamp_vdd_vss", {}, ["VDD", "VSS"]],
    ["icm_opamp_vss", { vhigh: "2" }, ["VDD", "VSS"]],
    ["icm_opamp_vdd", { vlow: "-2" }, ["VDD"]],
    ["opamp", { vhigh: "2", vlow: "-2" }, ["VDD", "VSS"]],
  ] as const)(
    "brings an op-amp calling %s back to that body",
    async (body, parameters, supplies) => {
      for (const format of ["spice", "spectre"] as const) {
        const text = exported(block("opamp", parameters, supplies), format);
        expect(text).toMatch(new RegExp(`^X1 .*\\b${body}( |$)`, "mu"));
        expect(exported(await imported(text, format), format)).toBe(text);
      }
    },
  );

  it.each([
    ["icm_ideal_comparator_vdd", {}, ["VDD"]],
    ["icm_ideal_comparator", { vhigh: "1" }, []],
  ] as const)(
    "brings a comparator calling %s back to that body",
    async (body, parameters, supplies) => {
      for (const format of ["spice", "spectre"] as const) {
        const text = exported(
          block("comparator", parameters, supplies),
          format,
        );
        expect(text).toMatch(new RegExp(`^X1 .*\\b${body}( |$)`, "mu"));
        const project = await imported(text, format);
        expect(importedBlock(project).netlist?.binding).toEqual({
          kind: "unresolved-subcircuit",
          name: IDEAL_COMPARATOR_TARGET,
        });
        expect(exported(project, format)).toBe(text);
      }
    },
  );

  it.each([
    ["adder_minus_a", { signA: "-" }],
    ["adder_minus_b", { signB: "-" }],
    ["adder_minus_ab", { signA: "-", signB: "-" }],
  ] as const)(
    "gives an adder calling %s the signs its body applies",
    async (body, signs) => {
      for (const format of ["spice", "spectre"] as const) {
        const text = exported(block("adder", signs), format);
        expect(text).toMatch(new RegExp(`^X1 .*\\b${body}$`, "mu"));
        const project = await imported(text, format);
        expect(importedBlock(project).netlist?.parameters).toEqual(signs);
        expect(exported(project, format)).toBe(text);
      }
    },
  );

  it.each(["spice", "spectre"] as const)(
    "finds bodies printed in RNL's port order (%s)",
    async (format) => {
      for (const project of [
        block("opamp", {}, ["VDD", "VSS"]),
        block("and-gate"),
        block("voltage-amplifier"),
      ]) {
        const text = exported(project, format, rnlOrder);
        expect(findBuiltInBodies(text, format).bodies).toHaveLength(1);
        expect(exported(await imported(text, format), format, rnlOrder)).toBe(
          text,
        );
      }
    },
  );

  it("leaves an author's subcircuit of a body's name as a Cell", async () => {
    const changed = exported(block("opamp"), "spice").replace(
      "params: gain=1e6",
      "params: gain=1e5",
    );
    expect(findBuiltInBodies(changed, "spice").bodies).toEqual([]);
    const text = [
      ".subckt opamp VDD VSS VIP VIN VOUT",
      "R1 VIP VOUT 1k",
      ".ends opamp",
      ".subckt dut n_VIP n_VIN n_VOUT",
      "X1 0 0 n_VIP n_VIN n_VOUT opamp",
      ".ends dut",
    ].join("\n");
    expect(findBuiltInBodies(text, "spice").bodies).toEqual([]);
    const project = await imported(text, "spice");
    expect(
      project.documents.map((document) => document.netlist?.name).sort(),
    ).toEqual(["dut", "opamp"]);
  });
});
