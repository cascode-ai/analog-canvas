import { describe, expect, it } from "vitest";

import {
  builtInSubcircuitDescriptors,
  placedSubcircuitTarget,
  subcircuitDescriptor,
} from "@icm/devices";
import {
  createEmptyDocument,
  createEmptyProject,
  type CircuitProject,
} from "@icm/model";

import { findBuiltInBodies } from "./built-in-bodies.js";
import { createDesignNetlistExport } from "./export.js";
import {
  analyzeDesignNetlist,
  analyzeDesignNetlistForAuthoring,
} from "./extract.js";
import type { NetlistFormat } from "./net-name-codec.js";
import { addOwnSubcircuit } from "./own-subcircuit.test-support.js";
import { printVacaskWithLocations } from "./vacask-printer.js";

/**
 * One unbound Library part X1 inside Cell `dut`, each signal pin on a Cell
 * Pin named `n_<port>`; its supplies meet nothing.
 */
function unboundPart(
  symbolId: string,
  parameters: Record<string, string> = {},
  binding = placedSubcircuitTarget(subcircuitDescriptor(symbolId)!.target),
): CircuitProject {
  const project = createEmptyProject(`part-${symbolId}`, symbolId, "dut");
  const document = project.documents[0]!;
  document.netlist!.name = "dut";
  const descriptor = subcircuitDescriptor(symbolId)!;
  document.instances.push({
    id: "part",
    symbolId,
    reference: "X1",
    placement: null,
    netlist: {
      binding: { kind: "unresolved-subcircuit", name: binding },
      parameters,
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
        { instanceId: "part", pinName: port.pinName ?? port.name },
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

/**
 * The author's own transistor-level Cell `name`, its Pins in `pins` order.
 * With `called`, XOWN calls it, so the netlist prints it.
 */
function addOwnCell(
  project: CircuitProject,
  name: string,
  pins: readonly string[],
  called = true,
) {
  const cell = createEmptyDocument("own", name);
  cell.netlist!.name = name;
  for (const pin of pins) {
    cell.instances.push({
      id: `own-${pin}`,
      symbolId: "port",
      placement: null,
    });
    cell.nets.push({
      id: `own-net-${pin}`,
      terminals: [{ instanceId: `own-${pin}`, pinName: "P" }],
    });
    cell.netlist!.terminals.push({
      id: `own-terminal-${pin}`,
      name: pin,
      netId: `own-net-${pin}`,
      direction: "inout",
      interfaceInstanceIds: [`own-${pin}`],
    });
  }
  cell.instances.push({
    id: "R1",
    reference: "R1",
    symbolId: "resistor",
    placement: null,
    netlist: { parameters: { value: "1k" } },
  });
  cell.nets[0]!.terminals.push({ instanceId: "R1", pinName: "1" });
  cell.nets[1]!.terminals.push({ instanceId: "R1", pinName: "2" });
  project.documents.push(cell);
  if (!called) return;
  const top = project.documents[0]!;
  top.instances.push({
    id: "own-call",
    reference: "XOWN",
    symbolId: "own-symbol",
    placement: null,
    netlist: {
      binding: { kind: "subcircuit", childDocumentId: "own" },
      parameters: {},
    },
  });
  for (const pin of pins)
    top.nets.push({
      id: `call-${pin}`,
      terminals: [{ instanceId: "own-call", pinName: pin }],
    });
}

function exported(project: CircuitProject, format: NetlistFormat = "spice") {
  return createDesignNetlistExport(project, { format, includeIr: true });
}

function text(project: CircuitProject, format: NetlistFormat = "spice") {
  const result = exported(project, format);
  if (result.status !== "ready")
    throw new Error(
      JSON.stringify(
        result.diagnostics.filter((item) => item.severity === "error"),
      ),
    );
  return result.file.text;
}

function errors(project: CircuitProject, format: NetlistFormat = "spice") {
  const result = exported(project, format);
  expect(result.status).toBe("blocked");
  return result.diagnostics.filter((item) => item.severity === "error");
}

/** X1's call in a ready export: the body it names and its nodes. */
function partCall(project: CircuitProject, format: NetlistFormat) {
  const result = exported(project, format);
  if (result.status !== "ready" || !result.ir)
    throw new Error(
      JSON.stringify(
        result.diagnostics.filter((item) => item.severity === "error"),
      ),
    );
  const call = result
    .ir!.cells.flatMap((cell) => cell.instances)
    .find((instance) => instance.id === "part")!;
  const emitted = (name: string) =>
    (result.ir!.generatedDefinitions ?? []).some(
      (definition) => definition.name === name,
    ) ||
    result.ir!.cells.some(
      (cell) => cell.origin === "generated-model" && cell.name === name,
    );
  return {
    target: call.target!,
    nodes: call.nodes.map((node) => node.netName),
    emitted,
    ir: result.ir!,
  };
}

/** One Library part per generated body, its plain drawing. */
const PARTS = [
  ...new Map(
    builtInSubcircuitDescriptors
      .toReversed()
      .map((descriptor) => [descriptor.target, descriptor.symbolId]),
  ).values(),
];

/** Each part's call, unbound beside nothing of its body's name. */
const BASELINES = (["spice", "spectre"] as const).flatMap((format) =>
  PARTS.map((symbolId) => ({
    format,
    symbolId,
    target: partCall(unboundPart(symbolId), format).target,
  })),
);

/**
 * The calls that have no other name: a body already reserved (the ideal
 * comparators' VDD bodies, the default), and in Spectre the call-only calls,
 * whose names are the reader's interface.
 */
const NO_OTHER_NAME = [
  ["spice", "icm_ideal_comparator_vdd"],
  ["spice", "icm_ideal_comparator_differential_vdd"],
  ["spectre", "icm_ideal_comparator_vdd"],
  ["spectre", "icm_ideal_comparator_differential_vdd"],
  ["spectre", "d_flip_flop"],
  ["spectre", "d_flip_flop_q"],
  ["spectre", "d_flip_flop_reset"],
  ["spectre", "multiplier"],
  ["spectre", "adc"],
  ["spectre", "dac"],
] as const;
const hasNoOtherName = ({ format, target }: (typeof BASELINES)[number]) =>
  NO_OTHER_NAME.some((entry) => entry[0] === format && entry[1] === target);

/** A part's ports, in the reverse of its body's order. */
const reversedPorts = (symbolId: string) =>
  subcircuitDescriptor(symbolId)!
    .ports.map((port) => port.name)
    .reverse();

describe("a Library part never calls an author's definition because of its name (#1928)", () => {
  it("keeps an unbound inverter on its body, written as icm_inverter, beside the author's own inverter subcircuit", () => {
    const project = unboundPart("inverter");
    addOwnSubcircuit(project, "inverter", ["Y", "A", "VSS", "VDD"]);
    const spice = text(project);
    expect(spice).toMatch(/^X1 VDD VSS n_A n_Y icm_inverter$/mu);
    expect(spice).toMatch(/^\.subckt icm_inverter VDD VSS A Y /mu);
    expect(spice).not.toMatch(/^X1 .* inverter$/mu);
  });

  it("keeps an unbound op-amp on its ideal body beside a Cell named opamp (#1888)", () => {
    // Unpowered, it calls the body named opamp, its limits at ±5 V.
    const project = unboundPart("opamp", { gain: "1e6" });
    const before = partCall(project, "spice");
    expect(before.target).toBe("opamp");
    addOwnCell(project, "opamp", ["OUT", "IN-", "IN+", "VSS", "VDD"]);
    const after = partCall(project, "spice");
    expect(after.target).toBe("icm_opamp");
    expect(after.nodes).toEqual(before.nodes);
    const spice = text(project);
    expect(spice).toMatch(/^\.subckt icm_opamp VDD VSS VIP VIN VOUT /mu);
    // A design netlist states a Cell's supplies first.
    expect(spice).toMatch(/^\.subckt opamp VDD VSS OUT IN- IN\+$/mu);
    expect(spice).toMatch(/^XOWN .* opamp$/mu);
  });

  it("has a name to yield for every body but the reserved and call-only ones", () => {
    expect(BASELINES.filter(hasNoOtherName)).toHaveLength(NO_OTHER_NAME.length);
  });

  for (const author of ["Cell", "external subcircuit"] as const)
    it.each(BASELINES.filter((baseline) => !hasNoOtherName(baseline)))(
      `writes $symbolId's body $target as icm_$target beside the author's ${author} of that name, in $format`,
      ({ format, symbolId, target }) => {
        const project = unboundPart(symbolId);
        const before = partCall(project, format);
        if (author === "Cell")
          addOwnCell(project, target, reversedPorts(symbolId));
        else addOwnSubcircuit(project, target, reversedPorts(symbolId));
        const after = partCall(project, format);
        expect(after.target).toBe(`icm_${target}`);
        expect(after.emitted(`icm_${target}`)).toBe(true);
        expect(after.nodes).toEqual(before.nodes);
        if (author === "Cell")
          expect(
            after.ir.cells.some((cell) => !cell.origin && cell.name === target),
          ).toBe(true);
      },
    );

  it.each(BASELINES.filter(hasNoOtherName))(
    "refuses $symbolId's $target beside a Cell of that name the netlist prints, in $format",
    ({ format, symbolId, target }) => {
      const project = unboundPart(symbolId);
      addOwnCell(project, target, reversedPorts(symbolId));
      expect(errors(project, format).map((item) => item.code)).toContain(
        "LIBRARY_PART_NAME_COLLISION",
      );
    },
  );

  it("refuses a Spectre call-only part beside a Cell of its name the netlist prints, and says to bind it", () => {
    const project = unboundPart("d-flip-flop");
    addOwnCell(project, "d_flip_flop", ["QBAR", "Q", "CK", "D", "VSS", "VDD"]);
    expect(
      errors(project, "spectre").find(
        (item) => item.code === "LIBRARY_PART_NAME_COLLISION",
      )?.message,
    ).toBe(
      "X1 calls d_flip_flop, which a Spectre export leaves to your libraries, but Cell d_flip_flop of this Project has that name: bind X1 to it with set-model (its Pins by name), or rename it",
    );
    // SPICE writes the flip-flop's body itself, under the name that yields.
    expect(partCall(project, "spice").target).toBe("icm_d_flip_flop");
  });

  it("leaves a Spectre call-only call to your libraries where the Project's definition of its name is not in the netlist", () => {
    for (const add of [
      (project: CircuitProject) =>
        addOwnCell(project, "d_flip_flop", ["D", "Q"], false),
      (project: CircuitProject) =>
        addOwnSubcircuit(project, "d_flip_flop", ["D", "Q"]),
    ]) {
      const project = unboundPart("d-flip-flop");
      add(project);
      const result = exported(project, "spectre");
      expect(result.status).toBe("ready");
      expect(result.diagnostics.map((item) => item.code)).toContain(
        "SPECTRE_MODEL_NOT_INCLUDED",
      );
      expect(partCall(project, "spectre").target).toBe("d_flip_flop");
    }
  });

  it("refuses when the author's definitions take both the body's name and its reserved one", () => {
    const project = unboundPart("inverter");
    addOwnSubcircuit(project, "inverter", ["A", "Y"]);
    addOwnSubcircuit(project, "icm_inverter", ["A", "Y"]);
    expect(
      errors(project).find(
        (item) => item.code === "LIBRARY_PART_NAME_COLLISION",
      )?.message,
    ).toBe(
      "X1's generated inverter body is written as icm_inverter where external subcircuit inverter of this Project has its name, but external subcircuit icm_inverter has that one too; rename one of them",
    );
  });

  it("yields a name a Cell the root does not reach still takes, so every root of the Project writes the same body", () => {
    const project = unboundPart("inverter");
    addOwnCell(project, "inverter", ["A", "Y"], false);
    expect(partCall(project, "spice").target).toBe("icm_inverter");
  });

  it.each(["inverter", "opamp", "adder", "crystal"])(
    "writes %s's yielding body under its reserved name in VACASK and in the authoring analysis",
    (symbolId) => {
      const project = unboundPart(symbolId);
      const plain = partCall(project, "spice").target;
      addOwnCell(project, plain, reversedPorts(symbolId));
      for (const analysis of [
        analyzeDesignNetlist(project),
        analyzeDesignNetlistForAuthoring(project),
      ])
        expect(
          analysis
            .ir!.cells.flatMap((cell) => cell.instances)
            .find((call) => call.id === "part")?.target,
        ).toBe(`icm_${plain}`);
      const printed = printVacaskWithLocations(
        analyzeDesignNetlist(project).ir!,
      );
      expect(printed.ok).toBe(true);
      if (!printed.ok) return;
      expect(printed.text).toMatch(new RegExp(`^subckt icm_${plain} `, "mu"));
      expect(printed.text).toMatch(new RegExp(`\\) icm_${plain}\\b`, "u"));
    },
  );
});

describe("a Library part retargeted to another name (#1928)", () => {
  it("reaches the Project's definition of that name by Pin name, as an older comparator does", () => {
    const project = unboundPart("comparator", {}, "comparator");
    addOwnSubcircuit(project, "comparator", [
      "OUT",
      "VSS",
      "IN-",
      "VDD",
      "IN+",
    ]);
    // OUT, VSS, IN-, VDD and IN+ take n_VOUT, ground, n_VIN, the default
    // supply and n_VIP.
    expect(text(project)).toMatch(
      /^X1 n_VOUT VSS n_VIN VDD n_VIP comparator$/mu,
    );
  });

  it("refuses the Project's definition when its ports are not the part's own pins", () => {
    const project = unboundPart("comparator", {}, "comparator");
    addOwnSubcircuit(project, "comparator", [
      "VDD",
      "VSS",
      "VIP",
      "VIN",
      "VOUT",
    ]);
    expect(
      errors(project).find((item) => item.code === "GATE_CELL_PIN_MISMATCH")
        ?.message,
    ).toContain(
      "External subcircuit comparator does not fit the comparator: it has no Pins IN+, IN- and OUT",
    );
  });

  it("still calls a name the Project does not define, in the part's port order", () => {
    const project = unboundPart("inverter", {}, "my_inv");
    expect(text(project)).toMatch(/^X1 VDD VSS n_A n_Y my_inv$/mu);
  });

  it("refuses a name only a model source defines, rather than call it by position", () => {
    const project = unboundPart("inverter", {}, "my_inv");
    project.modelSources = [
      {
        id: "lib",
        language: "spice",
        revision: 1,
        entry: "lib.spice",
        dependencies: [],
        files: [
          {
            path: "lib.spice",
            text: ".subckt my_inv Y A VSS VDD\nR1 A Y 1k\n.ends my_inv\n",
          },
        ],
      },
    ];
    expect(
      errors(project).find(
        (item) => item.code === "LIBRARY_PART_NAME_COLLISION",
      )?.message,
    ).toBe(
      "X1 names my_inv, which model-source subcircuit my_inv of this Project defines without declaring its ports: bind X1 with set-model to a subcircuit whose ports are named (its Pins by name), or rename one of them",
    );
  });
});

describe("a body that yields its name (#1928)", () => {
  it("yields to a subcircuit of the Project's model sources, as to an external definition", () => {
    const project = unboundPart("inverter");
    project.modelSources = [
      {
        id: "lib",
        language: "spice",
        revision: 1,
        entry: "lib.spice",
        dependencies: [],
        files: [
          {
            path: "lib.spice",
            text: ".subckt inverter A Y\nR1 A Y 1k\n.ends inverter\n",
          },
        ],
      },
    ];
    expect(partCall(project, "spice").target).toBe("icm_inverter");
  });

  it.each([
    ["spice", ["inverter", "voltage-amplifier", "dac"]],
    ["spectre", ["inverter", "voltage-amplifier"]],
  ] as const)(
    "reads back from %s as the part that wrote it",
    (format, parts) => {
      for (const symbolId of parts) {
        const project = unboundPart(symbolId);
        const plain = partCall(project, format).target;
        addOwnCell(project, plain, ["A", "Y"]);
        const found = findBuiltInBodies(
          text(project, format),
          format,
          "dut.sp",
        ).bodies.find((body) => body.name.toLowerCase() === `icm_${plain}`);
        expect(found, `${symbolId} ${format}`).toMatchObject({
          kind: "subcircuit",
          symbolId,
        });
      }
    },
  );
});
