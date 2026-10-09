// Drawing Wires with the wire tool: endpoints, bends and corners, taps and
// junctions, and the pins one Wire connects.

import { createRoutePath } from "@icm/model";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { createEmptyProject } from "@icm/model";
import { createRoutingDemoProject } from "../src/demos/routing-demo.js";
import {
  awaitEditorReady,
  chooseComponent,
  clickDrawTool,
} from "./editor-fixtures.js";
import { placeComponent } from "./manual-editor-fixtures.js";
import { clickRoute, readRoutePoints, dragBy } from "./canvas-fixtures.js";

async function onlyRouteId(page: Page): Promise<string> {
  const route = page.locator('[data-testid^="route-hit-"]');
  await expect(route).toHaveCount(1);
  const testId = await route.getAttribute("data-testid");
  if (!testId) throw new Error("Route has no test id");
  return testId.replace(/^route-hit-/u, "");
}

async function clickRouteWithScreenOffset(
  page: Page,
  routeId: string,
  offset: { x: number; y: number },
  position = 0.5,
  segmentIndex = 0,
): Promise<void> {
  const route = page.getByTestId(`route-hit-${routeId}`);
  const point = await route.evaluate(
    (element, options) => {
      const polyline = element as SVGPolylineElement;
      const first = polyline.points.getItem(options.segmentIndex);
      const second = polyline.points.getItem(options.segmentIndex + 1);
      const matrix = polyline.getScreenCTM();
      if (!first || !second || !matrix) return null;
      return new DOMPoint(
        first.x + (second.x - first.x) * options.position,
        first.y + (second.y - first.y) * options.position,
      ).matrixTransform(matrix);
    },
    { position, segmentIndex },
  );
  if (!point) throw new Error(`Route ${routeId} is not measurable`);
  await page.mouse.click(point.x + offset.x, point.y + offset.y);
}

async function clickRouteVertexWithScreenOffset(
  page: Page,
  routeId: string,
  vertexIndex: number,
  offset: { x: number; y: number },
): Promise<void> {
  const route = page.getByTestId(`route-hit-${routeId}`);
  const point = await route.evaluate(
    (element, options) => {
      const polyline = element as SVGPolylineElement;
      const vertex = polyline.points.getItem(options.vertexIndex);
      const matrix = polyline.getScreenCTM();
      if (!vertex || !matrix) return null;
      return new DOMPoint(vertex.x, vertex.y).matrixTransform(matrix);
    },
    { vertexIndex },
  );
  if (!point)
    throw new Error(`Route vertex ${routeId}:${vertexIndex} is not measurable`);
  await page.mouse.click(point.x + offset.x, point.y + offset.y);
}

async function lastRouteId(page: Page): Promise<string> {
  const routes = page.locator('[data-testid^="route-hit-"]');
  const testId = await routes.last().getAttribute("data-testid");
  if (!testId) throw new Error("Route has no test id");
  return testId.replace(/^route-hit-/u, "");
}

test("splices a two-terminal device into one wire and reconnects its halves after deletion", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 420, y: 180 });
  await placeComponent(page, "resistor", { x: 420, y: 460 });

  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-R1-2").click();
  await page.getByTestId("terminal-R2-1").click();
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-testid^="route-hit-"]')).toHaveCount(1);

  await placeComponent(page, "resistor", { x: 420, y: 320 });
  await expect(page.getByTestId("hit-R3")).toBeVisible();
  await expect(page.locator('[data-testid^="route-hit-"]')).toHaveCount(2);

  await page.keyboard.press("Delete");
  await expect(page.getByTestId("hit-R3")).toHaveCount(0);
  await expect(page.locator('[data-testid^="route-hit-"]')).toHaveCount(2);
  const openEnds = page.locator('[data-testid^="junction-"]');
  await expect(openEnds).toHaveCount(2);

  await clickDrawTool(page, "wire");
  await openEnds.nth(0).click();
  await openEnds.nth(1).click();
  await expect(page.getByTestId("status")).toContainText("Committed route");
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-testid^="route-hit-"]')).toHaveCount(1);
});

