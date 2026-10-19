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
  const path = format === "spice" ? "circuit.sp" : "circuit.scs";
  const found = findBuiltInBodies(text, format, path);
  let source = text;
  if (format === "spectre") {
    const converted = convertNetlist({
      text: found.text,
      source: "spectre",
      target: "spice",
      fragment: true,
      withLineOrigins: true,
    });
    if (converted.status === "blocked")
      throw new Error(JSON.stringify(converted.issues));
    source = converted.text;
    found.bodies = found.bodies.flatMap((body) => {
      const line = converted.lineOrigins?.indexOf(body.source.line) ?? -1;
      return line < 0 ? [] : [{ ...body, source: { path, line: line + 1 } }];
    });
  }
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
      const found = findBuiltInBodies(text, format, "circuit.sp");
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
        expect(
          findBuiltInBodies(text, format, "circuit.sp").bodies,
        ).toHaveLength(1);
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
    expect(findBuiltInBodies(changed, "spice", "circuit.sp").bodies).toEqual(
      [],
    );
    const text = [
      ".subckt opamp VDD VSS VIP VIN VOUT",
      "R1 VIP VOUT 1k",
      ".ends opamp",
      ".subckt dut n_VIP n_VIN n_VOUT",
      "X1 0 0 n_VIP n_VIN n_VOUT opamp",
      ".ends dut",
    ].join("\n");
    expect(findBuiltInBodies(text, "spice", "circuit.sp").bodies).toEqual([]);
    const project = await imported(text, "spice");
    expect(
      project.documents.map((document) => document.netlist?.name).sort(),
    ).toEqual(["dut", "opamp"]);
  });
});

/**
 * Switches in Cell `dut` with a ground: S1 clocked by the phase its label
 * names, S2 by its own name, S3 by its CTRL pin, a chopper clocked by its
 * label and, where `withModel`, S4 closed by a model of the author's own.
 */
function switches(withModel: boolean): CircuitProject {
  const project = createEmptyProject("switches", "Switches", "main");
  const document = project.documents[0]!;
  document.netlist!.name = "dut";
  const port = (id: string, name: string, net: string) => {
    document.instances.push({ id, symbolId: "port", placement: null });
    document.netlist!.terminals.push({
      id: `terminal-${id}`,
      name,
      netId: net,
      direction: "inout",
      interfaceInstanceIds: [id],
    });
    return { instanceId: id, pinName: "P" };
  };
  const part = (id: string, symbolId: string) => ({
    id,
    symbolId,
    reference: id,
    placement: null,
  });
  document.instances.push(
    { id: "GND1", symbolId: "ground", placement: null },
    {
      ...part("C1", "capacitor"),
      // As the conversion from Spectre spells it, so both dialects compare.
      netlist: {
        binding: { kind: "primitive", deviceClass: "capacitor" },
        parameters: { value: "1e-12" },
      },
    },
    part("S1", "simple-switch"),
    part("S2", "ideal-switch"),
    part("S3", "externally-controlled-switch"),
    part("CH1", "chopper"),
    ...(withModel
      ? [
          {
            ...part("S4", "voltage-controlled-switch"),
            netlist: {
              binding: {
                kind: "model" as const,
                deviceClass: "switch" as const,
                name: "mysw",
              },
              parameters: {},
            },
          },
        ]
      : []),
  );
  const on = (pins: [string, string][]) =>
    pins.flatMap(([instanceId, pinName]) =>
      withModel || instanceId !== "S4" ? [{ instanceId, pinName }] : [],
    );
  document.nets.push(
    {
      id: "a",
      terminals: [
        port("PA", "A", "a"),
        ...on([
          ["S1", "1"],
          ["S2", "1"],
          ["S3", "P"],
          ["CH1", "INP"],
          ["S4", "P"],
        ]),
      ],
    },
    {
      id: "b",
      terminals: [
        port("PB", "B", "b"),
        ...on([
          ["S1", "2"],
          ["S2", "2"],
          ["S3", "N"],
          ["CH1", "INN"],
          ["S4", "N"],
          ["C1", "1"],
        ]),
      ],
    },
    {
      id: "c",
      terminals: [
        port("PC", "C", "c"),
        ...on([
          ["S3", "CTRL"],
          ["CH1", "OUTP"],
          ["S4", "CP"],
        ]),
      ],
    },
    {
      id: "d",
      terminals: [
        port("PD", "D", "d"),
        ...on([
          ["CH1", "OUTN"],
          ["S4", "CN"],
        ]),
      ],
    },
    {
      id: "gnd",
      terminals: [
        { instanceId: "GND1", pinName: "0" },
        { instanceId: "C1", pinName: "2" },
      ],
    },
  );
  document.connectivityEvidence.push({
    id: "gnd-claim",
    kind: "name-claim",
    netId: "gnd",
    name: "0",
    scope: "global",
    powerDomain: "ground",
    owner: { kind: "power-marker", objectId: "GND1" },
  });
  for (const [id, text] of [
    ["S1", "Φ1"],
    ["CH1", "Φ2"],
  ] as const)
    document.annotations.push({
      id: `label-${id}`,
      kind: "instance-label",
      content: { runs: [{ kind: "text", value: text }] },
      anchor: {
        kind: "object",
        objectId: id,
        localOffset: { x: 0, y: -20 },
        fallbackPosition: { x: 0, y: 0 },
      },
      alignment: "middle",
      rotation: 0,
      locked: false,
    });
  return project;
}

describe("switches on import", () => {
  it.each(
    (["spice", "spectre"] as const).flatMap((format) =>
      [false, true].map((rootAsTopLevel) => [format, rootAsTopLevel] as const),
    ),
  )(
    "imports Analog Canvas's switches (%s, top level %s) as switches with a CTRL pin, which export as before",
    async (format, rootAsTopLevel) => {
      // Spectre's conversion cannot take an author's own switch model.
      const project = switches(format === "spice");
      const result = createDesignNetlistExport(project, {
        format,
        rootAsTopLevel,
      });
      expect(result.status).toBe("ready");
      const text = result.status === "ready" ? result.file.text : "";
      const back = await imported(text, format);
      const parts = back.documents.flatMap((document) => document.instances);
      const kind = (reference: string) =>
        parts.find((instance) => instance.reference === reference)?.symbolId;
      expect(["S1", "S2", "S3", "CH1"].map(kind)).toEqual([
        "externally-controlled-switch",
        "externally-controlled-switch",
        "externally-controlled-switch",
        "chopper",
      ]);
      if (format === "spice") {
        expect(kind("S4")).toBe("voltage-controlled-switch");
        expect(
          parts.find((instance) => instance.reference === "S4")?.netlist
            ?.binding,
        ).toEqual({ kind: "model", deviceClass: "switch", name: "mysw" });
      }
      const again = createDesignNetlistExport(back, { format, rootAsTopLevel });
      expect(again.status === "ready" && again.file.text).toBe(text);
    },
  );

  it("leaves an author's own ideal_switch model to the switch it closes", async () => {
    const text = [
      ".model ideal_switch SW(RON=2 ROFF=1e12 VT=0.5 VH=0)",
      "S1 a b c 0 ideal_switch",
    ].join("\n");
    expect(findBuiltInBodies(text, "spice", "circuit.sp").bodies).toEqual([]);
    const project = await imported(text, "spice");
    expect(
      project.documents[0]!.instances.find((item) => item.id === "S1"),
    ).toMatchObject({
      symbolId: "voltage-controlled-switch",
      netlist: {
        binding: { kind: "model", deviceClass: "switch", name: "ideal_switch" },
      },
    });
  });
});
