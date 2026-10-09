// Editing drawn Wires: dragged and re-pointed ends, junction deletion,
// overlapping branches, and imported Route guidance.

import { parseSavedProject } from "./editor-fixtures";
import { createRoutePath } from "@icm/model";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { createEmptyProject } from "@icm/model";
import { createRoutingDemoProject } from "../src/demos/routing-demo.js";
import { clickDrawTool, downloadBytes } from "./editor-fixtures.js";
import {
  placeComponent,
  openSelectionShelf,
} from "./manual-editor-fixtures.js";
import { clickRoute, readRoutePoints } from "./canvas-fixtures.js";

async function dragHandleToPoint(
  page: Page,
  handle: Locator,
  routeIdForFrame: string,
  point: { x: number; y: number },
): Promise<void> {
  const box = await handle.boundingBox();
  if (!box) throw new Error("Drag target is not measurable");
  const target = await page
    .locator(`[data-layer="routes"] [data-object-id="${routeIdForFrame}"]`)
    .evaluate((element, wanted) => {
      const matrix = (element as SVGGraphicsElement).getScreenCTM();
      if (!matrix) return null;
      const screen = new DOMPoint(wanted.x, wanted.y).matrixTransform(matrix);
      return { x: screen.x, y: screen.y };
    }, point);
  if (!target) throw new Error(`Point is not measurable in ${routeIdForFrame}`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 4 });
  await page.mouse.up();
}

async function exportedConnectivity(page: Page) {
  const saved = parseSavedProject(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
  ) as {
    documents: Array<{
      nets: Array<{
        id: string;
        terminals: Array<{ instanceId: string; pinName: string }>;
      }>;
      routes: Array<{ id: string; netId: string }>;
    }>;
  };
  const document = saved.documents[0]!;
  return {
    conductingNetIds: [
      ...new Set(document.routes.map((route) => route.netId)),
    ].sort(),
    terminalNetId: (instanceId: string, pinName: string) =>
      document.nets.find((net) =>
        net.terminals.some(
          (terminal) =>
            terminal.instanceId === instanceId && terminal.pinName === pinName,
        ),
      )?.id ?? null,
  };
}

function markRoutingDemoNetsImported(
  project: ReturnType<typeof createRoutingDemoProject>,
): void {
  // These Port symbols stand in for device endpoints in routing tests, not
  // same-name formal interfaces (which legitimately need no extra wire).
  for (const terminal of project.documents[0]!.netlist!.terminals)
    terminal.name = terminal.interfaceInstanceIds[0]!;
  project.documents[0]!.importReference = {
    files: [],
    nets: project.documents[0]!.nets.map((net) => ({
      id: net.id,
      name: net.id,
      scope: "local",
      terminals: structuredClone(net.terminals),
    })),
  };
  for (const net of project.documents[0]!.nets) {
    project.documents[0]!.connectivityEvidence.push({
      id: `evidence-spice-${net.id}`,
      kind: "spice-source",
      netId: net.id,
      sourceNetId: net.id,
    });
  }
}