test("connects one MOS Gate to Drain without false contact ambiguity", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "nmos", { x: 480, y: 260 });
  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-M1-G").click();
  await page.getByTestId("terminal-M1-D").click();
  await expect(page.getByTestId("status")).toContainText("Committed route");
  await expect(page.locator('[data-layer="routes"] polyline')).toHaveCount(1);
  await expect(
    page.locator('[data-layer="junctions"] [data-node-kind="contact"]'),
  ).toHaveCount(0);
});

test("commits two endpoint clicks even before React publishes the first one", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 340, y: 220 });
  await placeComponent(page, "resistor", { x: 660, y: 220 });
  await clickDrawTool(page, "wire");

  // Both complete clicks run in one browser task. The interaction reducer has already
  // accepted the first endpoint, but React has no chance to render that source
  // into the second handler's closure. The handler must read the synchronous
  // interaction state or this silently replaces the source with R2.
  await page.evaluate(() => {
    for (const id of ["terminal-R1-2", "terminal-R2-1"]) {
      const endpoint = document.querySelector(`[data-testid="${id}"]`);
      if (!endpoint) throw new Error(`Missing ${id}`);
      const bounds = endpoint.getBoundingClientRect();
      const coordinates = {
        bubbles: true,
        button: 0,
        clientX: bounds.x + bounds.width / 2,
        clientY: bounds.y + bounds.height / 2,
      };
      endpoint.dispatchEvent(
        new PointerEvent("pointerdown", {
          ...coordinates,
          pointerId: 1,
        }),
      );
      endpoint.dispatchEvent(
        new PointerEvent("pointerup", { ...coordinates, pointerId: 1 }),
      );
      endpoint.dispatchEvent(
        new MouseEvent("click", { ...coordinates, detail: 1 }),
      );
    }
  });

  await expect(page.getByTestId("status")).toContainText("Committed route");
  await expect(page.locator('[data-layer="routes"] polyline')).toHaveCount(1);
});

test("turns between two parts rather than drawing over one of them", async ({
  page,
}) => {
  // Bottom pin to top pin, side by side: both single corners would run up or
  // down a part's own body, over the pin at its other end — a meeting the
  // netlist will not have, drawn as though it had. The wire turns in the gap
  // instead, and leaves each pin the way the drawer aimed.
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 320, y: 220 });
  await placeComponent(page, "resistor", { x: 520, y: 220 });
  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-R1-2").click();
  await page.getByTestId("terminal-R2-1").click();
  await expect(page.getByTestId("status")).toContainText("Committed route");

  const points = await readRoutePoints(page, "route-ui-1");
  expect(points).toHaveLength(4);
  const [start, first, second, end] = points;
  expect(first!.y).toBe(start!.y);
  expect(second!.x).toBe(first!.x);
  expect(first!.x).toBeGreaterThan(start!.x);
  expect(first!.x).toBeLessThan(end!.x);
  // One Net, one conductor: nothing was picked up on the way.
  await expect(page.getByTestId("net-count")).toHaveText("1");
  await expect(page.locator('[data-layer="routes"] polyline')).toHaveCount(1);
});

test("reaches a downward pin from the side when the drawing allows", async ({
  page,
}) => {
  // The pin points down, and the wire comes from the left: no rule pushes the
  // run below the pin first. The last leg arrives level with the pin, which is
  // clear of the part because the pin hangs under it.
  await page.goto("/editor");
  await placeComponent(page, "nmos", { x: 200, y: 400 });
  await placeComponent(page, "nmos", { x: 600, y: 200 });
  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-M1-G").click();
  await page.getByTestId("terminal-M2-S").hover();

  const preview = await page.getByTestId("wire-preview").evaluate((element) =>
    Array.from((element as SVGPolylineElement).points).map(({ x, y }) => ({
      x,
      y,
    })),
  );
  const target = preview.at(-1)!;
  const beforeTarget = preview.at(-2)!;
  expect(beforeTarget.y).toBe(target.y);
  expect(preview).toHaveLength(3);

  await page.getByTestId("terminal-M2-S").click();
  await expect(page.getByTestId("status")).toContainText("Committed route");
  expect(await readRoutePoints(page, "route-ui-1")).toEqual(preview);
});

