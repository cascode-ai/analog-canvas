import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { resolve } from "node:path";

import { createRoutingDemoProject } from "../src/demos/routing-demo.js";
import {
  chooseComponent,
  clickCommand,
  downloadBytes,
  openMenu,
} from "./editor-fixtures.js";

async function placeComponent(
  page: Page,
  symbolId: string,
  position: { x: number; y: number },
): Promise<void> {
  await chooseComponent(page, symbolId);
  await page.getByTestId("schematic-canvas").click({ position });
}

async function copySelectionAt(
  page: Page,
  position: { x: number; y: number },
): Promise<void> {
  const canvas = page.getByTestId("schematic-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas is not measurable");
  await page.keyboard.press("c");
  await page.mouse.move(box.x + position.x, box.y + position.y);
  await expect(page.getByTestId("copy-placement-preview")).toBeVisible();
  await canvas.click({ position });
  await expect(page.getByTestId("copy-placement-preview")).toHaveCount(0);
}

async function openSelectionShelf(page: Page): Promise<void> {
  const shelf = page.getByTestId("selection-shelf");
  await expect(shelf).toBeVisible();
  if ((await shelf.getAttribute("aria-expanded")) !== "true") {
    await shelf.click();
  }
}

async function closeSelectionShelf(page: Page): Promise<void> {
  const shelf = page.getByTestId("selection-shelf");
  if ((await shelf.getAttribute("aria-expanded")) === "true") {
    await shelf.click();
  }
}

async function clickRoute(
  page: Page,
  routeId: string,
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
      const local = new DOMPoint(
        first.x + (second.x - first.x) * options.position,
        first.y + (second.y - first.y) * options.position,
      );
      const screen = local.matrixTransform(matrix);
      return { x: screen.x, y: screen.y };
    },
    { position, segmentIndex },
  );
  if (!point) throw new Error(`Route ${routeId} is not measurable`);
  await page.mouse.click(point.x, point.y);
}

async function dragRouteSegment(
  page: Page,
  routeId: string,
  delta: { x: number; y: number },
  position = 0.5,
  segmentIndex = 0,
  duringDrag?: () => Promise<void>,
): Promise<void> {
  const route = page.getByTestId(`route-hit-${routeId}`);
  const point = await route.evaluate(
    (element, options) => {
      const polyline = element as SVGPolylineElement;
      const from = polyline.points.getItem(options.segmentIndex);
      const to = polyline.points.getItem(options.segmentIndex + 1);
      const matrix = polyline.getScreenCTM();
      if (!from || !to || !matrix) return null;
      return new DOMPoint(
        from.x + (to.x - from.x) * options.position,
        from.y + (to.y - from.y) * options.position,
      ).matrixTransform(matrix);
    },
    { position, segmentIndex },
  );
  if (!point) throw new Error(`Route ${routeId} is not measurable`);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + delta.x, point.y + delta.y, { steps: 4 });
  await duringDrag?.();
  await page.mouse.up();
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

async function readRoutePoints(page: Page, routeId: string) {
  return page.getByTestId(`route-hit-${routeId}`).evaluate((element) => {
    const polyline = element as SVGPolylineElement;
    return Array.from(polyline.points).map((point) => ({
      x: point.x,
      y: point.y,
    }));
  });
}

async function onlyRouteId(page: Page): Promise<string> {
  const route = page.locator('[data-testid^="route-hit-"]');
  await expect(route).toHaveCount(1);
  const testId = await route.getAttribute("data-testid");
  if (!testId) throw new Error("Route has no test id");
  return testId.replace(/^route-hit-/u, "");
}

async function instanceLabelVector(
  page: Page,
  instanceId: string,
): Promise<{ x: number; y: number }> {
  const instance = await page
    .locator(`[data-layer="symbols"] [data-object-id="${instanceId}"]`)
    .boundingBox();
  const label = await page
    .locator(
      `[data-layer="annotations"] [data-object-id="instance-label-${instanceId}"]`,
    )
    .boundingBox();
  if (!instance || !label) throw new Error("Instance label is not measurable");
  return {
    x: label.x + label.width / 2 - (instance.x + instance.width / 2),
    y: label.y + label.height / 2 - (instance.y + instance.height / 2),
  };
}

async function dragBy(
  locator: Locator,
  delta: { x: number; y: number },
): Promise<void> {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Drag target is not measurable");
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await locator.page().mouse.move(start.x, start.y);
  await locator.page().mouse.down();
  await locator.page().mouse.move(start.x + delta.x, start.y + delta.y, {
    steps: 4,
  });
  await locator.page().mouse.up();
}

test("shows faithful symbol previews for the reviewed Razavi palette", async ({
  page,
}) => {
  await page.goto("/");
  await page.keyboard.press("i");
  const dialog = page.getByRole("dialog", { name: "Insert Component" });
  const search = dialog.getByLabel("Component search");
  const preview = dialog.locator("svg.insert-symbol-artwork");
  for (const symbolId of [
    "capacitor",
    "current-source",
    "ground",
    "nmos",
    "pmos",
    "port",
    "port-filled",
    "resistor",
    "voltage-source",
    "vdd",
  ]) {
    await search.fill(symbolId);
    await dialog.getByTestId(`insert-component-${symbolId}`).click();
    await expect(preview).toBeVisible();
  }
  await search.fill("pmos");
  await dialog.getByTestId("insert-component-pmos").click();
  await expect(preview.locator("circle")).toHaveCount(0);
  await expect(preview.locator("polygon")).toHaveCount(3);
  await expect(dialog.getByTestId("insert-component-nmos3")).toHaveCount(0);
  await expect(dialog.getByTestId("insert-component-pmos3")).toHaveCount(0);
  await page.keyboard.press("Escape");
});

test("does not expose presentation-style switching in the browser", async ({
  page,
}) => {
  await page.goto("/");
  const toolbar = page.getByRole("navigation", { name: "Editor commands" });
  await expect(toolbar.locator("summary", { hasText: "Style" })).toHaveCount(0);
});