test("lands a dragged Wire end on the conductor under it", async ({ page }) => {
  // Reported as the two gestures disagreeing: dragging a whole loose wire onto
  // another one connected it, dragging one END of the same wire to the same
  // place did not — and the two drawings are identical, so nothing on the page
  // said which had happened.
  const project = createEmptyProject("endpoint-landing", "Endpoint Landing");
  const document = project.documents[0]!;
  document.nets.push(
    { id: "net-a", terminals: [] },
    { id: "net-b", terminals: [] },
  );
  document.junctions.push(
    {
      id: "A1",
      netId: "net-a",
      position: { x: 200, y: 240 },
      role: "route-anchor",
    },
    {
      id: "A2",
      netId: "net-a",
      position: { x: 400, y: 240 },
      role: "route-anchor",
    },
    {
      id: "B1",
      netId: "net-b",
      position: { x: 300, y: 140 },
      role: "route-anchor",
    },
    {
      id: "B2",
      netId: "net-b",
      position: { x: 300, y: 180 },
      role: "route-anchor",
    },
  );
  document.routes.push(
    createRoutePath({
      id: "route-a",
      netId: "net-a",
      start: { kind: "junction", junctionId: "A1" },
      end: { kind: "junction", junctionId: "A2" },
      bends: [],
      modes: ["manual"],
    }),
    createRoutePath({
      id: "route-b",
      netId: "net-b",
      start: { kind: "junction", junctionId: "B1" },
      end: { kind: "junction", junctionId: "B2" },
      bends: [],
      modes: ["manual"],
    }),
  );

  await page.goto("/editor");
  await page.getByTestId("project-file").setInputFiles({
    name: "endpoint-landing.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await clickRoute(page, "route-b");
  await dragHandleToPoint(
    page,
    page.getByTestId("route-endpoint-handle-route-b-end"),
    "route-a",
    { x: 300, y: 240 },
  );

  // The landing splits the conductor it tees into, so three Routes remain —
  // and every one of them is on the same Net, which is the actual claim.
  await expect(page.locator('[data-testid^="route-hit-"]')).toHaveCount(3);
  const connectivity = await exportedConnectivity(page);
  expect(connectivity.conductingNetIds).toHaveLength(1);
});

test("re-points a Wire end that is anchored to a pin", async ({ page }) => {
  // Before this the handle refused with "A terminal-connected wire end is
  // electrically anchored", so rewiring meant deleting the wire and drawing a
  // new one.
  const project = createEmptyProject("endpoint-repoint", "Endpoint Repoint");
  const document = project.documents[0]!;
  document.instances.push({
    id: "VDD1",
    symbolId: "vdd-port",
    placement: { position: { x: 300, y: 120 }, rotation: 0, mirror: "none" },
  } as (typeof document)["instances"][number]);
  document.nets.push(
    { id: "net-a", terminals: [] },
    { id: "net-supply", terminals: [{ instanceId: "VDD1", pinName: "P" }] },
  );
  document.junctions.push(
    {
      id: "A1",
      netId: "net-a",
      position: { x: 200, y: 260 },
      role: "route-anchor",
    },
    {
      id: "A2",
      netId: "net-a",
      position: { x: 420, y: 260 },
      role: "route-anchor",
    },
    {
      id: "S2",
      netId: "net-supply",
      position: { x: 300, y: 190 },
      role: "route-anchor",
    },
  );
  document.routes.push(
    createRoutePath({
      id: "route-a",
      netId: "net-a",
      start: { kind: "junction", junctionId: "A1" },
      end: { kind: "junction", junctionId: "A2" },
      bends: [],
      modes: ["manual"],
    }),
    createRoutePath({
      id: "route-supply",
      netId: "net-supply",
      // The VDD port's P pin sits 20 below its placement, at (300, 140).
      start: { kind: "terminal", instanceId: "VDD1", pinName: "P" },
      end: { kind: "junction", junctionId: "S2" },
      bends: [],
      modes: ["manual"],
    }),
  );

  await page.goto("/editor");
  await page.getByTestId("project-file").setInputFiles({
    name: "endpoint-repoint.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await clickRoute(page, "route-supply");
  await dragHandleToPoint(
    page,
    page.getByTestId("route-endpoint-handle-route-supply-start"),
    "route-a",
    { x: 300, y: 260 },
  );

  const connectivity = await exportedConnectivity(page);
  // The pin let go of the wire that was on it, and the wire landed where it
  // was dropped. Both halves are the gesture; neither alone is.
  expect(connectivity.terminalNetId("VDD1", "P")).toBeNull();
  expect(connectivity.conductingNetIds).toHaveLength(1);
});

test("physically cuts an imported Route without reconnecting detached components through source guidance", async ({
  page,
}) => {
  const project = createRoutingDemoProject();
  const document = project.documents[0]!;
  markRoutingDemoNetsImported(project);
  document.sourceBinding = {
    cellName: "routing_demo",
    sourceRef: {
      fileId: "source-routing-demo",
      start: { offset: 0, line: 1, column: 1 },
      end: { offset: 1, line: 1, column: 2 },
    },
  };
  document.routes = [
    createRoutePath({
      id: "route-imported-partial",
      netId: "net-h",
      start: { kind: "terminal", instanceId: "A", pinName: "P" },
      end: { kind: "terminal", instanceId: "B", pinName: "P" },
      bends: [],
      modes: ["manual"],
    }),
  ];
  await page.goto("/editor");
  await page.getByTestId("project-file").setInputFiles({
    name: "routing-imported-partial.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });

  await clickRoute(page, "route-imported-partial");
  await expect(page.getByTestId("flightline")).toHaveCount(1);
  await page.keyboard.press("Delete");
  await expect(page.locator('[data-layer="routes"] polyline')).toHaveCount(0);
  await expect(page.getByTestId("status")).toContainText(
    "Deleted wire route-imported-partial",
  );

  await expect(page.getByTestId("source-status")).toHaveText(
    "connectivity-modified",
  );
  await expect(page.getByTestId("flightline")).toHaveCount(3);
});

test("keeps remaining imported flightlines after routing one guided connection", async ({
  page,
}) => {
  const project = createRoutingDemoProject();
  markRoutingDemoNetsImported(project);
  project.documents[0]!.sourceBinding = {
    cellName: "routing_demo",
    sourceRef: {
      fileId: "source-routing-demo",
      start: { offset: 0, line: 1, column: 1 },
      end: { offset: 1, line: 1, column: 2 },
    },
  };
  await page.goto("/editor");
  await page.getByTestId("project-file").setInputFiles({
    name: "routing-flightlines.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });

  await expect(page.getByTestId("flightline")).toHaveCount(3);
  const hint = page.getByTestId("flightline-hit").first();
  await hint.click({ force: true });
  await expect(page.getByTestId("active-tool")).toHaveText("wire");
  await expect(page.getByTestId("status")).toContainText(
    "Wire source: flightline on",
  );

  await hint.click({ force: true });
  await expect(page.getByTestId("active-tool")).toHaveText("wire");
  await expect(page.locator('[data-layer="routes"] polyline')).toHaveCount(1);
  await expect(page.getByTestId("flightline")).toHaveCount(2);
});

test("suppresses only the highlighted imported Net guidance", async ({
  page,
}) => {
  const project = createRoutingDemoProject();
  markRoutingDemoNetsImported(project);
  project.documents[0]!.routes.push(
    createRoutePath({
      id: "route-imported-h",
      netId: "net-h",
      start: { kind: "terminal", instanceId: "A", pinName: "P" },
      end: { kind: "terminal", instanceId: "B", pinName: "P" },
      bends: [],
      modes: ["manual"],
    }),
  );
  project.documents[0]!.sourceBinding = {
    cellName: "routing_demo",
    sourceRef: {
      fileId: "source-routing-demo",
      start: { offset: 0, line: 1, column: 1 },
      end: { offset: 1, line: 1, column: 2 },
    },
  };
  await page.goto("/editor");
  await page.getByTestId("project-file").setInputFiles({
    name: "routing-imported.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });

  await expect(page.getByTestId("flightline")).toHaveCount(2);
  await clickRoute(page, "route-imported-h");
  await expect(page.getByTestId("flightline")).toHaveCount(1);
  await openSelectionShelf(page);
  await page.getByRole("button", { name: "All", exact: true }).click();
  await expect(page.getByTestId("flightline")).toHaveCount(2);
  await page.keyboard.press("h");
  await expect(page.getByTestId("net-highlight-overlay")).toHaveAttribute(
    "data-net-id",
    "net-h",
  );
  await expect(page.getByTestId("flightline")).toHaveCount(1);
  await page.keyboard.press("h");
  await expect(page.getByTestId("net-highlight-overlay")).toHaveCount(0);
  await expect(page.getByTestId("flightline")).toHaveCount(2);
});

test("keeps direct device pin corners on-grid and deletes a selected junction", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "nmos", { x: 300, y: 260 });
  await placeComponent(page, "resistor", { x: 540, y: 160 });
  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-M1-D").click();
  await page.getByTestId("terminal-R1-1").click();

  const terminalRoute = await readRoutePoints(page, "route-ui-1");
  expect(terminalRoute.length).toBeGreaterThanOrEqual(3);
  expect(
    terminalRoute.slice(0, -1).every((point, index) => {
      const next = terminalRoute[index + 1]!;
      return point.x === next.x || point.y === next.y;
    }),
  ).toBe(true);
  expect(
    terminalRoute.every(
      (point) => Math.abs(point.x % 10) === 0 && Math.abs(point.y % 10) === 0,
    ),
  ).toBe(true);

  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-M1-G").click();
  await page
    .getByTestId("schematic-canvas")
    .dblclick({ position: { x: 180, y: 390 } });
  const junction = page.locator('[data-canvas-hit-kind="junction"]');
  await expect(junction).toHaveCount(1);

  await junction.click({ button: "right", force: true });
  await openSelectionShelf(page);
  await expect(
    page.getByRole("button", { name: "Delete junction and attached wires" }),
  ).toBeVisible();
  await page.keyboard.press("Delete");
  await expect(junction).toHaveCount(0);
  await expect(page.locator('[data-layer="routes"] polyline')).toHaveCount(1);
  await expect(page.getByTestId("status")).toContainText(
    "Deleted selected schematic objects",
  );

  await page.keyboard.press("Control+z");
  await expect(junction).toHaveCount(1);
  await expect(page.locator('[data-layer="routes"] polyline')).toHaveCount(2);
});

test("normalizes overlapping branches without freezing the dragged wire", async ({
  page,
}) => {
  await page.goto("/editor");
  const canvas = page.getByTestId("schematic-canvas");
  const dots = page.locator('[data-layer="junctions"] circle');

  // A horizontal run with a tap rising from its middle: three branches at one
  // contact, so the contact carries a dot.
  await clickDrawTool(page, "wire");
  await canvas.click({ position: { x: 200, y: 300 } });
  await canvas.dblclick({ position: { x: 400, y: 300 } });
  await canvas.click({ position: { x: 300, y: 300 } });
  await canvas.dblclick({ position: { x: 300, y: 200 } });
  await page.keyboard.press("Escape");
  await expect(dots).toHaveCount(1);

  const box = (await canvas.boundingBox())!;
  const dragSegment = async (from: number, to: number) => {
    await page.mouse.move(box.x + 250, box.y + from);
    await page.mouse.down();
    await page.mouse.move(box.x + 250, box.y + to, { steps: 12 });
    await page.mouse.up();
  };

  const allRoutePoints = () =>
    page
      .locator('[data-layer="routes"] polyline')
      .evaluateAll((elements) =>
        elements.map((element) =>
          Array.from((element as unknown as SVGPolylineElement).points).map(
            (point) => ({ x: point.x, y: point.y }),
          ),
        ),
      );
  const tapBefore = (await allRoutePoints()).find(
    (points) => points.length === 2 && points[0]!.x === points[1]!.x,
  )!;
  const dotBefore = Number(await dots.first().getAttribute("cy"));
  const fixedTapEnd = tapBefore.reduce((a, b) => (a.y < b.y ? a : b));
  const expectNoDuplicateCoverage = (routes: { x: number; y: number }[][]) => {
    const spans = routes.flatMap((points) =>
      points.slice(1).map((to, index) => {
        const from = points[index]!;
        const vertical = from.x === to.x;
        return {
          vertical,
          axis: vertical ? from.x : from.y,
          min: vertical ? Math.min(from.y, to.y) : Math.min(from.x, to.x),
          max: vertical ? Math.max(from.y, to.y) : Math.max(from.x, to.x),
        };
      }),
    );
    for (let i = 0; i < spans.length; i++)
      for (let j = i + 1; j < spans.length; j++) {
        const a = spans[i]!,
          b = spans[j]!;
        if (a.vertical === b.vertical && a.axis === b.axis)
          expect(
            Math.min(a.max, b.max) - Math.max(a.min, b.min),
          ).toBeLessThanOrEqual(0);
      }
  };

  // The left run moves down and its shared vertical coverage is unioned.
  // The untouched right arm still branches at the original height: THAT
  // geometric T keeps a dot, not an immutable role on the old tap Route.
  await dragSegment(300, 380);
  await expect(dots).toHaveCount(1);
  const lowered = await allRoutePoints();
  expect(lowered.some((points) => points.some((point) => point.y > 380))).toBe(
    true,
  );
  expectNoDuplicateCoverage(lowered);
  expect(
    lowered.some((points) =>
      points.some((p) => p.x === fixedTapEnd.x && p.y === fixedTapEnd.y),
    ),
  ).toBe(true);

  await page.getByTestId("draw-tool-undo").click();
  await expect(dots).toHaveCount(1);

  // Moving beyond the old tip is legal too. Coverage is unioned instead of
  // freezing the pointer just to keep a formerly visible Junction dot.
  await dragSegment(300, 160);
  const raised = await allRoutePoints();
  expectNoDuplicateCoverage(raised);
  expect(
    Math.min(...raised.flatMap((points) => points.map((p) => p.y))),
  ).toBeLessThan(fixedTapEnd.y);
  await expect(page.getByTestId("status")).not.toContainText("would overlap");
  await page.getByTestId("draw-tool-undo").click();
  await expect(dots).toHaveCount(1);
  expect(Number(await dots.first().getAttribute("cy"))).toBe(dotBefore);
});
