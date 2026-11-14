// Drawing Wires with the wire tool: endpoints, free ends, corners, and taps
// and crossings on other Wires.

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { createEmptyProject } from "@icm/model";
import { serializeProject } from "@icm/project-protocol";
import { createRoutingDemoProject } from "../src/demos/routing-demo.js";
import {
  clickDrawTool,
  expectStatus,
  openProject,
  openProjectFile,
} from "./editor-fixtures.js";
import { placeComponent } from "./manual-editor-fixtures.js";
import {
  centre,
  clickRoute,
  onScreen,
  placedInstance,
  polylinePoints,
  readRoutePoints,
  routeIdOf,
} from "./canvas-fixtures.js";

async function onlyRouteId(page: Page): Promise<string> {
  const route = page.locator('[data-testid^="route-hit-"]');
  await expect(route).toHaveCount(1);
  return routeIdOf(route);
}

test("starts a free wire over a covered ADC pin and snaps when exposed", async ({
  page,
}) => {
  const project = createEmptyProject("hidden-pin", "Hidden ADC pin");
  project.documents[0]!.instances.push(
    placedInstance("ADC1", "adc", 200, 200),
    {
      ...placedInstance("ADC2", "adc", 240, 200),
      bodyFill: { kind: "background" },
    },
  );
  await openProject(page, serializeProject(project));
  const canvas = page.getByTestId("schematic-canvas");
  const coveredPin = page.getByTestId("terminal-ADC1-OUT");
  await expect(coveredPin).toHaveCount(0);
  await clickDrawTool(page, "wire");
  const [out] = await onScreen(canvas, [{ x: 240, y: 200 }]);
  await page.mouse.click(out.x, out.y);
  await expectStatus(page, "Wire source: free grid point");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("active-tool")).toHaveText("pointer");
  await page.mouse.click(out.x, out.y, { button: "right" });
  await page
    .getByRole("menuitem", { name: "Send to back", exact: true })
    .click();
  await clickDrawTool(page, "wire");
  await expect(coveredPin).toBeVisible();
  await coveredPin.click();
  await expectStatus(page, "Wire source: ADC1.OUT");
});

test("connects one MOS Gate to Drain without false contact ambiguity", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "nmos", { x: 480, y: 260 });
  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-M1-G").click();
  await page.getByTestId("terminal-M1-D").click();
  await expectStatus(page, "Committed route");
  await expect(page.locator('[data-layer="routes"] polyline')).toHaveCount(1);
  await expect(
    page.locator('[data-layer="junctions"] [data-node-kind="contact"]'),
  ).toHaveCount(0);
});