test("keeps three collinear MOS Gates connected without a junction dot", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "nmos", { x: 420, y: 260 });
  await placeComponent(page, "nmos", { x: 560, y: 260 });
  await placeComponent(page, "nmos", { x: 700, y: 260 });

  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-M1-G").click();
  await page.getByTestId("terminal-M2-G").click();
  await expect(page.getByTestId("status")).toContainText("Committed route");

  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-M2-G").click();
  await page.getByTestId("terminal-M3-G").click();
  await expect(page.getByTestId("status")).toContainText("Committed route");
  // One Route per gesture, meeting at M2.G: two conductors and one Net.
  await expect(page.locator('[data-layer="routes"] polyline')).toHaveCount(2);
  await expect(page.getByTestId("net-count")).toHaveText("1");
  await expect(
    page.locator('[data-layer="junctions"] [data-node-kind="contact"]'),
  ).toHaveCount(0);
});

test("keeps Wire input above labels and resolves a screen-tolerant route tap", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 340, y: 220 });
  await placeComponent(page, "resistor", { x: 660, y: 220 });

  await clickDrawTool(page, "wire");
  await expect(page.getByTestId("wire-input-plane")).toBeVisible();
  const label = page.getByTestId("annotation-hit-instance-label-R1");
  const labelBox = await label.boundingBox();
  if (!labelBox) throw new Error("Default label is not measurable");
  await page.mouse.click(
    labelBox.x + labelBox.width / 2,
    labelBox.y + labelBox.height / 2,
  );
  await expect(page.getByTestId("status")).toHaveText(
    "Wire source: free grid point",
  );
  await page.keyboard.press("Escape");

  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-R1-2").click();
  await page.getByTestId("terminal-R2-1").click();
  const routeId = await onlyRouteId(page);
  await expect(page.getByTestId("active-tool")).toHaveText("wire");
  await clickRouteWithScreenOffset(page, routeId, { x: 0, y: 5 });
  await expect(page.getByTestId("status")).toHaveText(
    `Wire source: route ${routeId}`,
  );
});

test("keeps a Wire source across repeated activation and cancels it after undo", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 340, y: 220 });
  await placeComponent(page, "resistor", { x: 660, y: 220 });

  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-R1-2").click();
  await page.keyboard.press("w");
  await page.getByTestId("terminal-R2-1").click();
  await expect(page.locator('[data-layer="routes"] polyline')).toHaveCount(1);

  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-R1-1").click();
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("active-tool")).toHaveText("pointer");
  await expect(page.getByTestId("status")).toContainText(
    "Wire cancelled because the circuit changed",
  );
});

test("turns an off-axis tap near a route bend into an exact junction", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "nmos", { x: 300, y: 260 });
  await placeComponent(page, "resistor", { x: 540, y: 160 });
  await placeComponent(page, "resistor", { x: 680, y: 360 });
  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-M1-D").click();
  await page.getByTestId("terminal-R1-1").click();
  const points = await readRoutePoints(page, "route-ui-1");
  expect(points.length).toBeGreaterThanOrEqual(3);

  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-R2-1").click();
  await clickRouteVertexWithScreenOffset(page, "route-ui-1", 1, {
    x: 3,
    y: 3,
  });
  await expect(page.locator('[data-layer="junctions"] circle')).toHaveCount(1);
});