test("authors components and connectivity manually from an empty canvas", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("cell-navigation")).toHaveCount(0);
  await expect(page.getByTestId("revision")).toHaveText("0");

  await placeComponent(page, "resistor", { x: 340, y: 220 });
  await placeComponent(page, "nmos", { x: 560, y: 220 });
  await expect(page.getByTestId("hit-R1")).toBeVisible();
  await expect(page.getByTestId("hit-M2")).toBeVisible();
  await expect(page.getByTestId("terminal-M2-B")).toHaveCount(0);
  await expect(page.getByTestId("revision")).toHaveText("2");
  await expect(page.getByTestId("source-status")).toHaveText(
    "connectivity-modified",
  );

  await clickCommand(page, "Draw", "Wire (W)");
  await page.getByTestId("terminal-R1-2").click();
  await page.getByTestId("terminal-M2-G").click();
  await expect(page.getByTestId("revision")).toHaveText("3");
  await expect(page.locator('[data-layer="routes"] polyline')).toHaveCount(1);

  await page.getByTestId("terminal-R1-2").click({ button: "right" });
  await openSelectionShelf(page);
  await expect(
    page.getByRole("button", { name: "Disconnect endpoint" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Delete connection" }).click();
  await expect(page.locator('[data-layer="routes"] polyline')).toHaveCount(0);
  await expect(page.getByTestId("status")).toHaveText(
    "Deleted endpoint connection",
  );

  await page.keyboard.press("Control+z");
  await expect(page.locator('[data-layer="routes"] polyline')).toHaveCount(1);
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("revision")).toHaveText("6");
  await expect(page.locator('[data-layer="routes"] polyline')).toHaveCount(0);
});

test("keeps Wire input above labels and resolves a screen-tolerant route tap", async ({
  page,
}) => {
  await page.goto("/");
  await placeComponent(page, "resistor", { x: 340, y: 220 });
  await placeComponent(page, "resistor", { x: 660, y: 220 });

  await clickCommand(page, "Draw", "Wire (W)");
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

  await clickCommand(page, "Draw", "Wire (W)");
  await page.getByTestId("terminal-R1-2").click();
  await page.getByTestId("terminal-R2-1").click();
  const routeId = await onlyRouteId(page);
  await expect(page.getByTestId("active-tool")).toHaveText("pointer");
  await clickCommand(page, "Draw", "Wire (W)");
  await clickRouteWithScreenOffset(page, routeId, { x: 0, y: 5 });
  await expect(page.getByTestId("status")).toHaveText(
    `Wire source: route ${routeId}`,
  );
});