test("commits two endpoint clicks even before React publishes the first one, turning between the parts", async ({
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

  await expectStatus(page, "Committed route");
  await expect(page.locator('[data-layer="routes"] polyline')).toHaveCount(1);

  // Bottom pin to top pin, side by side: both single corners would run up or
  // down a part's own body, over the pin at its other end — a meeting the
  // netlist will not have, drawn as though it had. The wire turns in the gap
  // instead, and leaves each pin the way the drawer aimed.
  const points = await readRoutePoints(page, "route-ui-1");
  expect(points).toHaveLength(4);
  const [start, first, second, end] = points;
  expect(first!.y).toBe(start!.y);
  expect(second!.x).toBe(first!.x);
  expect(first!.x).toBeGreaterThan(start!.x);
  expect(first!.x).toBeLessThan(end!.x);
  // One Net, one conductor: nothing was picked up on the way.
  await expect(page.getByTestId("net-count")).toHaveText("1");
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
  await page.mouse.click(centre(labelBox).x, centre(labelBox).y);
  await expect(page.getByTestId("status")).toHaveText(
    "Wire source: free grid point",
  );
  await page.keyboard.press("Escape");

  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-R1-2").click();
  await page.getByTestId("terminal-R2-1").click();
  const routeId = await onlyRouteId(page);
  await expect(page.getByTestId("active-tool")).toHaveText("wire");
  await clickRoute(page, routeId, 0.5, 0, { x: 0, y: 5 });
  await expect(page.getByTestId("status")).toHaveText(
    `Wire source: route ${routeId}`,
  );
});

test("finishes a free wire at an arbitrary grid point and reuses that end as a later wire source", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 300, y: 200 });
  await placeComponent(page, "resistor", { x: 600, y: 300 });
  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-R1-2").click();
  const canvas = page.getByTestId("schematic-canvas");
  // A free bend, then a double-click on bare canvas ends the wire there.
  await canvas.click({ position: { x: 420, y: 240 } });
  await expect(page.getByTestId("wire-preview")).toBeVisible();
  await canvas.dblclick({ position: { x: 450, y: 320 } });
  await expect(page.locator('[data-layer="routes"] polyline')).toHaveCount(1);
  await expect(page.locator('[data-layer="junctions"] circle')).toHaveCount(0);
  expect(
    (await readRoutePoints(page, await onlyRouteId(page))).length,
  ).toBeGreaterThanOrEqual(4);
  await expect(page.getByTestId("active-tool")).toHaveText("wire");

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
  const continuationPreview = await polylinePoints(
    page.getByTestId("wire-preview"),
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
  await openProjectFile(page, project, "routing-example.icproj.json");

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
  await expectStatus(page, "Ambiguous connection");
  await expect(page.getByTestId("revision")).toHaveText("2");
  await page.keyboard.press("Escape");

  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-E-P").click();
  await clickRoute(page, "route-ui-1", 0.25, 0, { x: 0, y: 5 });
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
  await page.mouse.move(centre(handleBox).x, centre(handleBox).y);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + 45, handleBox.y + handleBox.height / 2, {
    steps: 3,
  });
  await page.mouse.up();
  await expect(page.getByTestId("revision")).toHaveText("4");
});

test("double-click ends the wire even when it lands on another wire", async ({
  page,
}) => {
  await page.goto("/editor");
  const canvas = page.getByTestId("schematic-canvas");
  await clickDrawTool(page, "wire");

  await canvas.click({ position: { x: 200, y: 160 } });
  await canvas.dblclick({ position: { x: 420, y: 160 } });
  await expectStatus(page, "Committed route");

  // Finishing onto an existing wire commits on the first press; the second
  // press used to open a fresh wire at that spot, so drafting continued.
  await canvas.click({ position: { x: 260, y: 300 } });
  await canvas.dblclick({ position: { x: 320, y: 160 } });
  await expectStatus(page, "Wire finished");

  // Nothing is in progress, so a plain move draws no preview leg.
  await page.mouse.move(500, 500);
  await expectStatus(page, "Wire finished");
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
  const preview = await polylinePoints(page.getByTestId("wire-preview"));

  await canvas.dblclick({ position: target });
  await expectStatus(page, "Committed route");
  const committed = await readRoutePoints(page, await onlyRouteId(page));
  expect(committed).toEqual(preview);
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
  await expectStatus(page, "any angle");
  await canvas.dblclick({ position: { x: 430, y: 260 } });

  // Leaving the tool and coming back used to silently drop the choice, so a
  // diagonal had to be re-selected for every wire.
  await page.keyboard.press("Escape");
  await clickDrawTool(page, "wire");
  await canvas.click({ position: { x: 200, y: 340 } });
  await canvas.dblclick({ position: { x: 430, y: 400 } });

  const ids = await page.locator('[data-testid^="route-hit-"]').count();
  expect(ids).toBe(2);
  const points = await readRoutePoints(
    page,
    await routeIdOf(page.locator('[data-testid^="route-hit-"]').last()),
  );
  expect(points).toHaveLength(2);
  const dx = Math.abs(points[1]!.x - points[0]!.x);
  const dy = Math.abs(points[1]!.y - points[0]!.y);
  expect(dx).toBeGreaterThan(0);
  expect(dy).toBeGreaterThan(0);
  expect(dx).not.toBe(dy);
});
