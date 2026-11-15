import {
  createEmptyProject,
  createRoutePath,
  routeEndpoints,
  type CircuitProject,
  type Point,
  type RouteEndpoint,
} from "@icm/model";
import { createDesignNetlistExport } from "@icm/netlist";
import { describe, expect, it } from "vitest";

import { executeProjectTransaction } from "./project-transaction.js";

const terminal = (instanceId: string, pinName: string): RouteEndpoint => ({
  kind: "terminal",
  instanceId,
  pinName,
});
const junction: RouteEndpoint = { kind: "junction", junctionId: "J" };

/**
 * A node line RA.1 — J — RB.1 at y = 60 with RC's wire coming down into its
 * branch Junction J at (50, 60). RD's lower pin sits at (80, 20), beside RC's
 * pin, on a Net of its own.
 */
function branchProject(): CircuitProject {
  const project = createEmptyProject("branch", "Branch");
  const document = project.documents[0]!;
  for (const [id, x, y] of [
    ["RA", 0, 100],
    ["RB", 100, 100],
    ["RC", 50, 0],
    ["RD", 80, 0],
  ] as const) {
    document.instances.push({
      id,
      reference: id,
      symbolId: "resistor",
      placement: { position: { x, y }, rotation: 0, mirror: "none" },
      netlist: {
        binding: { kind: "primitive", deviceClass: "resistor" },
        parameters: { value: "1k" },
      },
    });
  }
  document.nets.push(
    {
      id: "node",
      terminals: [
        { instanceId: "RA", pinName: "1" },
        { instanceId: "RB", pinName: "1" },
        { instanceId: "RC", pinName: "2" },
      ],
    },
    { id: "a", terminals: [{ instanceId: "RA", pinName: "2" }] },
    { id: "b", terminals: [{ instanceId: "RB", pinName: "2" }] },
    { id: "c", terminals: [{ instanceId: "RC", pinName: "1" }] },
    {
      id: "d",
      terminals: [
        { instanceId: "RD", pinName: "1" },
        { instanceId: "RD", pinName: "2" },
      ],
    },
  );
  document.junctions.push({
    id: "J",
    netId: "node",
    position: { x: 50, y: 60 },
    role: "branch",
  });
  const wire = (
    id: string,
    start: RouteEndpoint,
    end: RouteEndpoint,
    bends: Point[],
    netId = "node",
  ) =>
    createRoutePath({
      id,
      netId,
      start,
      end,
      bends,
      modes: [...bends, null].map(() => "manual" as const),
    });
  document.routes.push(
    wire("left", terminal("RA", "1"), junction, [{ x: 0, y: 60 }]),
    wire("right", junction, terminal("RB", "1"), [{ x: 100, y: 60 }]),
    wire("tap", terminal("RC", "2"), junction, []),
    wire(
      "d-loop",
      terminal("RD", "1"),
      terminal("RD", "2"),
      [
        { x: 120, y: -20 },
        { x: 120, y: 20 },
      ],
      "d",
    ),
  );
  return project;
}

function reroute(project: CircuitProject, bends: Point[]) {
  const document = project.documents[0]!;
  return executeProjectTransaction(project, {
    transactionId: "reroute",
    projectId: project.id,
    expectedStructureRevision: project.structureRevision,
    actor: { kind: "agent", id: "test" },
    edits: [
      {
        kind: "transact_document",
        documentId: document.id,
        expectedRevision: document.revision,
        edits: [
          {
            kind: "set_route_path",
            route: createRoutePath({
              id: "tap",
              netId: "node",
              start: terminal("RC", "2"),
              end: junction,
              bends,
              modes: [...bends, null].map(() => "manual" as const),
            }),
          },
        ],
      },
    ],
  });
}

function spice(project: CircuitProject) {
  const exported = createDesignNetlistExport(project, { format: "spice" });
  if (exported.status !== "ready")
    throw new Error(JSON.stringify(exported.diagnostics));
  return exported.file.text;
}

describe("rerouting a wire that ends on a branch Junction (#2288)", () => {
  it("keeps the Junction, its identity and the netlist", () => {
    const project = branchProject();
    const result = reroute(project, [
      { x: 30, y: 20 },
      { x: 30, y: 40 },
      { x: 50, y: 40 },
    ]);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    const document = result.project.documents[0]!;
    expect(document.junctions).toEqual(project.documents[0]!.junctions);
    const tap = document.routes.find(({ id }) => id === "tap")!;
    expect(routeEndpoints(tap)).toEqual([terminal("RC", "2"), junction]);
    expect(spice(result.project)).toBe(spice(project));
  });

  it.each([
    [
      "runs along the node line into the Junction",
      [
        { x: 70, y: 20 },
        { x: 70, y: 60 },
      ],
    ],
    [
      "crosses another Net's pin and runs along the node line",
      [
        { x: 80, y: 20 },
        { x: 80, y: 60 },
      ],
    ],
  ])("is refused when it %s, so the Junction and netlist stay", (_, bends) => {
    const project = branchProject();
    const result = reroute(project, bends);
    const after = result.ok ? result.project : project;
    expect(spice(after)).toBe(spice(project));
    expect(after.documents[0]!.junctions).toEqual(
      project.documents[0]!.junctions,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toMatch(
      /Route tap would no longer end on Junction J/u,
    );
  });
});