test("deletes a wire without exposing Unroute", async ({ page }) => {
  await page.goto("/");
  await placeComponent(page, "resistor", { x: 340, y: 220 });
  await placeComponent(page, "resistor", { x: 660, y: 220 });
  await clickCommand(page, "Draw", "Wire (W)");
  await page.getByTestId("terminal-R1-2").click();
  await page.getByTestId("terminal-R2-1").click();
  await expect(page.getByTestId("active-tool")).toHaveText("pointer");

  await clickRoute(page, "route-ui-1");
  await expect(page.getByTestId("status")).toContainText(
    "Selected route route-ui-1",
  );
  await page.keyboard.press("Delete");
  await expect(page.locator('[data-layer="routes"] polyline')).toHaveCount(0);
  await expect(page.getByTestId("flightline")).toHaveCount(0);
  await expect(page.getByTestId("status")).toContainText(
    "Deleted wire route-ui-1",
  );

  await page.keyboard.press("Control+z");
  await clickRoute(page, "route-ui-1");
  await openSelectionShelf(page);
  await expect(page.getByRole("button", { name: "Delete wire" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Unroute (keep electrical connection)" }),
  ).toHaveCount(0);
});

test("deletes a routed part of an imported Net that still has flightlines", async ({
  page,
}) => {
  const project = createRoutingDemoProject();
  const document = project.documents[0]!;
  document.sourceBinding = {
    cellName: "routing_demo",
    sourceRef: {
      fileId: "source-routing-demo",
      start: { offset: 0, line: 1, column: 1 },
      end: { offset: 1, line: 1, column: 2 },
    },
  };
  document.routes = [
    {
      id: "route-imported-partial",
      netId: "net-h",
      from: { kind: "terminal", instanceId: "A", pinName: "P" },
      to: { kind: "terminal", instanceId: "B", pinName: "P" },
      waypoints: [],
      segmentModes: ["manual"],
    },
  ];
  await page.goto("/");
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

  await page.getByTestId("hit-A").click();
  await expect(page.getByTestId("flightline")).toHaveCount(2);
});

test("uses a flightline as direct Wire guidance", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("project-file").setInputFiles({
    name: "routing-flightlines.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(createRoutingDemoProject())),
  });

  await expect(page.getByTestId("flightline")).toHaveCount(3);
  const hint = page.getByTestId("flightline-hit").first();
  await hint.click({ force: true });
  await expect(page.getByTestId("active-tool")).toHaveText("wire");
  await expect(page.getByTestId("status")).toContainText(
    "Wire source: flightline on",
  );

  await hint.click({ force: true });
  await expect(page.getByTestId("active-tool")).toHaveText("pointer");
  await expect(page.locator('[data-layer="routes"] polyline')).toHaveCount(1);
  await expect(page.getByTestId("flightline")).toHaveCount(2);
});

test("focuses imported flightlines on the selected Net", async ({ page }) => {
  const project = createRoutingDemoProject();
  project.documents[0]!.sourceBinding = {
    cellName: "routing_demo",
    sourceRef: {
      fileId: "source-routing-demo",
      start: { offset: 0, line: 1, column: 1 },
      end: { offset: 1, line: 1, column: 2 },
    },
  };
  await page.goto("/");
  await page.getByTestId("project-file").setInputFiles({
    name: "routing-imported.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });

  await expect(page.getByTestId("flightline")).toHaveCount(0);
  await page.getByTestId("hit-A").click();
  await expect(page.getByTestId("flightline")).toHaveCount(2);
  await page.getByTestId("hit-C").click();
  await expect(page.getByTestId("flightline")).toHaveCount(1);
});

test("turns an off-axis tap near a route bend into an exact junction", async ({
  page,
}) => {
  await page.goto("/");
  await placeComponent(page, "nmos", { x: 300, y: 260 });
  await placeComponent(page, "resistor", { x: 540, y: 160 });
  await placeComponent(page, "resistor", { x: 680, y: 360 });
  await clickCommand(page, "Draw", "Wire (W)");
  await page.getByTestId("terminal-M1-D").click();
  await page.getByTestId("terminal-R2-1").click();
  const points = await readRoutePoints(page, "route-ui-1");
  expect(points.length).toBeGreaterThanOrEqual(3);

  await clickCommand(page, "Draw", "Wire (W)");
  await page.getByTestId("terminal-R3-1").click();
  await clickRouteVertexWithScreenOffset(page, "route-ui-1", 1, {
    x: 3,
    y: 3,
  });
  await expect(page.locator('[data-layer="junctions"] circle')).toHaveCount(1);
});

test("keeps a selected MOS in its fixed Razavi three-terminal view", async ({
  page,
}) => {
  await page.goto("/");
  await placeComponent(page, "pmos", { x: 420, y: 260 });
  await expect(page.getByTestId("terminal-M1-B")).toHaveCount(0);

  await openSelectionShelf(page);
  await expect(
    page.getByRole("button", { name: "Show Bulk (4-terminal)" }),
  ).toHaveCount(0);
});

test("places free wire bends and finishes at an arbitrary grid point", async ({
  page,
}) => {
  await page.goto("/");
  await placeComponent(page, "resistor", { x: 300, y: 200 });
  await clickCommand(page, "Draw", "Wire (W)");
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
  await expect(page.getByTestId("active-tool")).toHaveText("pointer");
});

test("reuses a free wire endpoint as a later wire source", async ({ page }) => {
  await page.goto("/");
  await placeComponent(page, "resistor", { x: 300, y: 200 });
  await placeComponent(page, "resistor", { x: 600, y: 300 });
  await clickCommand(page, "Draw", "Wire (W)");
  await page.getByTestId("terminal-R1-2").click();
  await page
    .getByTestId("schematic-canvas")
    .dblclick({ position: { x: 450, y: 320 } });

  const freeEnd = page.locator('[data-testid^="junction-junction-ui-"]');
  await expect(freeEnd).toHaveCount(1);
  await clickCommand(page, "Draw", "Wire (W)");
  await freeEnd.click();
  await page.getByTestId("terminal-R2-1").click();

  await expect(page.locator('[data-testid^="route-hit-"]')).toHaveCount(2);
  await expect(page.getByTestId("active-tool")).toHaveText("pointer");
});

test("moves an isolated free wire as one route", async ({ page }) => {
  await page.goto("/");
  const canvas = page.getByTestId("schematic-canvas");
  await clickCommand(page, "Draw", "Wire (W)");
  await canvas.click({ position: { x: 420, y: 220 } });
  await canvas.dblclick({ position: { x: 620, y: 300 } });
  await expect(page.locator('[data-layer="junctions"] circle')).toHaveCount(0);

  const route = page.locator('[data-testid^="route-hit-"]');
  await expect(route).toHaveCount(1);
  const routeId = (await route.getAttribute("data-testid"))!.replace(
    "route-hit-",
    "",
  );
  const before = await readRoutePoints(page, routeId);
  await dragRouteSegment(page, routeId, { x: 120, y: 80 });
  const after = await readRoutePoints(page, routeId);
  const delta = {
    x: after[0]!.x - before[0]!.x,
    y: after[0]!.y - before[0]!.y,
  };
  expect(delta).not.toEqual({ x: 0, y: 0 });
  expect(
    after.map((point, index) => ({
      x: point.x - before[index]!.x,
      y: point.y - before[index]!.y,
    })),
  ).toEqual(after.map(() => delta));
});

test("stretches the pointed segment of a selected attached wire", async ({
  page,
}) => {
  await page.goto("/");
  await placeComponent(page, "resistor", { x: 300, y: 220 });
  await placeComponent(page, "resistor", { x: 540, y: 220 });
  await clickCommand(page, "Draw", "Wire (W)");
  await page.getByTestId("terminal-R1-2").click();
  await page.getByTestId("terminal-R2-1").click();

  const before = await readRoutePoints(page, "route-ui-1");
  await dragRouteSegment(page, "route-ui-1", { x: 0, y: 80 });
  const after = await readRoutePoints(page, "route-ui-1");
  expect(after[0]).toEqual(before[0]);
  expect(after.at(-1)).toEqual(before.at(-1));
  expect(
    after.some((point) => !before.some((prior) => prior.y === point.y)),
  ).toBe(true);
});

test("keeps direct device pin corners on-grid and deletes a selected junction", async ({
  page,
}) => {
  await page.goto("/");
  await placeComponent(page, "nmos", { x: 300, y: 260 });
  await placeComponent(page, "resistor", { x: 540, y: 160 });
  await clickCommand(page, "Draw", "Wire (W)");
  await page.getByTestId("terminal-M1-D").click();
  await page.getByTestId("terminal-R2-1").click();

  const terminalRoute = await readRoutePoints(page, "route-ui-1");
  expect(terminalRoute).toHaveLength(3);
  expect(terminalRoute[0]!.y).toBe(terminalRoute[1]!.y);
  expect(terminalRoute[1]!.x).toBe(terminalRoute[2]!.x);
  expect(
    terminalRoute.every(
      (point) => Math.abs(point.x % 10) === 0 && Math.abs(point.y % 10) === 0,
    ),
  ).toBe(true);

  await clickCommand(page, "Draw", "Wire (W)");
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

test("connects copied multi-pin groups through a manually bent wire", async ({
  page,
}) => {
  await page.goto("/");
  await placeComponent(page, "nmos", { x: 320, y: 180 });
  await placeComponent(page, "nmos", { x: 320, y: 360 });
  await clickCommand(page, "Draw", "Wire (W)");
  await page.getByTestId("terminal-M1-S").click();
  await page.getByTestId("terminal-M2-D").click();

  await page.keyboard.press("Control+a");
  await copySelectionAt(page, { x: 560, y: 300 });
  await expect(page.getByTestId("instance-count")).toHaveText("4");

  await page.reload();
  await openMenu(page, "File");
  await page.getByRole("button", { name: "Restore recovery" }).click();
  await expect(page.getByTestId("instance-count")).toHaveText("4");

  await clickCommand(page, "Draw", "Wire (W)");
  await page.getByTestId("terminal-M2-S").click();
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 460, y: 500 } });
  await page.getByTestId("terminal-M2-copy-1-S").click();

  await expect(page.getByTestId("status")).toContainText("Committed route");
  await expect(page.locator('[data-layer="routes"] polyline')).toHaveCount(3);
  await expect(page.getByTestId("active-tool")).toHaveText("pointer");
});

test("moves a selected wire segment and deletes a connected component safely", async ({
  page,
}) => {
  await page.goto("/");
  await placeComponent(page, "resistor", { x: 320, y: 220 });
  await placeComponent(page, "resistor", { x: 520, y: 220 });
  await clickCommand(page, "Draw", "Wire (W)");
  await page.getByTestId("terminal-R1-2").click();
  await page.getByTestId("terminal-R2-1").click();

  // Drag the exposed middle segment directly through the unified canvas
  // session; terminal escape segments remain covered by component hit targets.
  const before = await readRoutePoints(page, "route-ui-1");
  await dragRouteSegment(page, "route-ui-1", { x: 0, y: 80 });
  const after = await readRoutePoints(page, "route-ui-1");
  expect(after[0]).toEqual(before[0]);
  expect(after.at(-1)).toEqual(before.at(-1));
  expect(after).not.toEqual(before);

  await page.getByTestId("hit-R1").click();
  await openSelectionShelf(page);
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("instance-count")).toHaveText("1");
  await expect(page.locator('[data-layer="routes"] polyline')).toHaveCount(1);
  await expect(
    page.locator('[data-testid^="junction-junction-delete-"]'),
  ).toHaveCount(1);
  await expect(page.getByTestId("status")).toContainText(
    "connected wires remain dangling",
  );
});

test("moves internal wiring with a selected group and copies the routed subgraph", async ({
  page,
}) => {
  await page.goto("/");
  await placeComponent(page, "resistor", { x: 320, y: 220 });
  await placeComponent(page, "resistor", { x: 520, y: 220 });
  await clickCommand(page, "Draw", "Wire (W)");
  await page.getByTestId("terminal-R1-2").click();
  await page.getByTestId("terminal-R2-1").click();
  await clickRoute(page, "route-ui-1", 0.5, 0);
  await openSelectionShelf(page);
  await page.getByRole("button", { name: "Add current arrow" }).click();

  await page.keyboard.press("Control+a");
  await expect(page.getByTestId("selected-internal-route-count")).toHaveText(
    "1",
  );
  const before = await readRoutePoints(page, "route-ui-1");
  const firstBefore = await page.getByTestId("hit-R1").boundingBox();
  await dragRouteSegment(
    page,
    "route-ui-1",
    { x: 90, y: 70 },
    0.35,
    0,
    async () => {
      await expect(
        page.locator('[data-layer="routes"] [data-object-id="route-ui-1"]'),
      ).toHaveAttribute("transform", /translate/u);
      await expect(
        page.locator('[data-layer="symbols"] [data-object-id="R1"]'),
      ).toHaveAttribute("transform", /translate/u);
      await expect(
        page.locator('[data-layer="annotations"] [data-object-id="current-1"]'),
      ).toHaveAttribute("transform", /translate/u);
      await expect(page.getByTestId("revision")).toHaveText("4");
    },
  );
  const after = await readRoutePoints(page, "route-ui-1");
  const firstAfter = await page.getByTestId("hit-R1").boundingBox();
  const delta = {
    x: after[0]!.x - before[0]!.x,
    y: after[0]!.y - before[0]!.y,
  };
  expect(delta).not.toEqual({ x: 0, y: 0 });
  expect(
    after.map((point, index) => ({
      x: point.x - before[index]!.x,
      y: point.y - before[index]!.y,
    })),
  ).toEqual(after.map(() => delta));
  expect(firstAfter?.x).not.toBe(firstBefore?.x);
  expect(firstAfter?.y).not.toBe(firstBefore?.y);

  await copySelectionAt(page, { x: 640, y: 380 });
  await expect(page.getByTestId("instance-count")).toHaveText("4");
  await expect(page.getByTestId("net-count")).toHaveText("2");
  await expect(page.locator('[data-layer="routes"] polyline')).toHaveCount(2);
  await expect(page.getByTestId("selected-internal-route-count")).toHaveText(
    "1",
  );
});

test("keeps an internal junction with the live group preview", async ({
  page,
}) => {
  await page.goto("/");
  await placeComponent(page, "resistor", { x: 320, y: 220 });
  await placeComponent(page, "resistor", { x: 520, y: 220 });
  await placeComponent(page, "resistor", { x: 420, y: 420 });
  await clickCommand(page, "Draw", "Wire (W)");
  await page.getByTestId("terminal-R1-2").click();
  await page.getByTestId("terminal-R2-1").click();
  await clickCommand(page, "Draw", "Wire (W)");
  await clickRoute(page, "route-ui-1", 0.5, 0);
  await page.getByTestId("terminal-R3-1").click();

  const junctionHit = page.locator('[data-testid^="junction-"]').first();
  await expect(junctionHit).toBeVisible();
  const junctionId = await junctionHit.getAttribute("data-drag-object-id");
  if (!junctionId) throw new Error("Internal junction has no drag identity");
  const junctionBefore = await junctionHit.boundingBox();
  await page.keyboard.press("Control+a");
  const routeHit = page.locator('[data-testid^="route-hit-"]').first();
  const routeTestId = await routeHit.getAttribute("data-testid");
  if (!routeTestId) throw new Error("Internal route has no test id");
  const routeId = routeTestId.replace(/^route-hit-/u, "");
  await dragRouteSegment(page, routeId, { x: 76, y: 62 }, 0.35, 0, async () => {
    await expect(
      page.locator(`[data-object-id="${junctionId}"]`),
    ).toHaveAttribute("transform", /translate/u);
    await expect(page.getByTestId("revision")).toHaveText("5");
  });
  const junctionAfter = await junctionHit.boundingBox();
  expect(junctionAfter?.x).not.toBe(junctionBefore?.x);
  expect(junctionAfter?.y).not.toBe(junctionBefore?.y);
});

test("drags a current marker directly along and around its route", async ({
  page,
}) => {
  await page.goto("/");
  await placeComponent(page, "resistor", { x: 320, y: 220 });
  await placeComponent(page, "resistor", { x: 520, y: 220 });
  await clickCommand(page, "Draw", "Wire (W)");
  await page.getByTestId("terminal-R1-2").click();
  await page.getByTestId("terminal-R2-1").click();
  await clickRoute(page, "route-ui-1", 0.5, 0);
  await openSelectionShelf(page);
  await page.getByRole("button", { name: "Add current arrow" }).click();

  const hit = page.getByTestId("annotation-hit-current-1");
  await expect(hit).toHaveClass(/hit-target/u);
  await expect(hit).toHaveClass(/selected/u);
  await expect(
    page.getByRole("button", { name: "Move closer to wire" }),
  ).toHaveCount(0);
  const routeBefore = await readRoutePoints(page, "route-ui-1");
  const before = await hit.boundingBox();
  if (!before) throw new Error("Current marker is not measurable");
  const start = {
    x: before.x + before.width / 2,
    y: before.y + before.height / 2,
  };
  const paintedMarker = page.locator(
    '[data-layer="annotations"] [data-object-id="current-1"]',
  );
  const paintedBefore = await paintedMarker.boundingBox();
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 58, start.y + 24, { steps: 4 });
  await expect
    .poll(async () => (await paintedMarker.boundingBox())?.x)
    .not.toBe(paintedBefore?.x);
  await expect(page.getByTestId("revision")).toHaveText("4");
  await page.mouse.up();
  const after = await hit.boundingBox();
  expect(after?.x).not.toBe(before?.x);
  expect(after?.y).not.toBe(before?.y);
  expect(await readRoutePoints(page, "route-ui-1")).toEqual(routeBefore);
  await expect(page.getByTestId("revision")).toHaveText("5");

  await placeComponent(page, "resistor", { x: 420, y: 420 });
  const markerBeforeSplit = await hit.boundingBox();
  const projectBeforeSplit = JSON.parse(
    (await downloadBytes(page, "File", "Save Project")).toString("utf8"),
  );
  const markerDataBeforeSplit =
    projectBeforeSplit.documents[0].annotations.find(
      (annotation: { id: string }) => annotation.id === "current-1",
    );
  await clickCommand(page, "Draw", "Wire (W)");
  await clickRoute(page, "route-ui-1", 0.2, 0);
  await page.getByTestId("terminal-R3-1").click();
  const markerAfterSplit = await hit.boundingBox();
  const projectAfterSplit = JSON.parse(
    (await downloadBytes(page, "File", "Save Project")).toString("utf8"),
  );
  const markerDataAfterSplit = projectAfterSplit.documents[0].annotations.find(
    (annotation: { id: string }) => annotation.id === "current-1",
  );
  expect(markerDataAfterSplit.position).toEqual(markerDataBeforeSplit.position);
  expect(markerDataAfterSplit.anchor.routeId).not.toBe("route-ui-1");
  expect(markerAfterSplit?.x).toBeCloseTo(markerBeforeSplit?.x ?? 0, 0);
  expect(markerAfterSplit?.y).toBeCloseTo(markerBeforeSplit?.y ?? 0, 0);
  await expect(page.getByTestId("revision")).toHaveText("7");
});