test("places free wire bends and finishes at an arbitrary grid point", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 300, y: 200 });
  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-R1-2").click();
  const canvas = page.getByTestId("schematic-canvas");
  await canvas.click({ position: { x: 500, y: 260 } });
  await expect(page.getByTestId("wire-preview")).toBeVisible();
  await canvas.dblclick({ position: { x: 650, y: 340 } });
  await expect(page.locator('[data-layer="routes"] polyline')).toHaveCount(1);
  await expect(page.locator('[data-layer="junctions"] circle')).toHaveCount(0);
  await expect(
    page.locator('[data-testid^="junction-junction-ui-"]'),
  ).toHaveCount(1);
  const points = await page
    .locator('[data-testid^="route-hit-"]')
    .evaluate((element) =>
      Array.from((element as SVGPolylineElement).points).map((point) => ({
        x: point.x,
        y: point.y,
      })),
    );
  expect(points.length).toBeGreaterThanOrEqual(4);
  await expect(page.getByTestId("active-tool")).toHaveText("wire");
});

test("reuses a free wire endpoint as a later wire source", async ({ page }) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 300, y: 200 });
  await placeComponent(page, "resistor", { x: 600, y: 300 });
  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-R1-2").click();
  await page
    .getByTestId("schematic-canvas")
    .dblclick({ position: { x: 450, y: 320 } });

  const freeEnd = page.locator('[data-testid^="junction-junction-ui-"]');
  await expect(freeEnd).toHaveCount(1);
  await clickDrawTool(page, "wire");
  await freeEnd.click();
  const continuation = await freeEnd.evaluate((element) => {
    const circle = element as SVGCircleElement;
    const matrix = circle.getScreenCTM();
    if (!matrix) return null;
    const source = { x: circle.cx.baseVal.value, y: circle.cy.baseVal.value };
    const target = new DOMPoint(source.x + 120, source.y).matrixTransform(
      matrix,
    );
    return { source, target: { x: target.x, y: target.y } };
  });
  if (!continuation) throw new Error("Loose wire endpoint is not measurable");
  await page.mouse.move(continuation.target.x, continuation.target.y);
  const continuationPreview = await page
    .getByTestId("wire-preview")
    .evaluate((element) =>
      Array.from((element as SVGPolylineElement).points).map(({ x, y }) => ({
        x,
        y,
      })),
    );
  expect(continuationPreview).toEqual([
    continuation.source,
    { x: continuation.source.x + 120, y: continuation.source.y },
  ]);
  await page.getByTestId("terminal-R2-1").click();

  // Continuing from a loose end extends the conductor: the two pieces
  // coalesce into one Route and the degree-two anchor is consumed.
  await expect(page.locator('[data-testid^="route-hit-"]')).toHaveCount(1);
  await expect(freeEnd).toHaveCount(0);
  await expect(page.getByTestId("active-tool")).toHaveText("wire");
});

