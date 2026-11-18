// RNL 0.4 as an Agent writes it (netlists/rnl-agent-drawing): the import
// reads what each file writes and reports what it leaves out (#2358).
import { readFileSync } from "node:fs";
import { afterAll, expect, it } from "vitest";

import { resolveRouteGeometry } from "@icm/derived";
import { serializeProject } from "@icm/project-protocol";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";

import { createRnlTestCore } from "./rnl-core.test-support";
import { planRnlImport } from "./rnl-import";
import type { RnlRuntime } from "./rnl-runtime";

const core = await createRnlTestCore();
afterAll(() => core.terminate());
const runtime: RnlRuntime = core;

async function imported(name: string) {
  const plan = await planRnlImport({
    inputs: [
      {
        path: name,
        bytes: readFileSync(`netlists/rnl-agent-drawing/${name}`),
      },
    ],
    entryPath: name,
    runtime,
  });
  if (plan.status !== "ready") throw new Error(plan.message);
  expect(() => serializeProject(plan.project)).not.toThrow();
  const [document] = plan.project.documents;
  const resolver = createProjectSymbolResolver(plan.project, builtInSymbols);
  const paths = document!.routes.map(
    (route) => resolveRouteGeometry(document!, resolver, route)!.centerline,
  );
  return { plan, document: document!, paths };
}

const codes = (plan: { diagnostics: { code: string }[] }) =>
  plan.diagnostics.map((item) => item.code);

it("draws each wire left to its mode along the path RNL draws, not straight between its pins", async () => {
  const { plan, document, paths } = await imported("ota5t-auto-wires.sp");
  // Every part placed, every wire a route, every leg level or upright: the
  // corners the mode adds come in as bends.
  expect(document.instances.filter((item) => !item.placement)).toEqual([]);
  expect(document.routes).toHaveLength(18);
  expect(
    document.routes
      .flatMap((route) => route.legs)
      .filter((leg) => leg.to.kind === "bend"),
  ).toHaveLength(8);
  for (const path of paths)
    for (const [index, to] of path.slice(1).entries()) {
      const from = path[index]!;
      expect(from.x === to.x || from.y === to.y).toBe(true);
    }
  expect(codes(plan)).not.toContain("RNL_IMPORT_WIRE_PATH");
});

it("reports the wires a mode runs over another wire of their net, by the lines that write them", async () => {
  const { plan } = await imported("ota5t-auto-wires.sp");
  const overlap = plan.diagnostics.find(
    (item) => item.code === "RNL_IMPORT_WIRES_OVERLAP",
  );
  // M4's drain to M2 and to CL; M1's and M2's sources to M5.
  expect(overlap?.message).toMatch(/^4 wires /u);
  for (const line of [25, 26, 27, 28])
    expect(overlap?.message).toContain(`@ota5t-auto-wires.sp:${line}:5`);
});

it("reads a net label the file places as a net label, with its wires", async () => {
  const { plan, document } = await imported("net-labels.sp");
  expect(plan.drawing).toBe("preserved");
  expect(codes(plan)).not.toContain("RNL_IMPORT_MARK_SKIPPED");
  expect(codes(plan)).not.toContain("RNL_IMPORT_WIRE_SKIPPED");
  const named = (id: string) =>
    document.importReference?.nets.find((net) => net.id === id)?.name;
  expect(
    document.annotations
      .filter((item) => item.kind === "net-label")
      .map((item) => named(item.netId!))
      .sort(),
  ).toEqual(["in", "mid"]);
  // R1–R2 through the junction, the junction to the mid label, R1 to the
  // input label, R2 to ground.
  expect(document.routes).toHaveLength(5);
});

it("leaves out a wire drawn to a pin of another net, says where it is written, and draws the rest", async () => {
  const { plan, document } = await imported("wrong-net-wire.sp");
  expect(plan.drawing).toBe("partial");
  expect(plan.diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: "RNL_IMPORT_RNL_FINDING",
        message: expect.stringMatching(
          /^RNL wrong-net-wire\.sp:23:5 RNL4204 wire-net-mismatch: /u,
        ),
      }),
      expect.objectContaining({
        code: "RNL_IMPORT_WIRE_WRONG_NET",
        message: expect.stringContaining("@wrong-net-wire.sp:23:5"),
      }),
    ]),
  );
  expect(codes(plan)).not.toContain("RNL_IMPORT_INVALID_DRAWING");
  expect(document.instances.filter((item) => !item.placement)).toEqual([]);
  expect(document.routes).toHaveLength(17);
});

it("places every Cell Pin a file draws as a port, supply or ground, adds none for the package's fill, and reads a structure as no mark", async () => {
  const { plan, document } = await imported("pdk-inverter.sp");
  expect(plan.drawing).toBe("preserved");
  expect(plan.diagnostics).toEqual([]);
  // VDD and VSS are the supply and the ground the file draws; the standard
  // fill's port tags for them, which it leaves to a solver, add no Pin.
  expect(document.instances.filter((item) => !item.placement)).toEqual([]);
  const pins = (document.netlist?.terminals ?? []).map((terminal) => [
    terminal.name,
    terminal.interfaceInstanceIds.map(
      (id) => document.instances.find((item) => item.id === id)?.symbolId,
    ),
  ]);
  expect(pins).toEqual([
    ["VDD", ["vdd-port"]],
    ["VSS", ["named-ground"]],
    ["IN", ["port"]],
    ["OUT", ["port"]],
  ]);
});

it("reports RNL's layout hints by line as advice, which leave the drawing the file's", async () => {
  const { plan } = await imported("pdk-inverter-crossing.sp");
  expect(plan.drawing).toBe("preserved");
  expect(plan.diagnostics).toEqual([
    expect.objectContaining({
      severity: "warning",
      code: "RNL_IMPORT_LAYOUT_HINT",
      message:
        "RNL pdk-inverter-crossing.sp:14 RNL7001 crossings: inv: 1 crossing of wires: &IN with &OUT at (-5, 1)",
    }),
  ]);
});