test("moves an unselected component in one thresholded drag", async ({
  page,
}) => {
  await page.goto("/");
  await placeComponent(page, "resistor", { x: 320, y: 220 });
  const canvas = page.getByTestId("schematic-canvas");
  const hit = page.getByTestId("hit-R1");

  // Placement selects the new part; clear that convenience selection so this
  // is the same gesture a user makes in a dense, established schematic.
  await canvas.click({ position: { x: 760, y: 420 } });
  const before = await hit.boundingBox();
  if (!before) throw new Error("Component hit target is not measurable");
  const start = {
    x: before.x + before.width * 0.7,
    y: before.y + before.height * 0.6,
  };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 74, start.y + 53, { steps: 4 });
  await expect
    .poll(() =>
      page
        .locator('[data-layer="symbols"] [data-object-id="R1"]')
        .getAttribute("transform"),
    )
    .toContain("translate(");
  await expect(page.getByTestId("revision")).toHaveText("1");
  const during = await hit.boundingBox();
  expect(during?.x).not.toBe(before.x);
  expect(during?.y).not.toBe(before.y);
  await page.mouse.up();
  await expect(page.getByTestId("revision")).toHaveText("2");
});

test("keeps a transformed instance label at a constant distance while moving", async ({
  page,
}) => {
  await page.goto("/");
  await placeComponent(page, "resistor", { x: 320, y: 220 });
  await page.keyboard.press("Shift+r");
  await expect(page.getByTestId("revision")).toHaveText("2");

  const hit = page.getByTestId("hit-R1");
  const before = await instanceLabelVector(page, "R1");
  await dragBy(hit, { x: 83, y: 47 });
  const afterFirst = await instanceLabelVector(page, "R1");
  expect(afterFirst.x).toBeCloseTo(before.x, 3);
  expect(afterFirst.y).toBeCloseTo(before.y, 3);

  await dragBy(hit, { x: -51, y: 69 });
  const afterSecond = await instanceLabelVector(page, "R1");
  expect(afterSecond.x).toBeCloseTo(before.x, 3);
  expect(afterSecond.y).toBeCloseTo(before.y, 3);
  await expect(page.getByTestId("revision")).toHaveText("4");
});

