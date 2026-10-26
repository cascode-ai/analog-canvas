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
const runtime: RnlRuntime = {
  write: (request) =>
    core.write(request as unknown as Parameters<typeof core.write>[0]),
  snapshot: (request) =>
    core.snapshot(request) as unknown as Promise<RnlSnapshot>,
};

it("keeps the circuit and leaves out a drawing whose wire joins nets the netlist keeps apart", async () => {
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
  expect(plan.diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: "RNL_IMPORT_INVALID_DRAWING",
        severity: "error",
      }),
    ]),
  );
  // Undrawn, and a Project the editor can save.
  expect(plan.project.documents[0]!.routes).toEqual([]);
  expect(() => serializeProject(plan.project)).not.toThrow();
  expect(
    plan.project.documents[0]!.netlist!.terminals.map((port) => port.name),
  ).toEqual([
    "VDD",
    "VSS",
    "D1",
    "CLK",
    "RESET",
    "Q1",
    "QB1",
    "D2",
    "Q2",
    "QB2",
  ]);
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
