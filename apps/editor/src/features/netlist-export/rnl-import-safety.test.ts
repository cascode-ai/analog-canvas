import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, expect, it } from "vitest";
import type { CircuitProject } from "@icm/model";
import { createDesignNetlistExport } from "@icm/netlist";
import { rnlBodyPortOrder, type RnlSnapshot } from "@icm/rnl";
import { importSpiceSources } from "@icm/spice";
import { parseProject, serializeProject } from "@icm/project-protocol";
import { prepareImportSources } from "./convert-import-sources";
import { createRnlTestCore } from "./rnl-core.test-support";
import { drawnProject, planRnlImport, writesFileNetlist } from "./rnl-import";
import type { RnlRuntime } from "./rnl-runtime";

const core = await createRnlTestCore();
afterAll(() => core.terminate());
const runtime: RnlRuntime = core;

it("keeps the circuit and the drawing, and leaves out a wire that joins nets the netlist keeps apart", async () => {
  const path = "reset-chain.scs";
  const plan = await planRnlImport({
    inputs: [
      {
        path,
        bytes: readFileSync("netlists/rnl-invalid-drawing/reset-chain.scs"),
      },
    ],
    entryPath: path,
    runtime,
  });
  if (plan.status !== "ready") throw new Error(plan.message);
  expect(plan.drawing).toBe("partial");
  // RNL's own finding, at the line that writes the wire, and the wire left out.
  expect(plan.diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: "RNL_IMPORT_RNL_FINDING",
        message: expect.stringMatching(
          /^RNL reset-chain\.scs:16:4 RNL4204 wire-net-mismatch: /u,
        ),
      }),
      expect.objectContaining({
        code: "RNL_IMPORT_WIRE_WRONG_NET",
        message: expect.stringContaining("@reset-chain.scs:16:4"),
      }),
    ]),
  );
  expect(plan.diagnostics.map((item) => item.code)).not.toContain(
    "RNL_IMPORT_INVALID_DRAWING",
  );
  // The parts stand where RNL puts them, the wire is out, and the editor can
  // save the Project.
  const [document] = plan.project.documents;
  const flipFlops = document!.instances.filter(
    (instance) => instance.symbolId === "d-flip-flop-reset",
  );
  expect(flipFlops).toHaveLength(2);
  expect(flipFlops.every((instance) => instance.placement)).toBe(true);
  expect(document!.routes).toEqual([]);
  expect(() => serializeProject(plan.project)).not.toThrow();
  // The subcircuit keeps every port, its supplies included, where the
  // drawing shows them as the blocks' supplies rather than as Cell Pins.
  const written = createDesignNetlistExport(plan.project, {
    format: "spectre",
  });
  if (written.status !== "ready") throw new Error("export blocked");
  expect(written.file.text).toMatch(
    /subckt dut \(?VDD VSS D1 CLK RESET Q1 QB1 D2 Q2 QB2\)?/iu,
  );
});

it("keeps the circuit undrawn when the drawing step cannot read the runtime's answer", async () => {
  const plan = await planRnlImport({
    inputs: [
      {
        path: "cell.sp",
        bytes: new TextEncoder().encode(
          "* cell\n.subckt cell A\nR1 A 0 1k\n.ends cell\n",
        ),
      },
    ],
    entryPath: "cell.sp",
    runtime: {
      ...runtime,
      snapshot: async (request) => ({
        ...(await runtime.snapshot(request)),
        diagnostics: null as unknown as RnlSnapshot["diagnostics"],
      }),
    },
  });
  if (plan.status !== "ready") throw new Error(plan.message);
  expect(plan.diagnostics).toEqual([
    expect.objectContaining({
      code: "RNL_IMPORT_INVALID_DRAWING",
      severity: "error",
    }),
  ]);
  expect(() => serializeProject(plan.project)).not.toThrow();
  expect(
    plan.project.documents[0]!.netlist!.terminals.map((port) => port.name),
  ).toEqual(["A"]);
});