test("selects an attached label without selecting its host", async ({
  page,
}) => {
  await page.goto("/");
  await placeComponent(page, "resistor", { x: 320, y: 220 });

  await page
    .getByTestId("annotation-hit-instance-label-R1")
    .click({ modifiers: ["Alt"] });
  await expect(
    page.getByTestId("annotation-hit-instance-label-R1"),
  ).toHaveClass(/hit-target/u);
  await expect(
    page.getByTestId("annotation-hit-instance-label-R1"),
  ).toHaveClass(/selected/u);
  await expect(page.getByTestId("selection-shelf")).toContainText(
    "instance-label-R1",
  );
});

test("moves an explicitly selected attached label", async ({ page }) => {
  await page.goto("/");
  await placeComponent(page, "resistor", { x: 320, y: 220 });

  // Text uses the same one-gesture threshold as a component.
  const label = page.getByTestId("annotation-hit-instance-label-R1");
  await expect(label).toBeVisible();
  // The placed component is initially selected and therefore owns an
  // overlapping drag. Alt cycles to the label once; subsequent drags remain
  // sticky to that explicit selection.
  await label.click({ modifiers: ["Alt"] });
  const before = await label.boundingBox();
  expect(before).not.toBeNull();

  await label.dragTo(page.getByTestId("schematic-canvas"), {
    targetPosition: { x: 470, y: 330 },
  });
  const after = await label.boundingBox();
  expect(after).not.toBeNull();
  expect(after!.x).not.toBe(before!.x);
  expect(after!.y).not.toBe(before!.y);
});

test("moves floating text after it is created", async ({ page }) => {
  await page.goto("/");
  await clickCommand(page, "Draw", "Text");
  await page
    .getByRole("textbox", { name: "Canvas text editor" })
    .fill("Floating note");
  await page.getByRole("button", { name: "Apply text changes" }).click();

  const note = page.locator('[data-testid^="drafting-hit-note-"]');
  await expect(note).toHaveCount(1);
  const before = await note.boundingBox();
  expect(before).not.toBeNull();
  await note.dragTo(page.getByTestId("schematic-canvas"), {
    targetPosition: { x: 650, y: 320 },
  });
  const after = await note.boundingBox();
  expect(after).not.toBeNull();
  expect(after!.x).not.toBe(before!.x);
  expect(after!.y).not.toBe(before!.y);
});

