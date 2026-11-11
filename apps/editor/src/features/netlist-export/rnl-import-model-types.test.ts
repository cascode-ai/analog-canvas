import { afterAll, expect, it } from "vitest";
import { createRnlTestCore } from "./rnl-core.test-support";
import { planRnlImport } from "./rnl-import";
import type { RnlRuntime } from "./rnl-runtime";

const core = await createRnlTestCore();
afterAll(() => core.terminate());
const runtime: RnlRuntime = core;

// A transistor no card declares and the drawing does not draw: only the
// caller can say what it is.
const path = "dut.scs";
const inputs = [
  {
    path,
    bytes: new TextEncoder().encode(
      [
        '// @RNL(type="header") { @VERSION("0.3");',
        '// @USE-PACKAGE(name="rnl-std-full", version="0.3"); }',
        "simulator lang=spectre",
        "subckt dut (IN OUT VSS)",
        "R1 (IN OUT) resistor r=1k",
        "M0 (OUT IN VSS VSS) nch_mac w=1u l=1u",
        "// @RNL {",
        '// #R1 @SET-SYMBOL $RESISTOR => @PLACE(0, 0) => @ORIENT("R0");',
        "// }",
        "ends dut",
        "",
      ].join("\n"),
    ),
  },
];

it("types a part by the caller's device type only where nothing else does", async () => {
  const refused = await planRnlImport({
    inputs,
    entryPath: path,
    runtime,
    undeclaredModels: "give-type",
  });
  expect(refused).toMatchObject({
    status: "failed",
    message: expect.stringContaining("modelTypes"),
  });

  const plan = await planRnlImport({
    inputs,
    entryPath: path,
    runtime,
    modelTypes: { NCH_MAC: "nmos", unused: "pmos" },
    undeclaredModels: "give-type",
  });
  if (plan.status !== "ready") throw new Error(plan.message);
  expect(
    plan.project.documents
      .flatMap((document) => document.instances)
      .map((instance) => instance.symbolId),
  ).toContain("nmos");
  expect(plan.modelTypesUsed).toEqual([["NCH_MAC", "nmos"]]);
});