it("returns a failed plan with its finding when the runtime fails", async () => {
  const plan = await planRnlImport({
    inputs: [
      {
        path: "cell.sp",
        bytes: new TextEncoder().encode(
          "* cell\n.subckt cell A\nR1 A 0 1k\n.ends cell\n",
        ),
      },
    ],
    entryPath: "cell.sp",
    runtime: {
      ...runtime,
      snapshot: async () => {
        throw new Error("runtime worker unavailable");
      },
    },
  });
  expect(plan).toMatchObject({
    status: "failed",
    diagnostics: [
      {
        code: "RNL_IMPORT_FAILED",
        severity: "error",
        stage: "import",
        message: "runtime worker unavailable",
      },
    ],
  });
});

/** A Project's netlist as the RNL export writes it, as the one input file. */
async function asFile(project: CircuitProject) {
  const written = createDesignNetlistExport(project, {
    format: "spice",
    bodyPortOrder: rnlBodyPortOrder(project),
  });
  if (written.status !== "ready") throw new Error("export blocked");
  const inputs = [
    { path: "circuit.sp", bytes: new TextEncoder().encode(written.file.text) },
  ];
  const prepared = prepareImportSources(inputs);
  const imported = await importSpiceSources(
    prepared.inputs,
    "circuit.sp",
    {},
    {
      namingProfile: "native",
      originalSources: inputs,
      builtInBodies: prepared.builtInBodies,
    },
  );
  return { inputs, imported: imported.project! };
}

const example = () =>
  parseProject(
    readFileSync(
      resolve(import.meta.dirname, "../../examples/simulation-rc.icproj.json"),
      "utf8",
    ),
  );

/** The same circuit with one value changed. */
function changed(project: CircuitProject): CircuitProject {
  const next = structuredClone(project);
  const part = next.documents
    .flatMap((document) => document.instances)
    .find((instance) => instance.netlist?.parameters.value !== undefined)!;
  part.netlist!.parameters.value = "123";
  return next;
}

it("takes the file's own netlist as the reference only where the drawn circuit writes it", async () => {
  const project = example();
  const { inputs, imported } = await asFile(project);
  expect(await writesFileNetlist(project, imported, inputs, "circuit.sp")).toBe(
    true,
  );
  expect(
    await writesFileNetlist(changed(project), imported, inputs, "circuit.sp"),
  ).toBe(false);
});

it("keeps a drawing the imported circuit disagrees with only when it writes the file's netlist", async () => {
  const project = example();
  // The reference read otherwise than the drawing, as a netlist-only import
  // can read an Analog Canvas file (a ground pin named VSS read as a port).
  const reference = changed(project);
  const drawn = {
    project,
    diagnostics: [],
    hiddenLabels: [],
    parameterTexts: [],
    powerLabelPorts: [],
  } as unknown as Parameters<typeof drawnProject>[1];
  const kept = await drawnProject(reference, drawn, () =>
    Promise.resolve(true),
  );
  expect("project" in kept).toBe(true);
  const refused = await drawnProject(reference, drawn, () =>
    Promise.resolve(false),
  );
  expect(refused).toMatchObject({ code: "RNL_IMPORT_CHANGES_NETLIST" });
});

/** #1932's probe: a switch whose name label is its clock phase. */
function clockProbe(name: string, params = "") {
  return [
    "* clock safety probe",
    '* @RNL(type="header") { @VERSION("0.4"); @USE-PACKAGE(name="rnl-std-style", version="0.4"); @USE-PACKAGE(name="rnl-std-basic", version="0.4")}',
    `.subckt dut a b clk wrong VSS${params}`,
    "S1 a b clk VSS ideal_switch",
    ".model ideal_switch SW(RON=1 ROFF=1e12 VT=0.5 VH=0)",
    '* @RNL(author="analog-canvas") {',
    '*   #S1 @SET-SYMBOL $SWITCH => @PLACE(0, 0) => @ORIENT("R0");',
    `*   #S1 @TEXT("${name}", key="name", dx=0, dy=2, halign="middle", size=0.5)`,
    "* }",
    ".ends dut",
    "",
  ].join("\n");
}