test("edits instance, electrical Net, and free text with bounded label handles", async ({
  page,
}) => {
  await page.goto("/");
  await placeComponent(page, "resistor", { x: 280, y: 180 });
  await placeComponent(page, "resistor", { x: 480, y: 180 });
  await clickCommand(page, "Draw", "Wire (W)");
  await page.getByTestId("terminal-R1-2").click();
  await page.getByTestId("terminal-R2-1").click();

  await page.getByTestId("hit-R1").click();
  await page.getByTestId("annotation-hit-instance-label-R1").dblclick();
  await page
    .getByRole("textbox", { name: "Canvas text editor" })
    .fill("R_LOAD");
  await page.getByRole("button", { name: "Apply text changes" }).click();
  // Canvas text editing preserves the exact user-authored instance label.
  await expect(page.locator('[data-layer="annotations"]')).toContainText(
    "R_LOAD",
  );

  await clickRoute(page, "route-ui-1", 0.5, 0);
  await openSelectionShelf(page);
  await page
    .getByRole("textbox", { name: "Electrical Net label" })
    .fill("SIGNAL");
  await page.getByRole("button", { name: "Apply Net label" }).click();
  await expect(page.locator('[data-layer="annotations"]')).toContainText(
    "SIGNAL",
  );
  await expect(
    page.getByTestId("annotation-hit-net-label-route-ui-1"),
  ).toBeVisible();
  await page.getByTestId("annotation-hit-net-label-route-ui-1").dblclick();
  const annotationEditor = page.getByRole("textbox", {
    name: "Canvas text editor",
  });
  await annotationEditor.fill("Vref");
  await annotationEditor.press("Control+a");
  await page.getByRole("button", { name: "Italic" }).click();
  await page.getByRole("button", { name: "Increase text size" }).click();
  await page.getByRole("button", { name: "Apply text changes" }).click();
  await expect(page.locator('[data-layer="annotations"]')).toContainText(
    "Vref",
  );
  await page.getByTestId("selection-shelf").click();

  await placeComponent(page, "resistor", { x: 280, y: 320 });
  await placeComponent(page, "resistor", { x: 480, y: 320 });
  await clickCommand(page, "Draw", "Wire (W)");
  await page.getByTestId("terminal-R3-2").click();
  await page.getByTestId("terminal-R4-1").click();
  await expect(page.getByTestId("net-count")).toHaveText("2");
  await clickRoute(page, "route-ui-2", 0.5, 0);
  await openSelectionShelf(page);
  await page
    .getByRole("textbox", { name: "Electrical Net label" })
    .fill("SIGNAL");
  await page.getByRole("button", { name: "Apply Net label" }).click();
  await expect(page.getByTestId("net-count")).toHaveText("1");
  await expect(page.getByTestId("status")).toHaveText(
    "Connected Nets through label SIGNAL",
  );

  await clickCommand(page, "Draw", "Text");
  const textInput = page.getByRole("textbox", {
    name: "Canvas text editor",
  });
  await textInput.fill("Matched pair");
  await page.getByRole("button", { name: "Apply text changes" }).click();
  await expect(page.locator('[data-layer="drafting"]')).toContainText(
    "Matched pair",
  );
  const noteHandle = page.locator('[data-testid^="drafting-hit-note-"]');
  const beforeBox = await noteHandle.boundingBox();
  if (!beforeBox) throw new Error("Text handle is not measurable");
  // Properties dock is in-flow on the right; close it and aim left of center.
  await closeSelectionShelf(page);
  await noteHandle.dragTo(page.getByTestId("schematic-canvas"), {
    targetPosition: { x: 360, y: 300 },
  });
  const afterBox = await noteHandle.boundingBox();
  expect(afterBox?.x).not.toBe(beforeBox.x);
});

test("L edits a selected route Net Label without opening Properties", async ({
  page,
}) => {
  await page.goto("/");
  await placeComponent(page, "resistor", { x: 280, y: 180 });
  await placeComponent(page, "resistor", { x: 480, y: 180 });
  await clickCommand(page, "Draw", "Wire (W)");
  await page.getByTestId("terminal-R1-2").click();
  await page.getByTestId("terminal-R2-1").click();

  await clickRoute(page, "route-ui-1", 0.5, 0);
  await page.keyboard.press("l");
  const editor = page.getByTestId("net-label-editor");
  await expect(editor).toBeVisible();
  await editor.getByRole("textbox", { name: "Net Label" }).fill("SIGNAL");
  await editor.getByRole("textbox", { name: "Net Label" }).press("Enter");
  await expect(page.locator('[data-layer="annotations"]')).toContainText(
    "SIGNAL",
  );

  await clickRoute(page, "route-ui-1", 0.5, 0);
  await page.keyboard.press("l");
  await editor.getByRole("textbox", { name: "Net Label" }).fill("VREF");
  await editor.getByRole("textbox", { name: "Net Label" }).press("Enter");
  await expect(page.locator('[data-layer="annotations"]')).toContainText(
    "VREF",
  );

  await clickRoute(page, "route-ui-1", 0.5, 0);
  await page.keyboard.press("l");
  await editor.getByRole("textbox", { name: "Net Label" }).fill("");
  await editor.getByRole("textbox", { name: "Net Label" }).press("Enter");
  await expect(
    page.getByTestId("annotation-hit-net-label-route-ui-1"),
  ).toHaveCount(0);

  await clickRoute(page, "route-ui-1", 0.5, 0);
  await page.keyboard.press("l");
  await editor.getByRole("textbox", { name: "Net Label" }).fill("CANCEL");
  await editor.getByRole("textbox", { name: "Net Label" }).press("Escape");
  await expect(
    page.getByTestId("annotation-hit-net-label-route-ui-1"),
  ).toHaveCount(0);
});

test("selects and moves multiple instances while viewport gestures stay transient", async ({
  page,
}) => {
  await page.goto("/");
  await placeComponent(page, "nmos", { x: 330, y: 180 });
  await placeComponent(page, "nmos", { x: 560, y: 180 });
  await expect(page.getByTestId("revision")).toHaveText("2");

  const first = await page.getByTestId("hit-M1").boundingBox();
  const second = await page.getByTestId("hit-M2").boundingBox();
  if (!first || !second) throw new Error("Instances are not measurable");
  await page.mouse.move(first.x - 15, first.y - 15);
  await page.mouse.down();
  await page.mouse.move(
    second.x + second.width + 15,
    second.y + second.height + 15,
    {
      steps: 5,
    },
  );
  await page.mouse.up();
  await openSelectionShelf(page);
  await expect(
    page.getByTestId("selection-shelf").getByText("M1, M2", { exact: true }),
  ).toBeVisible();
  await closeSelectionShelf(page);

  await page
    .getByTestId("hit-M1")
    .dragTo(page.getByTestId("schematic-canvas"), {
      targetPosition: { x: 360, y: 280 },
    });
  await expect(page.getByTestId("revision")).toHaveText("3");

  const canvas = page.getByTestId("schematic-canvas");
  const beforeViewBox = await canvas.getAttribute("viewBox");
  // Stay in the open canvas area (library + properties shrink usable width).
  await canvas.hover({ position: { x: 320, y: 280 } });
  await page.mouse.wheel(0, -120);
  await expect(canvas).not.toHaveAttribute("viewBox", beforeViewBox!);
  await expect(page.getByTestId("revision")).toHaveText("3");

  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) throw new Error("Canvas is not measurable");
  await page.mouse.move(canvasBox.x + 320, canvasBox.y + 280);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(canvasBox.x + 370, canvasBox.y + 320, { steps: 3 });
  await page.mouse.up({ button: "middle" });
  await expect(page.getByTestId("revision")).toHaveText("3");

  await page.keyboard.press("r");
  await expect(page.getByTestId("revision")).toHaveText("4");
});