test("derives crossings and creates junctions only when a wire ends on a route", async ({
  page,
}) => {
  await page.goto("/editor");
  const project = createRoutingDemoProject();
  // This case isolates geometric crossing/Junction behavior. The final branch
  // deliberately captures D.P, so named HORIZONTAL/VERTICAL claims would
  // correctly turn it into an electrical name conflict instead.
  project.documents[0]!.connectivityEvidence = [];
  // Port contacts now sit at their origins. Keep E level with D so the new
  // branch still passes through D.P, as this crossing/contact scenario needs.
  project.documents[0]!.instances.find(
    (instance) => instance.id === "E",
  )!.placement!.position.y = 460;
  await page.getByTestId("project-file").setInputFiles({
    name: "routing-example.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });

  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-A-P").click();
  await page.getByTestId("terminal-B-P").click();
  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-C-P").click();
  await page.getByTestId("terminal-D-P").click();
  await expect(page.getByTestId("crossing-count")).toHaveText("1");
  await expect(page.locator('[data-layer="junctions"] circle')).toHaveCount(0);

  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-E-P").click();
  await clickRoute(page, "route-ui-1", 0.5);
  await expect(page.getByTestId("status")).toContainText(
    "Ambiguous connection",
  );
  await expect(page.getByTestId("revision")).toHaveText("2");
  await page.keyboard.press("Escape");

  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-E-P").click();
  await clickRouteWithScreenOffset(page, "route-ui-1", { x: 0, y: 5 }, 0.25);
  await expect(page.getByTestId("revision")).toHaveText("3");
  await expect(page.getByTestId("junction-junction-ui-3")).toBeVisible();
  // The new branch passes exactly through D.P. Pass-through pin capture makes
  // that an explicit electrical contact, so only the original geometric
  // crossing remains.
  await expect(page.getByTestId("crossing-count")).toHaveText("1");
  await page.keyboard.press("Escape");

  await clickRoute(page, "route-ui-2", 0.25);
  const handle = page.getByTestId("route-handle-route-ui-2");
  const handleBox = await handle.boundingBox();
  if (!handleBox) throw new Error("Route handle is not measurable");
  await page.mouse.move(
    handleBox.x + handleBox.width / 2,
    handleBox.y + handleBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(handleBox.x + 45, handleBox.y + handleBox.height / 2, {
    steps: 3,
  });
  await page.mouse.up();
  await expect(page.getByTestId("revision")).toHaveText("4");
});

test("places a Ground pin onto a canonical Route and keeps real split topology", async ({
  page,
}) => {
  await page.goto("/editor");
  const project = createRoutingDemoProject();
  const document = project.documents[0]!;
  const horizontalNet = document.nets.find((net) => net.id === "net-h");
  if (!horizontalNet) throw new Error("Routing demo is missing net-h");
  for (const terminal of document.netlist?.terminals ?? []) {
    if (terminal.netId === horizontalNet.id) terminal.name = "0";
  }
  for (const evidence of document.connectivityEvidence) {
    if (evidence.kind === "name-claim" && evidence.netId === horizontalNet.id) {
      evidence.name = "0";
      evidence.scope = "global";
      evidence.powerDomain = "ground";
    }
  }
  document.routes.push(
    createRoutePath({
      id: "route-base",
      netId: "net-h",
      start: { kind: "terminal", instanceId: "A", pinName: "P" },
      end: { kind: "terminal", instanceId: "B", pinName: "P" },
      bends: [],
      modes: ["manual"],
    }),
  );
  await page.getByTestId("project-file").setInputFiles({
    name: "component-route-contact.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await chooseComponent(page, "ground");
  const origin = await page
    .getByTestId("route-hit-route-base")
    .evaluate((element) => {
      const route = element as SVGPolylineElement;
      const from = route.points.getItem(0);
      const to = route.points.getItem(1);
      const matrix = route.getScreenCTM();
      if (!from || !to || !matrix) return null;
      const screen = new DOMPoint(
        (from.x + to.x) / 2,
        (from.y + to.y) / 2 + 10,
      ).matrixTransform(matrix);
      return { x: screen.x, y: screen.y };
    });
  if (!origin) throw new Error("Route contact origin is not measurable");
  await page.mouse.click(origin.x, origin.y);
  if ((await page.getByTestId("hit-GND1").count()) === 0) {
    throw new Error(
      `Ground placement failed: ${await page.getByTestId("status").textContent()}`,
    );
  }
  await page.keyboard.press("Escape");

  await expect(page.getByTestId("route-hit-route-base")).toHaveCount(0);
  await expect(
    page.locator('[data-testid^="route-hit-route-base-"]'),
  ).toHaveCount(2);
  await expect(
    page.locator('[data-layer="junctions"] [data-node-kind="contact"]'),
  ).toHaveCount(1);

  await dragBy(page.getByTestId("hit-GND1"), { x: 40, y: 30 });
  const splitPaths = await page
    .locator('[data-testid^="route-hit-route-base-"]')
    .evaluateAll((elements) =>
      elements.map((element) =>
        Array.from((element as SVGPolylineElement).points).map((point) => ({
          x: point.x,
          y: point.y,
        })),
      ),
    );
  expect(splitPaths).toHaveLength(2);
  expect(
    splitPaths.every((points) =>
      points.slice(0, -1).every((point, index) => {
        const next = points[index + 1]!;
        return point.x === next.x || point.y === next.y;
      }),
    ),
  ).toBe(true);
  expect(splitPaths[0]!.at(-1)).toEqual(splitPaths[1]![0]);
});

test("connects every compatible pin crossed by one wire", async ({ page }) => {
  const project = createEmptyProject("wire-through-pins", "Wire through pins");
  const document = project.documents[0]!;
  document.instances.push(
    {
      id: "C1",
      symbolId: "capacitor",
      placement: {
        position: { x: 80, y: 120 },
        rotation: 0,
        mirror: "none",
      },
    },
    {
      id: "R1",
      symbolId: "resistor",
      placement: {
        position: { x: 120, y: 120 },
        rotation: 0,
        mirror: "none",
      },
    },
    {
      id: "GND1",
      symbolId: "ground",
      placement: {
        position: { x: 160, y: 110 },
        rotation: 0,
        mirror: "none",
      },
    },
  );
  document.nets.push({
    id: "net-ground",

    terminals: [{ instanceId: "GND1", pinName: "0" }],
  });
  document.connectivityEvidence.push({
    id: "claim-ground",
    kind: "name-claim",
    netId: "net-ground",
    name: "0",
    owner: { kind: "power-marker", objectId: "GND1" },
    scope: "global",
    powerDomain: "ground",
  });

  await page.goto("/editor");
  await page.getByTestId("project-file").setInputFiles({
    name: "wire-through-pins.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  const canvas = page.getByTestId("schematic-canvas");
  const screenPoints = await canvas.evaluate(
    (element, points) => {
      const matrix = (element as SVGSVGElement).getScreenCTM();
      if (!matrix) return null;
      return points.map((point) => {
        const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
        return { x: screen.x, y: screen.y };
      });
    },
    [
      { x: 40, y: 100 },
      { x: 200, y: 100 },
    ],
  );
  if (!screenPoints) throw new Error("Wire path is not measurable");

  await clickDrawTool(page, "wire");
  await page.mouse.click(screenPoints[0]!.x, screenPoints[0]!.y);
  await page.mouse.dblclick(screenPoints[1]!.x, screenPoints[1]!.y);

  await expect(page.getByTestId("status")).toContainText("Committed route");
  await expect(page.locator('[data-layer="routes"] polyline')).toHaveCount(4);
  await expect(
    page.locator('[data-layer="junctions"] [data-node-kind="contact"]'),
  ).toHaveCount(3);
  for (const terminalId of [
    "terminal-C1-1",
    "terminal-R1-1",
    "terminal-GND1-0",
  ]) {
    await expect(page.getByTestId(terminalId)).toBeVisible();
  }
});

test("double-click ends the wire even when it lands on another wire", async ({
  page,
}) => {
  await page.goto("/editor");
  const canvas = page.getByTestId("schematic-canvas");
  await clickDrawTool(page, "wire");

  await canvas.click({ position: { x: 200, y: 160 } });
  await canvas.dblclick({ position: { x: 420, y: 160 } });
  await expect(page.getByTestId("status")).toContainText("Committed route");

  // Finishing onto an existing wire commits on the first press; the second
  // press used to open a fresh wire at that spot, so drafting continued.
  await canvas.click({ position: { x: 260, y: 300 } });
  await canvas.dblclick({ position: { x: 320, y: 160 } });
  await expect(page.getByTestId("status")).toContainText("Wire finished");

  // Nothing is in progress, so a plain move draws no preview leg.
  await page.mouse.move(500, 500);
  await expect(page.getByTestId("status")).toContainText("Wire finished");
});

test("double-click preserves the previewed corner order from a transistor pin", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "pmos", { x: 700, y: 180 });
  const canvas = page.getByTestId("schematic-canvas");
  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-M1-D").click();

  // Automatic routing respects the drain's downward outward direction. The
  // reported failure previews this correctly, then swaps to horizontal-first
  // when the first click inside the double-click becomes a fixed waypoint.
  const target = { x: 360, y: 430 };
  await canvas.hover({ position: target });
  const preview = await page.getByTestId("wire-preview").evaluate((element) =>
    Array.from((element as SVGPolylineElement).points).map(({ x, y }) => ({
      x,
      y,
    })),
  );

  await canvas.dblclick({ position: target });
  await expect(page.getByTestId("status")).toContainText("Committed route");
  const committed = await readRoutePoints(page, await onlyRouteId(page));
  expect(committed).toEqual(preview);
});

test("dragging a wire previews the orthogonal path it will commit", async ({
  page,
}) => {
  await page.goto("/editor");
  await awaitEditorReady(page);
  await placeComponent(page, "resistor", { x: 260, y: 200 });
  const canvas = page.getByTestId("schematic-canvas");
  // A wire from a terminal out to a free end, drawn at a free angle: the
  // shape the report was about.
  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-R1-2").click();
  for (let step = 0; step < 3; step += 1) {
    await canvas.click({ button: "middle", position: { x: 380, y: 260 } });
  }
  await canvas.dblclick({ position: { x: 520, y: 300 } });
  await page.keyboard.press("Escape");

  const drawnPoints = async () => {
    const points = await page
      .locator('[data-layer="routes"] polyline')
      .first()
      .getAttribute("points");
    return (points ?? "")
      .trim()
      .split(/\s+/u)
      .map((pair) => pair.split(",").map(Number) as [number, number]);
  };
  const everyLegAxisAligned = (points: [number, number][]) =>
    points.every((point, index) => {
      if (index === 0) return true;
      const previous = points[index - 1]!;
      return point[0] === previous[0] || point[1] === previous[1];
    });

  const route = page.locator('[data-canvas-hit-kind="route"]').first();
  const box = (await route.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 20,
    box.y + box.height / 2 + 70,
    { steps: 8 },
  );
  // While the pointer is down the preview used to close back at the old free
  // end, drawing a triangle the editor never commits.
  const previewPoints = await drawnPoints();
  expect(everyLegAxisAligned(previewPoints)).toBe(true);
  await page.mouse.up();
  expect(everyLegAxisAligned(await drawnPoints())).toBe(true);
  expect(await drawnPoints()).toEqual(previewPoints);
});

test("cycles the corner from a middle press that drifts under the hand", async ({
  page,
}) => {
  await page.goto("/editor");
  const canvas = page.getByTestId("schematic-canvas");
  await clickDrawTool(page, "wire");
  await canvas.click({ position: { x: 200, y: 200 } });

  // Clicking a scroll wheel drags the hand a few pixels. That is a click, not
  // a pan, so the cycle still has to advance.
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 260, box.y + 240);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(box.x + 266, box.y + 245);
  await page.mouse.up({ button: "middle" });

  await expect(page.getByTestId("status")).toContainText("vertical first");
});

test("keeps the chosen corner shape when the wire tool is picked again", async ({
  page,
}) => {
  await page.goto("/editor");
  const canvas = page.getByTestId("schematic-canvas");
  await clickDrawTool(page, "wire");
  await canvas.click({ position: { x: 200, y: 200 } });
  for (let step = 0; step < 3; step += 1) {
    await canvas.click({ button: "middle", position: { x: 260, y: 240 } });
  }
  await expect(page.getByTestId("status")).toContainText("any angle");
  await canvas.dblclick({ position: { x: 430, y: 260 } });

  // Leaving the tool and coming back used to silently drop the choice, so a
  // diagonal had to be re-selected for every wire.
  await page.keyboard.press("Escape");
  await clickDrawTool(page, "wire");
  await canvas.click({ position: { x: 200, y: 340 } });
  await canvas.dblclick({ position: { x: 430, y: 400 } });

  const ids = await page.locator('[data-testid^="route-hit-"]').count();
  expect(ids).toBe(2);
  const points = await readRoutePoints(page, await lastRouteId(page));
  expect(points).toHaveLength(2);
  const dx = Math.abs(points[1]!.x - points[0]!.x);
  const dy = Math.abs(points[1]!.y - points[0]!.y);
  expect(dx).toBeGreaterThan(0);
  expect(dy).toBeGreaterThan(0);
  expect(dx).not.toBe(dy);
});