/** A flat circuit past the comparison's size limit, with the same switch. */
function largeProbe(...drawing: string[]) {
  return [
    "* large clock probe",
    '* @RNL(type="header") { @VERSION("0.4"); @USE-PACKAGE(name="rnl-std-style", version="0.4"); @USE-PACKAGE(name="rnl-std-basic", version="0.4")}',
    ...Array.from(
      { length: 1200 },
      (_, index) => `R${index + 1} n${index} 0 1k`,
    ),
    "S1 a b clk VSS ideal_switch",
    ".model ideal_switch SW(RON=1 ROFF=1e12 VT=0.5 VH=0)",
    '* @RNL(author="analog-canvas") {',
    ...drawing.map((line) => `*   ${line}`),
    "* }",
    ".end",
    "",
  ].join("\n");
}

async function importText(text: string) {
  const path = "probe.sp";
  const plan = await planRnlImport({
    inputs: [{ path, bytes: new TextEncoder().encode(text) }],
    entryPath: path,
    runtime,
  });
  if (plan.status !== "ready") throw new Error(plan.message);
  const written = createDesignNetlistExport(plan.project, { format: "spice" });
  if (written.status !== "ready") throw new Error("export failed");
  return {
    errors: plan.diagnostics.filter((item) => item.severity === "error"),
    card: written.file.text
      .split("\n")
      .map((line) => line.trim())
      .find((line) => /^S1 /i.test(line)),
  };
}

it("leaves out a drawing that changes a parameterized circuit, or one past the comparison's size limit", async () => {
  const parameterized = await importText(clockProbe("wrong", " params: p=1"));
  expect(parameterized.errors).toEqual([
    expect.objectContaining({
      code: "RNL_IMPORT_CHANGES_NETLIST",
      message:
        "The RNL drawing would change the netlist, so the circuit comes in undrawn",
    }),
  ]);
  expect(parameterized.card).toBe("S1 a b clk VSS ideal_switch");
  const large = await importText(
    largeProbe(
      '#S1 @SET-SYMBOL $SWITCH => @PLACE(0, 0) => @ORIENT("R0");',
      '#S1 @TEXT("wrong", key="name", dx=0, dy=2, halign="middle", size=0.5)',
    ),
  );
  expect(large.errors).toEqual([
    expect.objectContaining({
      code: "RNL_IMPORT_CHANGES_NETLIST",
      message: expect.stringContaining("size limit"),
    }),
  ]);
  expect(large.card).toBe("S1 a b clk VSS ideal_switch");
  // Without its parameter, the same drawing is refused as before.
  const plain = await importText(clockProbe("wrong"));
  expect(plain.errors).toEqual([
    expect.objectContaining({
      code: "RNL_IMPORT_CHANGES_NETLIST",
      message:
        "The RNL drawing would change the netlist, so the circuit comes in undrawn",
    }),
  ]);
  expect(plain.card).toBe("S1 a b clk VSS ideal_switch");
}, 60_000);

it("keeps a drawing of a parameterized circuit, or one past the comparison's size limit, that keeps its netlist", async () => {
  for (const text of [
    clockProbe("clk", " params: p=1"),
    largeProbe('#R1 @SET-SYMBOL $RESISTOR => @PLACE(0, 0) => @ORIENT("R0");'),
  ]) {
    const kept = await importText(text);
    expect(kept.errors).toEqual([]);
    expect(kept.card).toBe("S1 a b clk VSS ideal_switch");
  }
}, 60_000);

/**
 * #1954's probe: a top main, and a Cell dut no Cell calls, whose switch is
 * labelled `name` by the drawing; `dutIsTop` leaves main out.
 */
function uncalledProbe(name: string, dutIsTop = false) {
  return [
    "* uncalled safety probe",
    '* @RNL(type="header") {',
    '*   @VERSION("0.4");',
    '*   @USE-PACKAGE(name="rnl-std-basic", version="0.4");',
    '*   @USE-PACKAGE(name="analog-canvas-extensions", version="0.7")',
    "* }",
    ...(dutIsTop
      ? []
      : [
          ".subckt main a b",
          "R2 a b 2k",
          '* @RNL(author="analog-canvas") {',
          '*   #R2 @SET-SYMBOL $RESISTOR => @PLACE(0, 0) => @ORIENT("R0");',
          "*   $CANVAS_TOP @ATTACH #(level)",
          "* }",
          ".ends main",
        ]),
    ".subckt dut a b clk wrong VSS",
    "S1 a b clk VSS ideal_switch",
    ".model ideal_switch SW(RON=1 ROFF=1e12 VT=0.5 VH=0)",
    '* @RNL(author="analog-canvas") {',
    '*   #S1 @SET-SYMBOL $SWITCH => @PLACE(0, 0) => @ORIENT("R0");',
    `*   #S1 @TEXT("${name}", key="name", dx=0, dy=2, halign="middle", size=0.5)`,
    "* }",
    ".ends dut",
    "",
  ].join("\n");
}