test("R rotates a selected component instead of entering Rectangle", async ({
  page,
}) => {
  await page.goto("/");
  await placeComponent(page, "nmos", { x: 420, y: 260 });
  await expect(page.getByTestId("revision")).toHaveText("1");

  await page.getByTestId("hit-M1").click();
  await page.keyboard.press("r");

  await expect(page.getByTestId("revision")).toHaveText("2");
  await expect(page.locator('[data-kind="draft-rectangle"]')).toHaveCount(0);

  await page.keyboard.press("Shift+R");
  await expect(page.getByTestId("revision")).toHaveText("3");
  await page.keyboard.press("Shift+V");
  await expect(page.getByTestId("revision")).toHaveText("4");
});

test("C previews one copy and Escape cancels without a revision", async ({
  page,
}) => {
  await page.goto("/");
  await placeComponent(page, "resistor", { x: 360, y: 220 });
  await page.getByTestId("hit-R1").click();

  const canvas = page.getByTestId("schematic-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas is not measurable");
  await page.keyboard.press("c");
  await page.mouse.move(box.x + 560, box.y + 340);
  await expect(page.getByTestId("copy-placement-preview")).toBeVisible();
  await page.keyboard.press("Escape");

  await expect(page.getByTestId("copy-placement-preview")).toHaveCount(0);
  await expect(page.getByTestId("instance-count")).toHaveText("1");
  await expect(page.getByTestId("revision")).toHaveText("1");
  await expect(page.getByTestId("status")).toContainText(
    "Copy placement cancelled",
  );
});

test("derives crossings and creates junctions only when a wire ends on a route", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("project-file").setInputFiles({
    name: "routing-example.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(createRoutingDemoProject())),
  });

  await clickCommand(page, "Draw", "Wire (W)");
  await page.getByTestId("terminal-A-P").click();
  await page.getByTestId("terminal-B-P").click();
  await clickCommand(page, "Draw", "Wire (W)");
  await page.getByTestId("terminal-C-P").click();
  await page.getByTestId("terminal-D-P").click();
  await expect(page.getByTestId("crossing-count")).toHaveText("1");
  await expect(page.locator('[data-layer="junctions"] circle')).toHaveCount(0);

  await clickCommand(page, "Draw", "Wire (W)");
  await page.getByTestId("terminal-E-P").click();
  await clickRoute(page, "route-ui-1", 0.5);
  await expect(page.getByTestId("status")).toContainText(
    "Ambiguous intersection",
  );
  await expect(page.getByTestId("revision")).toHaveText("2");
  await page.keyboard.press("Escape");

  await clickCommand(page, "Draw", "Wire (W)");
  await page.getByTestId("terminal-E-P").click();
  await clickRouteWithScreenOffset(page, "route-ui-1", { x: 0, y: 5 }, 0.25);
  await expect(page.getByTestId("revision")).toHaveText("3");
  await expect(page.getByTestId("junction-junction-ui-3")).toBeVisible();
  await expect(page.getByTestId("crossing-count")).toHaveText("2");

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

test("rejects a SPICE netlist that needs unsupported symbols", async ({
  page,
}) => {
  await page.goto("/");
  await openMenu(page, "File");
  await page
    .getByTestId("spice-files")
    .setInputFiles([
      resolve(process.cwd(), "netlists/mixed-device-acceptance/circuit.spi"),
      resolve(process.cwd(), "netlists/mixed-device-acceptance/models.inc"),
    ]);

  await expect(page.getByTestId("status")).toContainText(
    "approved Razavi catalog has no symbol",
  );
  await expect(page.getByTestId("document-count")).toHaveText("1");
  await expect(page.getByTestId("instance-count")).toHaveText("0");
});

test("exports one formal visual scene as Project, SVG, PNG, and PDF", async ({
  page,
}) => {
  await page.goto("/");

  const projectBytes = await downloadBytes(page, "File", "Save Project");
  expect(JSON.parse(projectBytes.toString("utf8")).topDocumentId).toBeTruthy();
  const svg = (await downloadBytes(page, "File", "Export SVG")).toString(
    "utf8",
  );
  expect(svg).toContain('data-layer="formal"');
  expect(svg).not.toMatch(/selection|route-hit|editor-overlay/u);

  const png = await downloadBytes(page, "File", "Export PNG");
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const pdf = await downloadBytes(page, "File", "Export PDF");
  expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
});

test("uses automatic recovery and guards shortcuts while typing", async ({
  page,
}) => {
  await page.goto("/");
  await placeComponent(page, "resistor", { x: 360, y: 220 });
  await expect(page.getByTestId("revision")).toHaveText("1");
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("icm.recovery.v1")))
    .toContain('"revision": 1');

  await page.reload();
  await openMenu(page, "File");
  await page.getByRole("button", { name: "Restore recovery" }).click();
  await expect(page.getByTestId("revision")).toHaveText("1");

  await page.keyboard.press("i");
  const search = page.getByLabel("Component search");
  await search.fill("r");
  await page.keyboard.press("r");
  await expect(page.getByTestId("revision")).toHaveText("1");
});

test("keeps component insertion from resizing the canvas until Properties opens", async ({
  page,
}) => {
  await page.goto("/");
  const canvas = page.getByTestId("schematic-canvas");
  const beforePlaceCanvas = await canvas.boundingBox();
  if (!beforePlaceCanvas) throw new Error("Canvas is not measurable");

  await page.keyboard.press("i");
  await expect(
    page.getByRole("dialog", { name: "Insert Component" }),
  ).toBeVisible();
  expect((await canvas.boundingBox())?.width).toBe(beforePlaceCanvas.width);
  const dialog = page.getByRole("dialog", { name: "Insert Component" });
  await dialog.getByLabel("Component search").fill("pmos");
  await dialog.getByTestId("insert-component-pmos").click();
  await dialog.getByRole("button", { name: "Apply" }).click();

  await canvas.click({ position: { x: 420, y: 260 } });

  await expect(
    page.getByRole("complementary", { name: "Properties" }),
  ).toBeVisible();
  // Placement leaves Properties collapsed, so canvas width stays stable until
  // the dock is opened explicitly.
  expect((await canvas.boundingBox())?.width).toBe(beforePlaceCanvas.width);
  await page.getByTestId("selection-shelf").click();
  await expect(page.getByTestId("selection-shelf")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect
    .poll(
      async () =>
        (await canvas.boundingBox())?.width ?? beforePlaceCanvas.width,
    )
    .toBeLessThan(beforePlaceCanvas.width);

  await expect(page.getByTestId("selection-shelf")).toContainText("M1");
});

test("cancels pending recovery before save or project replacement", async ({
  page,
}) => {
  await page.goto("/");
  await placeComponent(page, "resistor", { x: 360, y: 220 });
  await expect(page.getByTestId("revision")).toHaveText("1");

  // Save clears the slot while a debounced write is pending. Waiting past the
  // debounce proves the old timer cannot recreate it.
  await downloadBytes(page, "File", "Save Project");
  await page.waitForTimeout(500);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("icm.recovery.v1")))
    .toBeNull();

  await placeComponent(page, "resistor", { x: 500, y: 220 });
  await expect(page.getByTestId("revision")).toHaveText("2");
  await page
    .getByTestId("project-file")
    .setInputFiles(
      resolve(
        process.cwd(),
        "fixtures/projects/phase-1-manual/project.icproj.json",
      ),
    );
  await expect(page.getByTestId("active-document-name")).toHaveText(
    "Manual Editor Demo",
  );
  await page.waitForTimeout(500);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("icm.recovery.v1")))
    .toBeNull();
});

