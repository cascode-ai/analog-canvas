import { readFileSync } from "node:fs";
import { afterAll, expect, it } from "vitest";
import type { RnlSnapshot } from "@icm/rnl";
import { serializeProject } from "@icm/project-protocol";
import { createRnlTestCore } from "./rnl-core.test-support";
import { planRnlImport } from "./rnl-import";
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