/** The import's error findings and dut's switch as the export prints it. */
async function importUncalled(text: string) {
  const path = "probe.sp";
  const plan = await planRnlImport({
    inputs: [{ path, bytes: new TextEncoder().encode(text) }],
    entryPath: path,
    runtime,
  });
  if (plan.status !== "ready") throw new Error(plan.message);
  const written = createDesignNetlistExport(plan.project, {
    format: "spice",
    uncalledCells: true,
  });
  if (written.status !== "ready") throw new Error("export failed");
  return {
    errors: plan.diagnostics.filter((item) => item.severity === "error"),
    card: written.file.text
      .split("\n")
      .map((line) => line.trim())
      .find((line) => /^S1 /iu.test(line)),
    instances: plan.project.documents.flatMap((document) => document.instances),
  };
}

it("leaves out a drawing that changes a Cell the top does not call (#1954)", async () => {
  for (const dutIsTop of [false, true]) {
    const refused = await importUncalled(uncalledProbe("wrong", dutIsTop));
    expect(refused.errors).toEqual([
      expect.objectContaining({ code: "RNL_IMPORT_CHANGES_NETLIST" }),
    ]);
    expect(refused.card).toBe("S1 a b clk VSS ideal_switch");
  }
});

it("keeps a drawing of a Cell the top does not call that keeps its netlist (#1954)", async () => {
  const kept = await importUncalled(uncalledProbe("clk"));
  expect(kept.errors).toEqual([]);
  expect(kept.card).toBe("S1 a b clk VSS ideal_switch");
  // Drawn: the switch stands where the file places it.
  expect(
    kept.instances.find((instance) => instance.reference === "S1")?.placement
      ?.position,
  ).toEqual({ x: 0, y: 0 });
});

it("imports a file of another RNL version as its circuit without its drawing, and reads a netlist with no records", async () => {
  const text = (header: string) =>
    [
      "* version probe",
      header,
      "R1 a 0 1k",
      "V1 a 0 1",
      '* @RNL { #R1 @SET-SYMBOL $RESISTOR => @PLACE(0, 0) => @ORIENT("R0") }',
      ".end",
      "",
    ].join("\n");
  const plan = (source: string) =>
    planRnlImport({
      inputs: [{ path: "top.sp", bytes: new TextEncoder().encode(source) }],
      entryPath: "top.sp",
      runtime,
    });
  const older = await plan(text('* @RNL(type="header") { @VERSION("0.3") }'));
  if (older.status !== "ready") throw new Error(older.message);
  // The circuit comes in, undrawn, and the report says how to raise the file.
  expect(older.drawing).toBe("discarded");
  expect(older.diagnostics).toEqual([
    expect.objectContaining({
      code: "RNL_IMPORT_VERSION",
      severity: "error",
      message: expect.stringMatching(/`rnl upgrade` \(rnl 0\.6\.0 or later\)/u),
    }),
  ]);
  const [document] = older.project.documents;
  expect(document!.instances.map((item) => item.id)).toEqual(
    expect.arrayContaining(["R1", "V1"]),
  );
  expect(document!.routes).toEqual([]);
  expect(() => serializeProject(older.project)).not.toThrow();
  const read = await plan(
    text(
      '* @RNL(type="header") { @VERSION("0.4"); @USE-PACKAGE(name="rnl-std-basic", version="0.4") }',
    ),
  );
  expect(read.status).toBe("ready");
  // No records: no drawing of any version, only the circuit.
  const plain = await plan("* plain\nR1 a 0 1k\nV1 a 0 1\n.end\n");
  expect(plain.status).toBe("ready");
  expect(plain.diagnostics.map((item) => item.code)).not.toContain(
    "RNL_IMPORT_VERSION",
  );
});