test("discard recovery clears the recovery slot", async ({ page }) => {
  await page.goto("/");
  await placeComponent(page, "resistor", { x: 360, y: 220 });
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("icm.recovery.v1")))
    .toContain('"revision": 1');

  await page.reload();
  await clickCommand(page, "File", "Discard recovery");
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("icm.recovery.v1")))
    .toBeNull();
});

test("keeps the production command surface compact and publishes PWA metadata", async ({
  page,
}) => {
  await page.goto("/");
  const toolbar = page.getByRole("navigation", { name: "Editor commands" });
  for (const label of ["File", "Edit", "Draw", "More"]) {
    await expect(toolbar.locator("summary", { hasText: label })).toBeVisible();
  }
  await expect(toolbar.locator("summary", { hasText: "View" })).toHaveCount(0);
  await expect(toolbar.locator("summary", { hasText: "Style" })).toHaveCount(0);
  await expect(toolbar.locator("summary", { hasText: "Export" })).toHaveCount(
    0,
  );
  await clickCommand(page, "Draw", "Wire (W)");
  await expect(page.getByTestId("active-tool")).toHaveText("wire");
  await openMenu(page, "More");
  await expect(
    page.getByRole("button", { name: "Add current arrow" }),
  ).toHaveCount(0);
  for (const obsolete of [
    "Select",
    "Junction",
    "Crossing",
    "Stretch",
    "Detach",
  ]) {
    await expect(
      toolbar.getByRole("button", { name: obsolete, exact: true }),
    ).toHaveCount(0);
  }

  const manifest = await page
    .locator('link[rel="manifest"]')
    .getAttribute("href");
  expect(manifest).toBe("/manifest.webmanifest");
  expect(
    await (await page.request.get("/manifest.webmanifest")).json(),
  ).toMatchObject({
    name: "Interactive Circuit Maker",
    display: "standalone",
  });
});

test("shows first-party visitor analytics without tracking the dashboard itself", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("theme", "dark"));
  let dashboardTracked = false;
  await page.route("**/api/track", async (route) => {
    dashboardTracked = true;
    await route.fulfill({ status: 204 });
  });
  await page.route("**/api/analytics", async (route) => {
    const countries = [
      "CN",
      "US",
      "GB",
      "DE",
      "FR",
      "JP",
      "SG",
      "CA",
      "AU",
      "IN",
      "NZ",
    ].map((code, index) => ({ code, pv: 12 - index, uv: 11 - index }));
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        generatedAt: "2026-08-12T00:00:00.000Z",
        totals: { pv: 12, uv: 7 },
        today: { date: "2026-08-12", pv: 3, uv: 2 },
        days: [
          { date: "2026-05-15", pv: 1, uv: 1 },
          { date: "2026-08-12", pv: 3, uv: 2 },
        ],
        countries,
        points: [{ lat: 40, lng: 116, count: 8 }],
        paths: [{ path: "/", pv: 12, uv: 7 }],
        sources: [{ source: "direct-or-unknown", pv: 12, uv: 7 }],
        breakdownStartedAt: "2026-08-12T00:00:00.000Z",
        breakdownTotals: {
          countries: { pv: 12, uv: 7 },
          sources: { pv: 12, uv: 7 },
          pages: { pv: 12, uv: 7 },
        },
      }),
    });
  });

  await page.goto("/analytics");
  await expect(page.getByRole("heading", { name: "Analytics" })).toBeVisible();
  await expect(page).toHaveTitle("Analytics — Analog Canvas");
  await expect(
    page.getByRole("link", { name: "Back to editor" }),
  ).toHaveAttribute("href", "/");
  await expect(page.getByRole("textbox", { name: "From" })).toHaveValue(
    "2026-05-15",
  );
  await expect(
    page.getByRole("textbox", { name: "To", exact: true }),
  ).toHaveValue("2026-08-12");
  await expect(
    page.getByRole("button", { name: "Last 90 days" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "ISO 3166 Code" }),
  ).toBeVisible();
  await expect(page.getByText("China")).toBeVisible();
  await expect(page.getByText("New Zealand")).toHaveCount(0);
  await page.getByRole("button", { name: "Show all 11" }).click();
  await expect(page.getByText("New Zealand")).toBeVisible();

  const themeSwitch = page.getByRole("button", {
    name: "Switch to light theme",
  });
  await themeSwitch.click();
  await expect(page.locator("html")).toHaveClass(/light/);
  await expect(
    page.getByRole("button", { name: "Switch to dark theme" }),
  ).toBeVisible();
  expect(dashboardTracked).toBe(false);
});

test("dismisses a command menu on outside click or Escape", async ({
  page,
}) => {
  await page.goto("/");
  const fileMenu = await openMenu(page, "File");
  await expect(fileMenu).toHaveAttribute("open", "");

  await page.getByRole("heading", { name: "Circuit Maker" }).click();
  await expect(fileMenu).not.toHaveAttribute("open", "");

  await openMenu(page, "File");
  await page.keyboard.press("Escape");
  await expect(fileMenu).not.toHaveAttribute("open", "");
});

test("selecting an object does not open Properties or reflow the canvas", async ({
  page,
}) => {
  await page.goto("/");
  const canvas = page.getByTestId("schematic-canvas");
  const widthBefore = (await canvas.boundingBox())!.width;

  // Placement selects the instance but leaves Properties collapsed. Canvas
  // width must stay constant until the user explicitly opens the dock.
  await placeComponent(page, "resistor", { x: 280, y: 180 });
  await expect(page.getByTestId("hit-R1")).toBeVisible();
  await expect(page.getByTestId("selection-shelf")).toHaveAttribute(
    "aria-expanded",
    "false",
  );

  const widthAfter = (await canvas.boundingBox())!.width;
  expect(widthAfter).toBe(widthBefore);
});
