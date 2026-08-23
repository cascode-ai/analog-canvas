import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { resolve } from "node:path";
import { createEmptyProject } from "@icm/model";

import { createRoutingDemoProject } from "../src/demos/routing-demo.js";
import {
  chooseComponent,
  clickCommand,
  clickDrawTool,
  downloadBytes,
  emulateDownloadOnlyBrowser,
  openMenu,
  readRecoveryRecords,
  recoveryProjectTexts,
} from "./editor-fixtures.js";

function markRoutingDemoNetsImported(
  project: ReturnType<typeof createRoutingDemoProject>,
): void {
  for (const net of project.documents[0]!.nets) {
    net.origin = { kind: "spice-import", sourceNetIds: [net.id] };
  }
}

test.beforeEach(async ({ page }) => {
  await emulateDownloadOnlyBrowser(page);
});

test("opens netlist preflight and navigates its canonical finding", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 360, y: 240 });
  await clickCommand(page, "Netlist", "Run Preflight…");
  const dialog = page.getByRole("dialog", { name: "Netlist Preflight" });
  await expect(dialog).toContainText("blocking issue");
  await dialog
    .getByRole("button", { name: /MISSING_PIN_NET/u })
    .first()
    .click();
  await expect(page.getByTestId("active-document-name")).toHaveText("Main");
  await expect(page.getByTestId("status")).toContainText("Preflight:");
  await expect(dialog).toBeVisible();
});

test("previews a validated structural netlist in both export dialects", async ({
  page,
}) => {
  await page.goto("/editor");
  await clickCommand(page, "Netlist", "Run Preflight…");
  const dialog = page.getByRole("dialog", { name: "Netlist Preflight" });
  const preview = dialog.getByTestId("netlist-preview");
  await expect(preview).toContainText(".subckt Main");
  await dialog.getByLabel("Netlist export format").selectOption("spectre");
  await expect(preview).toContainText("simulator lang=spectre");
});

async function placeComponent(
  page: Page,
  symbolId: string,
  position: { x: number; y: number },
): Promise<void> {
  await chooseComponent(page, symbolId);
  await page.getByTestId("schematic-canvas").click({ position });
  await page.keyboard.press("Escape");
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
  await expect(page.getByTestId("copy-placement-preview")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("copy-placement-preview")).toHaveCount(0);
}

async function openSelectionShelf(page: Page): Promise<void> {
  const shelf = page.getByTestId("selection-shelf");
  await expect(shelf).toBeVisible();
  if ((await shelf.getAttribute("aria-expanded")) !== "true") {
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
      `[data-layer="editor-overlay"] [data-testid="annotation-hit-instance-label-${instanceId}"]`,
    )
    .boundingBox();
  if (!instance || !label) throw new Error("Instance label is not measurable");
  return {
    x: label.x + label.width / 2 - (instance.x + instance.width / 2),
    y: label.y + label.height / 2 - (instance.y + instance.height / 2),
  };
}

async function closeSelectionShelf(page: Page): Promise<void> {
  const shelf = page.getByTestId("selection-shelf");
  if ((await shelf.getAttribute("aria-expanded")) === "true") {
    await shelf.click();
  }
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
  await page.goto("/editor");
  await page.keyboard.press("i");
  const dialog = page.getByRole("dialog", { name: "Insert Component" });
  const search = dialog.getByLabel("Component search");
  const preview = dialog.locator("svg.insert-symbol-artwork");
  // Browser coverage owns dialog-to-preview wiring. Catalogue completeness and
  // every symbol's geometry are covered by the symbol contract and goldens.
  for (const symbolId of ["pmos", "resistor"]) {
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

test("constructs VDD as a drawn dotless power rail", async ({ page }) => {
  await page.goto("/editor");
  await page.getByTestId("shapes-chip-vdd").click();
  const canvas = page.getByTestId("schematic-canvas");

  await canvas.hover({ position: { x: 180, y: 120 } });
  await expect(page.getByTestId("component-placement-preview")).toBeVisible();
  await canvas.click({ position: { x: 180, y: 120 } });
  await canvas.hover({ position: { x: 520, y: 120 } });
  const preview = page.getByTestId("vdd-rail-preview");
  await expect(preview).toHaveAttribute("stroke-width", "3.24");
  expect(
    await preview.evaluate(
      (element) => element.getAttribute("x1") !== element.getAttribute("x2"),
    ),
  ).toBe(true);
  await canvas.click({ position: { x: 520, y: 120 } });

  await expect(page.getByTestId("route-hit-route-vdd1-rail")).toHaveCount(1);
  await expect(
    canvas.locator('[data-object-id="route-vdd1-rail"]'),
  ).toHaveAttribute("data-route-presentation", "power-rail");
  await expect(
    canvas.locator('[data-object-id="junction-vdd1-start"]'),
  ).toHaveCount(0);
  await expect(page.getByTestId("hit-VDD1")).toHaveCount(0);
  await expect(canvas.locator('[data-symbol-id="vdd"]')).toHaveCount(0);
  await expect(canvas.getByText("VDD", { exact: true })).toHaveCount(1);
  await expect(page.getByTestId("component-input-plane")).toHaveCount(0);

  await page.keyboard.press("Delete");
  await expect(page.getByTestId("route-hit-route-vdd1-rail")).toHaveCount(0);
  await expect(canvas.getByText("VDD", { exact: true })).toHaveCount(0);
});

test("keeps a tapped VDD rail movable and stretchable as one supply bar", async ({
  page,
}) => {
  await page.goto("/editor");
  const canvas = page.getByTestId("schematic-canvas");
  await page.getByTestId("shapes-chip-vdd").click();
  await canvas.click({ position: { x: 180, y: 120 } });
  await canvas.click({ position: { x: 520, y: 120 } });
  await placeComponent(page, "resistor", { x: 360, y: 300 });

  await clickDrawTool(page, "wire");
  await clickRoute(page, "route-vdd1-rail");
  await page.locator('[data-testid^="terminal-R"][data-testid$="-1"]').click();
  await page.keyboard.press("Escape");

  const railHits = page.locator('[data-testid^="route-hit-route-vdd1-rail"]');
  await expect(railHits).toHaveCount(2);
  const selectedTestId = await railHits.first().getAttribute("data-testid");
  if (!selectedTestId) throw new Error("Tapped VDD rail is not selectable");
  const selectedRailId = selectedTestId.replace(/^route-hit-/u, "");
  const railIds = await railHits.evaluateAll((elements) =>
    elements.map((element) =>
      element.getAttribute("data-testid")!.replace(/^route-hit-/u, ""),
    ),
  );
  const beforeMove = await Promise.all(
    railIds.map((id) => readRoutePoints(page, id)),
  );

  await clickRoute(page, selectedRailId);
  await dragBy(page.getByTestId(`route-handle-${selectedRailId}`), {
    x: 30,
    y: 40,
  });
  await expect(page.getByTestId("status")).toContainText("Moved Power Rail");
  const afterMove = await Promise.all(
    railIds.map((id) => readRoutePoints(page, id)),
  );
  expect(Math.min(...afterMove.flat().map((point) => point.y))).toBeGreaterThan(
    Math.min(...beforeMove.flat().map((point) => point.y)),
  );

  const beforeResizeRight = Math.max(
    ...afterMove.flat().map((point) => point.x),
  );
  await dragBy(page.getByTestId("junction-junction-vdd1-end"), {
    x: 80,
    y: 0,
  });
  await expect(page.getByTestId("status")).toContainText("Resized Power Rail");
  const afterResize = await Promise.all(
    railIds.map((id) => readRoutePoints(page, id)),
  );
  expect(
    Math.max(...afterResize.flat().map((point) => point.x)),
  ).toBeGreaterThan(beforeResizeRight);
});

test("initializes PMOS bulk from the first explicitly drawn VDD rail", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "pmos", { x: 360, y: 260 });
  await page.getByTestId("shapes-chip-vdd").click();
  const canvas = page.getByTestId("schematic-canvas");
  await canvas.click({ position: { x: 240, y: 100 } });
  await canvas.click({ position: { x: 520, y: 100 } });
  await page.keyboard.press("Escape");

  const saved = JSON.parse(
    (await downloadBytes(page, "File", "Save Project")).toString("utf8"),
  ) as {
    documents: Array<{
      mosBulkDefaults?: { pmosNetId?: string };
      nets: Array<{
        id: string;
        powerDomain?: string;
        terminals: Array<{ instanceId: string; pinName: string }>;
      }>;
      routes: Array<{ netId: string; presentation?: string }>;
    }>;
  };
  const document = saved.documents[0]!;
  const vddNets = document.nets.filter((net) => net.powerDomain === "vdd");
  expect(vddNets).toEqual([
    expect.objectContaining({
      id: "net-power-vdd1",
      terminals: [{ instanceId: "M1", pinName: "B" }],
    }),
  ]);
  expect(document.mosBulkDefaults?.pmosNetId).toBe("net-power-vdd1");
  expect(document.routes).toContainEqual(
    expect.objectContaining({
      netId: "net-power-vdd1",
      presentation: "power-rail",
    }),
  );
});

test("cancels VDD rail placement before or after its first endpoint", async ({
  page,
}) => {
  await page.goto("/editor");
  const canvas = page.getByTestId("schematic-canvas");

  await page.getByTestId("shapes-chip-vdd").click();
  await canvas.hover({ position: { x: 180, y: 120 } });
  await expect(page.getByTestId("component-placement-preview")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("component-input-plane")).toHaveCount(0);

  await page.getByTestId("shapes-chip-vdd").click();
  await canvas.click({ position: { x: 180, y: 120 } });
  await canvas.hover({ position: { x: 520, y: 120 } });
  await expect(page.getByTestId("vdd-rail-preview")).toHaveAttribute(
    "stroke-width",
    "3.24",
  );
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("vdd-rail-preview")).toHaveCount(0);
  await expect(
    page.locator('[data-route-presentation="power-rail"]'),
  ).toHaveCount(0);
});

test("command move follows the pointer and commits on one click", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 340, y: 220 });
  const resistor = page.getByTestId("hit-R1");
  await resistor.click();
  const before = await resistor.boundingBox();
  if (!before) throw new Error("Placed resistor is not measurable");

  await page.keyboard.press("m");
  await expect(page.getByTestId("status")).toContainText("Move:");
  await page.mouse.move(before.x + 40, before.y + 20);
  await page.mouse.click(before.x + 40, before.y + 20);

  const after = await resistor.boundingBox();
  if (!after) throw new Error("Moved resistor is not measurable");
  expect(after.x).toBeGreaterThan(before.x + 20);
});

test("Port shortcut starts ordinary component placement", async ({ page }) => {
  await page.goto("/editor");
  const canvas = page.getByTestId("schematic-canvas");
  await page.keyboard.press("p");
  // No setup dialog: the shortcut goes straight to the placement cursor.
  await expect(
    page.getByRole("dialog", { name: "Place Net Port" }),
  ).toHaveCount(0);
  await canvas.hover({ position: { x: 320, y: 180 } });
  await expect(page.getByTestId("component-placement-preview")).toBeVisible();
  await canvas.click({ position: { x: 320, y: 180 } });
  await expect(page.getByTestId("status")).toContainText(
    "Added Free Net Port Vin",
  );
  await expect(page.getByTestId("hit-P1")).toBeVisible();
  await expect(
    page.locator(
      '[data-object-id="instance-label-P1"] [style*="font-style:italic;font-weight:700"]',
    ),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await openSelectionShelf(page);
  await expect(
    page.getByRole("region", { name: "Routing guidance" }),
  ).toHaveCount(0);
});

test("Free Net Ports merge by name and release their final Net lifecycle", async ({
  page,
}) => {
  await page.goto("/editor");
  const canvas = page.getByTestId("schematic-canvas");

  const placeNamedPort = async (
    name: string,
    position: { x: number; y: number },
  ) => {
    await page.keyboard.press("p");
    await canvas.click({ position });
    await page.keyboard.press("Escape");
    await openSelectionShelf(page);
    const nameField = page.getByLabel("Net Port name");
    await nameField.fill(name);
    await nameField.blur();
  };

  await placeNamedPort("BUS", { x: 260, y: 180 });
  await placeNamedPort("bus", { x: 460, y: 180 });

  let saved = JSON.parse(
    (await downloadBytes(page, "File", "Save Project")).toString("utf8"),
  ) as {
    documents: Array<{
      nets: Array<{
        name?: string;
        terminals: Array<{ instanceId: string; pinName: string }>;
      }>;
    }>;
  };
  expect(saved.documents[0]!.nets).toEqual([
    expect.objectContaining({
      name: "BUS",
      terminals: expect.arrayContaining([
        { instanceId: "P1", pinName: "P" },
        { instanceId: "P2", pinName: "P" },
      ]),
    }),
  ]);

  await page.getByTestId("hit-P1").click();
  await page.keyboard.press("Delete");
  await page.getByTestId("hit-P2").click();
  await page.keyboard.press("Delete");

  saved = JSON.parse(
    (await downloadBytes(page, "File", "Save Project")).toString("utf8"),
  ) as typeof saved;
  expect(saved.documents[0]!.nets).toEqual([]);

  await placeNamedPort("BUS", { x: 360, y: 260 });
  await expect(page.getByTestId("hit-P1")).toBeVisible();
});

test("Ctrl+D deselects without allowing browser bookmarking", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 340, y: 220 });
  await page.getByTestId("hit-R1").click();
  await page.keyboard.press("Control+d");
  await expect(page.getByTestId("status")).toHaveText("Selection cleared");
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("hit-R1")).toBeVisible();
});

test("Ctrl+R mirrors a selected component instead of refreshing", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "nmos", { x: 340, y: 220 });
  await page.getByTestId("hit-M1").click();
  await page.keyboard.press("Control+r");
  const saved = JSON.parse(
    (await downloadBytes(page, "File", "Save Project")).toString("utf8"),
  );
  expect(saved.documents[0].instances[0].placement).toMatchObject({
    rotation: 180,
    mirror: "x",
  });
});

test("treats hollow and filled Ports as ordinary wired components", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 460, y: 240 });
  await placeComponent(page, "port", { x: 260, y: 220 });
  await placeComponent(page, "port-filled", { x: 260, y: 300 });

  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-P1-P").click();
  await page.getByTestId("terminal-R1-1").click();
  await page.keyboard.press("Escape");
  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-P2-P").click();
  await page.getByTestId("terminal-R1-2").click();
  await page.keyboard.press("Escape");

  await expect(page.locator('[data-testid^="route-hit-"]')).toHaveCount(2);
  await dragBy(page.getByTestId("hit-P1"), { x: 40, y: 0 });
  await dragBy(page.getByTestId("hit-P2"), { x: 40, y: 20 });
  await expect(page.locator('[data-testid^="route-hit-"]')).toHaveCount(2);

  await page.getByTestId("hit-P1").click();
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("hit-P1")).toHaveCount(0);
  await page.getByTestId("hit-P2").click();
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("hit-P2")).toHaveCount(0);
  const saved = JSON.parse(
    (await downloadBytes(page, "File", "Save Project")).toString("utf8"),
  ) as {
    documents: Array<{
      nets: Array<{ terminals: Array<{ instanceId: string }> }>;
      routes: Array<{
        from: { kind: string; instanceId?: string };
        to: { kind: string; instanceId?: string };
      }>;
    }>;
  };
  const document = saved.documents[0]!;
  expect(
    document.nets
      .flatMap((net) => net.terminals)
      .map((item) => item.instanceId),
  ).not.toEqual(expect.arrayContaining(["P1", "P2"]));
  expect(
    document.routes.flatMap((route) => [route.from, route.to]),
  ).not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({ instanceId: "P1" }),
      expect.objectContaining({ instanceId: "P2" }),
    ]),
  );
});

test("authors components and connectivity manually from an empty canvas", async ({
  page,
}) => {
  await page.goto("/editor");
  // A flat Project has no hierarchy to navigate, so that row stays hidden.
  await expect(page.getByTestId("cell-navigation")).toHaveCount(0);
  await expect(page.getByTestId("revision")).toHaveText("0");

  await placeComponent(page, "resistor", { x: 340, y: 220 });
  await placeComponent(page, "nmos", { x: 560, y: 220 });
  await expect(page.getByTestId("hit-R1")).toBeVisible();
  await expect(page.getByTestId("hit-M1")).toBeVisible();
  await expect(page.getByTestId("terminal-M1-B")).toHaveCount(0);
  await expect(page.getByTestId("revision")).toHaveText("2");
  await expect(page.getByTestId("source-status")).toHaveText(
    "connectivity-modified",
  );

  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-R1-2").click();
  await page.getByTestId("terminal-M1-G").click();
  await expect(page.getByTestId("revision")).toHaveText("3");
  await expect(page.locator('[data-layer="routes"] polyline')).toHaveCount(1);
  await page.keyboard.press("Escape");

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
  await expect(page.locator('[data-layer="routes"] polyline')).toHaveCount(2);
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

test("deletes a wire without exposing Unroute", async ({ page }) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 340, y: 220 });
  await placeComponent(page, "resistor", { x: 660, y: 220 });
  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-R1-2").click();
  await page.getByTestId("terminal-R2-1").click();
  await expect(page.getByTestId("active-tool")).toHaveText("wire");
  await page.keyboard.press("Escape");

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

test("keeps Wire active for consecutive independent routes until Escape", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 280, y: 180 });
  await placeComponent(page, "resistor", { x: 520, y: 180 });
  await placeComponent(page, "resistor", { x: 280, y: 360 });
  await placeComponent(page, "resistor", { x: 520, y: 360 });

  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-R1-2").click();
  await page.getByTestId("terminal-R2-1").click();
  await expect(page.getByTestId("active-tool")).toHaveText("wire");
  await page.getByTestId("terminal-R3-2").click();
  await page.getByTestId("terminal-R4-1").click();

  await expect(page.locator('[data-layer="routes"] polyline')).toHaveCount(2);
  await expect(page.getByTestId("active-tool")).toHaveText("wire");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("active-tool")).toHaveText("pointer");
});

test("re-derives guidance after manually deleting an imported Route", async ({
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
    {
      id: "route-imported-partial",
      netId: "net-h",
      from: { kind: "terminal", instanceId: "A", pinName: "P" },
      to: { kind: "terminal", instanceId: "B", pinName: "P" },
      waypoints: [],
      segmentModes: ["manual"],
    },
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
    "geometry-only-changed",
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
  project.documents[0]!.routes.push({
    id: "route-imported-h",
    netId: "net-h",
    from: { kind: "terminal", instanceId: "A", pinName: "P" },
    to: { kind: "terminal", instanceId: "B", pinName: "P" },
    waypoints: [],
    segmentModes: ["manual"],
  });
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

test("keeps a selected MOS in its fixed Razavi three-terminal view", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "pmos", { x: 420, y: 260 });
  await expect(page.getByTestId("terminal-M1-B")).toHaveCount(0);

  await openSelectionShelf(page);
  await expect(
    page.getByRole("button", { name: "Show Bulk (4-terminal)" }),
  ).toHaveCount(0);
});

test("leads the Bulk section with its draw action", async ({ page }) => {
  await page.goto("/editor");
  await placeComponent(page, "nmos", { x: 360, y: 220 });
  await page.getByTestId("hit-M1").click();
  await openSelectionShelf(page);

  const bulk = page.getByLabel("MOS bulk connection");
  await expect(bulk.getByTestId("draw-bulk-connection")).toBeVisible();
  // The action is the reason the section is open, so it must precede the
  // default-Net selects rather than trail them.
  const order = await bulk.evaluate((section) =>
    [...section.querySelectorAll("button, select")].map(
      (element) => element.getAttribute("data-testid") ?? element.tagName,
    ),
  );
  expect(order[0]).toBe("draw-bulk-connection");

  // Bulk is the first section in the panel, not buried under the tray.
  const firstSection = await page
    .locator(".selection-panel section")
    .first()
    .getAttribute("aria-label");
  expect(firstSection).toBe("MOS bulk connection");
});

test("initializes NMOS bulk from the first explicitly placed Ground", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "nmos", { x: 360, y: 220 });
  await placeComponent(page, "ground", { x: 620, y: 280 });

  await page.getByTestId("hit-M1").click();
  await openSelectionShelf(page);
  await expect(page.getByLabel("MOS bulk connection")).toContainText(
    "M1.B → 0 · cell-default",
  );

  const saved = JSON.parse(
    (await downloadBytes(page, "File", "Save Project")).toString("utf8"),
  ) as {
    documents: Array<{
      mosBulkDefaults?: { nmosNetId?: string };
      instances: Array<{
        id: string;
        mosBulkBinding?: { origin: string; netId: string };
      }>;
      routes: Array<{ presentation?: string }>;
      nets: Array<{
        id: string;
        name?: string;
        terminals: Array<{ instanceId: string; pinName: string }>;
      }>;
    }>;
  };
  const document = saved.documents[0]!;
  expect(
    document.instances.find((instance) => instance.id === "M1")?.mosBulkBinding,
  ).toEqual({ origin: "cell-default", netId: "net-power-gnd1" });
  expect(document.mosBulkDefaults?.nmosNetId).toBe("net-power-gnd1");
  expect(document.routes).not.toContainEqual(
    expect.objectContaining({ presentation: "bulk-dashed" }),
  );
  expect(document.nets.find((net) => net.name === "0")?.terminals).toEqual(
    expect.arrayContaining([
      { instanceId: "M1", pinName: "B" },
      { instanceId: "GND1", pinName: "0" },
    ]),
  );
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
  await page.getByTestId("terminal-R2-1").click();

  await expect(page.locator('[data-testid^="route-hit-"]')).toHaveCount(2);
  await expect(page.getByTestId("active-tool")).toHaveText("wire");
});

test("moves an isolated free wire as one route", async ({ page }) => {
  await page.goto("/editor");
  const canvas = page.getByTestId("schematic-canvas");
  await clickDrawTool(page, "wire");
  await canvas.click({ position: { x: 420, y: 220 } });
  await canvas.dblclick({ position: { x: 620, y: 300 } });
  await page.keyboard.press("Escape");
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
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 300, y: 220 });
  await placeComponent(page, "resistor", { x: 540, y: 220 });
  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-R1-2").click();
  await page.getByTestId("terminal-R2-1").click();
  await page.keyboard.press("Escape");

  const before = await readRoutePoints(page, "route-ui-1");
  await dragRouteSegment(page, "route-ui-1", { x: 0, y: 80 });
  const after = await readRoutePoints(page, "route-ui-1");
  expect(after[0]).toEqual(before[0]);
  expect(after.at(-1)).toEqual(before.at(-1));
  expect(
    after.some((point) => !before.some((prior) => prior.y === point.y)),
  ).toBe(true);
});

test("keeps a BJT base connection as an ordinary solid wire", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "npn", { x: 300, y: 220 });
  await placeComponent(page, "resistor", { x: 540, y: 220 });
  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-Q1-B").click();
  await page.getByTestId("terminal-R1-1").click();
  await page.keyboard.press("Escape");

  const formalRoute = page.locator(
    '[data-layer="routes"] [data-object-id="route-ui-1"]',
  );
  await expect(formalRoute).toBeVisible();
  await expect(formalRoute).not.toHaveAttribute(
    "data-route-presentation",
    "bulk-dashed",
  );
  await expect(formalRoute).not.toHaveAttribute("stroke-dasharray", "3 3");
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
  expect(terminalRoute).toHaveLength(3);
  expect(terminalRoute[0]!.y).toBe(terminalRoute[1]!.y);
  expect(terminalRoute[1]!.x).toBe(terminalRoute[2]!.x);
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

test("connects copied multi-pin groups through a manually bent wire", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "nmos", { x: 320, y: 180 });
  await placeComponent(page, "nmos", { x: 320, y: 360 });
  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-M1-S").click();
  await page.getByTestId("terminal-M2-D").click();
  await page.keyboard.press("Escape");

  await page.keyboard.press("Control+a");
  await copySelectionAt(page, { x: 560, y: 300 });
  await expect(page.getByTestId("instance-count")).toHaveText("4");

  // Let the debounced recovery write settle before reloading. A reload inside
  // the debounce window cannot carry the last edit: the browser aborts
  // uncommitted IndexedDB transactions while the page unloads.
  const revision = await page.getByTestId("revision").textContent();
  await expect
    .poll(() => recoveryProjectTexts(page))
    .toContain(`"revision": ${revision}`);
  await page.reload();
  const fileMenu = await openMenu(page, "File");
  await fileMenu.getByRole("button", { name: "Recover recent work…" }).click();
  await page
    .getByRole("dialog", { name: "Recover recent work" })
    .getByRole("button", { name: "Restore" })
    .click();
  await expect(page.getByTestId("instance-count")).toHaveText("4");

  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-M2-S").click();
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 460, y: 500 } });
  await page.getByTestId("terminal-M4-S").click();

  await expect(page.getByTestId("status")).toContainText("Committed route");
  await expect(page.locator('[data-layer="routes"] polyline')).toHaveCount(3);
  await expect(page.getByTestId("active-tool")).toHaveText("wire");
});

test("moves a selected wire segment and deletes a connected component safely", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 320, y: 220 });
  await placeComponent(page, "resistor", { x: 520, y: 220 });
  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-R1-2").click();
  await page.getByTestId("terminal-R2-1").click();
  await page.keyboard.press("Escape");

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
  ).toHaveCount(0);
  await expect(page.getByTestId("status")).toContainText(
    "connected wires remain dangling",
  );
});

test("previews a connected Wire while its Instance moves", async ({ page }) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 320, y: 220 });
  await placeComponent(page, "resistor", { x: 520, y: 220 });
  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-R1-2").click();
  await page.getByTestId("terminal-R2-1").click();
  await page.keyboard.press("Escape");

  const before = await readRoutePoints(page, "route-ui-1");
  const hit = page.getByTestId("hit-R1");
  const box = await hit.boundingBox();
  if (!box) throw new Error("Connected Instance is not measurable");
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 70, start.y + 50, { steps: 4 });

  await expect(page.getByTestId("revision")).toHaveText("3");
  await expect
    .poll(() => readRoutePoints(page, "route-ui-1"))
    .not.toEqual(before);
  const during = await readRoutePoints(page, "route-ui-1");
  expect(during[0]).not.toEqual(before[0]);
  expect(during.at(-1)).toEqual(before.at(-1));

  await page.mouse.up();
  await expect(page.getByTestId("revision")).toHaveText("4");
  const after = await readRoutePoints(page, "route-ui-1");
  expect(after[0]).toEqual(during[0]);
  expect(after.at(-1)).toEqual(before.at(-1));
});

test("moves internal wiring with a selected group and copies the routed subgraph", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 320, y: 220 });
  await placeComponent(page, "resistor", { x: 520, y: 220 });
  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-R1-2").click();
  await page.getByTestId("terminal-R2-1").click();
  await page.keyboard.press("Escape");
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
      await expect
        .poll(() => readRoutePoints(page, "route-ui-1"))
        .not.toEqual(before);
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
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 320, y: 220 });
  await placeComponent(page, "resistor", { x: 520, y: 220 });
  // R3 sits under the tap so the branch leaves it as a clean tee; a jogged
  // branch would leave two arms on one side and draw no Junction dot.
  await placeComponent(page, "resistor", { x: 425, y: 420 });
  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-R1-2").click();
  await page.getByTestId("terminal-R2-1").click();
  await clickDrawTool(page, "wire");
  await clickRoute(page, "route-ui-1", 0.5, 0);
  await page.getByTestId("terminal-R3-1").click();
  await page.keyboard.press("Escape");

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
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 320, y: 220 });
  await placeComponent(page, "resistor", { x: 520, y: 220 });
  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-R1-2").click();
  await page.getByTestId("terminal-R2-1").click();
  await page.keyboard.press("Escape");
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
  // A live current-marker preview must not replace the formal SVG scene. A
  // private marker on the existing node lets this assertion distinguish the
  // intended local transform from a freshly rendered lookalike node.
  await paintedMarker.evaluate((element) =>
    element.setAttribute("data-preview-node", "preserved"),
  );
  const paintedBefore = await paintedMarker.boundingBox();
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 58, start.y + 24, { steps: 4 });
  await expect
    .poll(async () => (await paintedMarker.boundingBox())?.x)
    .not.toBe(paintedBefore?.x);
  await expect(paintedMarker).toHaveAttribute("data-preview-node", "preserved");
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
  await clickDrawTool(page, "wire");
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
  await page.goto("/editor");
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
  await page.goto("/editor");
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
  await page.goto("/editor");
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
    "Annotation · instance-label",
  );
});

test("moves an explicitly selected attached label", async ({ page }) => {
  await page.goto("/editor");
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
  await page.goto("/editor");
  await clickDrawTool(page, "text");
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
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 280, y: 180 });
  await placeComponent(page, "resistor", { x: 480, y: 180 });
  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-R1-2").click();
  await page.getByTestId("terminal-R2-1").click();
  await page.keyboard.press("Escape");

  await page.getByTestId("hit-R1").click();
  await page.getByTestId("annotation-hit-instance-label-R1").dblclick();
  const referenceEditor = page.getByRole("textbox", {
    name: "Canvas text editor",
  });
  await expect(referenceEditor).toHaveAttribute("contenteditable", "true");
  await referenceEditor.fill("R_LOAD");
  await page.getByRole("button", { name: "Apply text changes" }).click();
  // The user-owned schematic name changes without touching the hidden SPICE
  // reference, so its RichText spelling is displayed exactly as authored.
  await expect(page.locator('[data-layer="annotations"]')).toContainText(
    "R_LOAD",
  );

  await clickRoute(page, "route-ui-1", 0.5, 0);
  await openSelectionShelf(page);
  await page
    .getByRole("textbox", { name: "Electrical Net label" })
    .fill("SIGNAL");
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
  await expect(annotationEditor).toHaveAttribute("contenteditable", "true");
  await annotationEditor.fill("Vref");
  await annotationEditor.press("Control+a");
  await expect(page.getByRole("button", { name: "Italic" })).toBeVisible();
  await page.getByRole("button", { name: "Italic" }).click();
  await page.getByRole("button", { name: "Increase text size" }).click();
  await page.getByRole("button", { name: "Apply text changes" }).click();
  await expect(page.locator('[data-layer="annotations"]')).toContainText(
    "Vref",
  );
  await page.getByTestId("selection-shelf").click();

  await placeComponent(page, "resistor", { x: 280, y: 320 });
  await placeComponent(page, "resistor", { x: 480, y: 320 });
  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-R3-2").click();
  await page.getByTestId("terminal-R4-1").click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("net-count")).toHaveText("2");
  await clickRoute(page, "route-ui-2", 0.5, 0);
  await openSelectionShelf(page);
  await page
    .getByRole("textbox", { name: "Electrical Net label" })
    .fill("Vref");
  await expect(page.getByTestId("net-count")).toHaveText("1");
  await expect(page.getByTestId("status")).toHaveText("Saved Net Label Vref");

  await clickDrawTool(page, "text");
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
  await closeSelectionShelf(page);
  await noteHandle.dragTo(page.getByTestId("schematic-canvas"), {
    targetPosition: { x: 360, y: 300 },
  });
  const afterBox = await noteHandle.boundingBox();
  expect(afterBox?.x).not.toBe(beforeBox.x);
});

test("keeps literal text line breaks and overbars visible while editing", async ({
  page,
}) => {
  await page.goto("/editor");
  await clickDrawTool(page, "text");
  const editor = page.getByRole("textbox", { name: "Canvas text editor" });
  await editor.fill("Vx");
  await editor.press("ControlOrMeta+A");
  await page.getByRole("button", { name: "Overbar" }).click();
  await expect(editor.locator('[data-rich-text-style="overbar"]')).toHaveCSS(
    "text-decoration-line",
    "overline",
  );
  await page.getByRole("button", { name: "Overbar" }).click();
  await expect(editor.locator('[data-rich-text-style="overbar"]')).toHaveCount(
    0,
  );
  await editor.press("ControlOrMeta+A");
  await page.getByRole("button", { name: "Overbar" }).click();
  await editor.press("End");
  // Enter finishes the text everywhere; a deliberate modifier asks for a line.
  await editor.press("Shift+Enter");
  await editor.type("bias");
  await page.getByRole("button", { name: "Apply text changes" }).click();
  await expect(
    page.locator('[data-layer="drafting"] [data-text-run="line-break"]'),
  ).toHaveCount(1);
  await expect(page.locator('[data-layer="drafting"]')).toContainText("Vxbias");
});

test("L edits a selected route Net Label without opening Properties", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 280, y: 180 });
  await placeComponent(page, "resistor", { x: 480, y: 180 });
  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-R1-2").click();
  await page.getByTestId("terminal-R2-1").click();
  await page.keyboard.press("Escape");

  await clickRoute(page, "route-ui-1", 0.5, 0);
  await page.keyboard.press("l");
  const editor = page.getByTestId("net-label-editor");
  await expect(editor).toBeVisible();
  await editor.getByRole("textbox", { name: "Net Label" }).fill("SIGNAL");
  await editor.getByRole("textbox", { name: "Net Label" }).press("Enter");
  await expect(page.locator('[data-layer="annotations"]')).toContainText(
    "SIGNAL",
  );
  await expect(page.getByTestId("flightline")).toHaveCount(0);
  await openSelectionShelf(page);
  await page.getByRole("button", { name: "Delete Net label" }).click();
  await expect(
    page.getByTestId("annotation-hit-net-label-route-ui-1"),
  ).toHaveCount(0);
  await expect(page.getByTestId("flightline")).toHaveCount(0);

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
  await editor.getByRole("textbox", { name: "Net Label" }).fill("ESCSAVE");
  // Escape saves the edit like Enter does instead of discarding it.
  await editor.getByRole("textbox", { name: "Net Label" }).press("Escape");
  await expect(page.locator('[data-layer="annotations"]')).toContainText(
    "ESCSAVE",
  );
  await clickRoute(page, "route-ui-1", 0.5, 0);
  await page.keyboard.press("l");
  await editor.getByRole("textbox", { name: "Net Label" }).fill("");
  await editor.getByRole("textbox", { name: "Net Label" }).press("Enter");
  await expect(
    page.getByTestId("annotation-hit-net-label-route-ui-1"),
  ).toHaveCount(0);
});

test("Properties toggles reference label visibility for one or many components", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 280, y: 180 });
  await placeComponent(page, "resistor", { x: 480, y: 180 });

  await page.getByTestId("hit-R1").click();
  await openSelectionShelf(page);
  const properties = page.getByRole("complementary", { name: "Properties" });
  for (const sectionName of [
    "Identity",
    "Parameters",
    "Display",
    "Advanced parameters",
    "Placement",
  ]) {
    await expect(
      properties.getByText(sectionName, { exact: true }),
    ).toBeVisible();
  }
  const componentProperties = properties.getByRole("region", {
    name: "Component properties",
  });
  await expect(
    componentProperties.locator(":scope > .property-card"),
  ).toHaveCount(3);
  await expect(
    componentProperties.getByLabel("Component identity"),
  ).toContainText("TargetBuilt-in primitive: resistor");
  await expect(
    componentProperties.getByText("Netlist target", { exact: true }),
  ).toHaveCount(0);
  const singleToggle = page.getByRole("checkbox", {
    name: "Reference",
    exact: true,
  });
  await expect(singleToggle).toBeChecked();
  await singleToggle.uncheck();
  await expect(
    page.getByTestId("annotation-hit-instance-label-R1"),
  ).toHaveCount(0);
  await expect(
    page.locator('[data-object-id="instance-label-R1"]'),
  ).toHaveCount(0);
  await expect(
    page.getByTestId("annotation-hit-instance-label-R2"),
  ).toHaveCount(1);
  // Hiding is recoverable: the annotation is still in the project.
  await singleToggle.check();
  await expect(
    page.getByTestId("annotation-hit-instance-label-R1"),
  ).toHaveCount(1);

  // Marquee both components and toggle the whole group. The left-to-right
  // window requires FULL coverage, so sweep well past both symbol bodies.
  const canvas = page.getByTestId("schematic-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas is not measurable");
  await page.mouse.move(box.x + 120, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + 700, box.y + 340, { steps: 6 });
  await page.mouse.up();
  const groupToggle = page.getByRole("checkbox", {
    name: "Reference",
    exact: true,
  });
  await expect(groupToggle).toBeVisible();
  await expect(groupToggle).toBeChecked();
  await groupToggle.uncheck();
  await expect(
    page.getByTestId("annotation-hit-instance-label-R1"),
  ).toHaveCount(0);
  await expect(
    page.getByTestId("annotation-hit-instance-label-R2"),
  ).toHaveCount(0);
  await groupToggle.check();
  await expect(
    page.getByTestId("annotation-hit-instance-label-R1"),
  ).toHaveCount(1);
  await expect(
    page.getByTestId("annotation-hit-instance-label-R2"),
  ).toHaveCount(1);
});

test("shows fixed and variable capacitor plate terminals as read-only Properties", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "capacitor", { x: 280, y: 180 });
  await placeComponent(page, "variable-capacitor", { x: 480, y: 180 });

  await page.getByTestId("hit-C1").click();
  await openSelectionShelf(page);
  const properties = page.getByRole("complementary", { name: "Properties" });
  let plateCard = properties.getByRole("group", {
    name: "Capacitor plate terminals",
  });
  await expect(
    plateCard.getByText("Electrical terminals", { exact: true }),
  ).toBeVisible();
  await expect(plateCard.getByLabel("Top plate terminal")).toHaveText(
    "Pin 1 · Unconnected",
  );
  await expect(plateCard.getByLabel("Bottom plate terminal")).toHaveText(
    "Pin 2 · Unconnected",
  );
  await expect(plateCard.locator("input, select, button")).toHaveCount(0);
  await expect(plateCard).not.toContainText(
    "Plate roles are defined by the device",
  );

  await page.getByTestId("hit-C2").click();
  plateCard = properties.getByRole("group", {
    name: "Capacitor plate terminals",
  });
  await expect(plateCard.getByLabel("Top plate terminal")).toHaveText(
    "Pin P1 · Unconnected",
  );
  await expect(plateCard.getByLabel("Bottom plate terminal")).toHaveText(
    "Pin P2 · Unconnected",
  );
});

test("value display projects MOS W/L and passive values beside the reference", async ({
  page,
}) => {
  await page.goto("/editor");
  await page.keyboard.press("i");
  const dialog = page.getByRole("dialog", { name: "Insert Component" });
  await dialog.getByLabel("Component search").fill("nmos");
  // A MOS arrives with its device defaults, so the Value toggle is usable
  // without typing geometry first.
  const valueToggle = dialog.getByRole("checkbox", {
    name: "Value",
    exact: true,
  });
  await expect(valueToggle).toBeEnabled();
  await dialog.getByLabel("Component w", { exact: true }).fill("2u");
  await dialog.getByLabel("Component l", { exact: true }).fill("180n");
  await expect(valueToggle).toBeEnabled();
  await valueToggle.check();
  await dialog.getByRole("button", { name: "Apply" }).click();
  const canvas = page.getByTestId("schematic-canvas");
  await canvas.click({ position: { x: 360, y: 240 } });
  await page.keyboard.press("Escape");

  const reference = page.locator('[data-object-id="instance-label-M1"]');
  const value = page.locator('[data-object-id="instance-value-M1"]');
  await expect(reference).toContainText("M1");
  // MOS values render as a stacked fraction with engineering units: the
  // numerator and denominator are separate part texts around a fraction bar.
  await expect(value).toContainText("2um");
  await expect(value).toContainText("180nm");
  await expect(page.locator('[data-role="fraction-bar"]')).toHaveCount(1);
  // The value block is the second upright row under the reference.
  const referenceBox = await reference.boundingBox();
  const valueBox = await value.boundingBox();
  if (!referenceBox || !valueBox) throw new Error("Labels are not measurable");
  expect(valueBox.y).toBeGreaterThan(referenceBox.y);

  // A passive value projects the same way from the insert dialog.
  await page.keyboard.press("i");
  await dialog.getByLabel("Component search").fill("resistor");
  await dialog.getByLabel("Component value", { exact: true }).fill("33k");
  await dialog.getByRole("checkbox", { name: "Value", exact: true }).check();
  await dialog.getByRole("button", { name: "Apply" }).click();
  await canvas.click({ position: { x: 560, y: 240 } });
  await page.keyboard.press("Escape");
  await expect(
    page.locator('[data-object-id="instance-value-R1"]'),
  ).toContainText("33kΩ");

  // The formal SVG export carries the fraction bar and unit text through the
  // shared annotation path.
  const svg = (await downloadBytes(page, "File", "Export SVG")).toString(
    "utf8",
  );
  expect(svg).toContain('data-kind="instance-value"');
  expect(svg).toContain('data-role="fraction-bar"');
  expect(svg).toContain("2um");
  expect(svg).toContain("180nm");
  expect(svg).toContain("33kΩ");
});

test("reference and value toggles refresh content after parameter edits", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 300, y: 200 });
  await placeComponent(page, "resistor", { x: 500, y: 200 });

  // Quick-place leaves the parameters blank, so the Value toggle starts
  // disabled and no hidden annotation exists at all.
  await page.getByTestId("hit-R1").click();
  await openSelectionShelf(page);
  const valueToggle = page.getByRole("checkbox", {
    name: "Value",
    exact: true,
  });
  await expect(valueToggle).toBeDisabled();
  await expect(
    page.getByTestId("annotation-hit-instance-value-R1"),
  ).toHaveCount(0);

  // Typing a value enables the toggle immediately from the live draft,
  // without closing and reopening the properties panel.
  await page.getByLabel("Component value").click();
  await page.getByLabel("Component value").fill("33k");
  await expect(valueToggle).toBeEnabled();
  // Checking commits the typed parameters and shows the projected value in
  // one step.
  await valueToggle.check();
  await expect(
    page.locator('[data-object-id="instance-value-R1"]'),
  ).toContainText("33kΩ");

  // A later parameter edit re-projects the visible value text.
  await page.getByLabel("Component value").click();
  await page.getByLabel("Component value").fill("47k");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 60, y: 60 } });
  await expect(
    page.locator('[data-object-id="instance-value-R1"]'),
  ).toContainText("47kΩ");

  // Hiding keeps the annotation recoverable.
  await page.getByTestId("hit-R1").click();
  await openSelectionShelf(page);
  await page.getByRole("checkbox", { name: "Value", exact: true }).uncheck();
  await expect(
    page.getByTestId("annotation-hit-instance-value-R1"),
  ).toHaveCount(0);
  await expect(
    page.locator('[data-object-id="instance-value-R1"]'),
  ).toHaveCount(0);

  // The group toggle applies the same value display to every component that
  // has a projection; R2 keeps none because its parameters stay blank. The
  // mixed group can never read back as all-visible, so click (not check).
  const canvas = page.getByTestId("schematic-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas is not measurable");
  await page.mouse.move(box.x + 180, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + 700, box.y + 340, { steps: 6 });
  await page.mouse.up();
  await page
    .getByRole("checkbox", { name: "Value", exact: true })
    .first()
    .click();
  await expect(
    page.locator('[data-object-id="instance-value-R1"]'),
  ).toContainText("47kΩ");
  await expect(
    page.locator('[data-object-id="instance-value-R2"]'),
  ).toHaveCount(0);
});

test("drag value annotation keeps the user offset through rotation", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 360, y: 220 });
  await page.getByTestId("hit-R1").click();
  await openSelectionShelf(page);
  await page.getByLabel("Component value").click();
  await page.getByLabel("Component value").fill("33k");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 60, y: 60 } });
  await page.getByTestId("hit-R1").click();
  await openSelectionShelf(page);
  await page.getByRole("checkbox", { name: "Value", exact: true }).check();
  await expect(
    page.locator('[data-object-id="instance-value-R1"]'),
  ).toContainText("33kΩ");

  // Drag the value away from its canonical slot.
  const value = page.getByTestId("annotation-hit-instance-value-R1");
  await value.click({ modifiers: ["Alt"] });
  await value.dragTo(page.getByTestId("schematic-canvas"), {
    targetPosition: { x: 200, y: 360 },
  });
  const dragged = await value.boundingBox();
  if (!dragged) throw new Error("Dragged value is not measurable");

  // A user-moved value is an authored vector: rotation transforms it rigidly
  // instead of pulling it back onto the automatic second row.
  await page.getByTestId("hit-R1").click();
  await page.keyboard.press("r");
  await expect(
    page.locator('[data-object-id="instance-value-R1"]'),
  ).toContainText("33kΩ");
  const rotated = await value.boundingBox();
  if (!rotated) throw new Error("Rotated value is not measurable");
  // The user vector rotates rigidly; on the drag-clamp circle a quarter turn
  // may keep one coordinate, so assert total displacement instead.
  expect(
    Math.hypot(rotated.x - dragged.x, rotated.y - dragged.y),
  ).toBeGreaterThan(10);
});

test("property edits commit on blank click and Escape instead of vanishing", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 320, y: 200 });
  const canvas = page.getByTestId("schematic-canvas");

  await page.getByTestId("hit-R1").click();
  await openSelectionShelf(page);
  const value = page.getByLabel("Component value");
  await value.click();
  await value.fill("33k");
  await canvas.click({ position: { x: 60, y: 60 } });
  await expect(page.getByTestId("revision")).toHaveText("2");

  await page.getByTestId("hit-R1").click();
  await openSelectionShelf(page);
  await expect(page.getByLabel("Component value")).toHaveValue("33k");

  await page.getByLabel("Component value").click();
  await page.getByLabel("Component value").fill("47k");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("revision")).toHaveText("3");

  await canvas.click({ position: { x: 60, y: 60 } });
  await page.getByTestId("hit-R1").click();
  await openSelectionShelf(page);
  await expect(page.getByLabel("Component value")).toHaveValue("47k");
});

test("canvas text editor commits on Escape and on an outside click", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 420, y: 280 });
  const rendered = page.locator('[data-object-id="instance-label-R1"]');

  await page.getByTestId("annotation-hit-instance-label-R1").dblclick();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("RA");
  await page.keyboard.press("Escape");
  await expect(rendered).toContainText("RA");
  await expect(page.getByTestId("revision")).toHaveText("2");

  await page.getByTestId("annotation-hit-instance-label-R1").dblclick();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("RB");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 60, y: 60 } });
  await expect(rendered).toContainText("RB");
  await expect(page.getByTestId("revision")).toHaveText("3");
});

test("a dragged Net label re-anchors along its route and stays released", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 280, y: 180 });
  await placeComponent(page, "resistor", { x: 520, y: 180 });
  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-R1-2").click();
  await page.getByTestId("terminal-R2-1").click();
  await page.keyboard.press("Escape");

  await clickRoute(page, "route-ui-1", 0.5, 0);
  await page.keyboard.press("l");
  const editor = page.getByTestId("net-label-editor");
  await editor.getByRole("textbox", { name: "Net Label" }).fill("NETA");
  await editor.getByRole("textbox", { name: "Net Label" }).press("Enter");

  const label = page.getByTestId("annotation-hit-net-label-route-ui-1");
  const renderedLabel = page.locator('[data-object-id="net-label-route-ui-1"]');
  await expect(label).toBeVisible();
  const before = await renderedLabel.boundingBox();
  if (!before) throw new Error("Net label is not measurable");
  const revisionBefore = await page.getByTestId("revision").textContent();

  // Well past the old +/-30 clamp: the label must stay below the wire.
  await dragBy(label, { x: 0, y: 80 });
  await expect(page.getByTestId("revision")).not.toHaveText(revisionBefore!);
  const after = await renderedLabel.boundingBox();
  if (!after) throw new Error("Net label vanished after the drag");
  expect(after.y - before.y).toBeGreaterThan(60);
});

test("selects and moves multiple instances while viewport gestures stay transient", async ({
  page,
}) => {
  await page.goto("/editor");
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
  await expect(page.getByTestId("selection-shelf")).toContainText(
    "2 components",
  );

  await page
    .getByTestId("hit-M1")
    .dragTo(page.getByTestId("schematic-canvas"), {
      targetPosition: { x: 450, y: 330 },
    });
  await expect(page.getByTestId("revision")).toHaveText("3");

  const canvas = page.getByTestId("schematic-canvas");
  const beforeViewBox = await canvas.getAttribute("viewBox");
  await closeSelectionShelf(page);
  await canvas.hover({ position: { x: 320, y: 350 } });
  await page.mouse.wheel(0, -120);
  await expect(canvas).not.toHaveAttribute("viewBox", beforeViewBox!);
  await expect(page.getByTestId("revision")).toHaveText("3");

  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) throw new Error("Canvas is not measurable");
  await page.mouse.move(canvasBox.x + 320, canvasBox.y + 350);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(canvasBox.x + 750, canvasBox.y + 390, { steps: 3 });
  await page.mouse.up({ button: "middle" });
  await expect(page.getByTestId("revision")).toHaveText("3");

  await page.keyboard.press("r");
  await expect(page.getByTestId("revision")).toHaveText("4");
});

test("R rotates a selected component instead of entering Rectangle", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "nmos", { x: 420, y: 260 });
  await expect(page.getByTestId("revision")).toHaveText("1");

  await page.getByTestId("hit-M1").click();
  await page.keyboard.press("r");

  await expect(page.getByTestId("revision")).toHaveText("2");
  await expect(page.locator('[data-kind="draft-rectangle"]')).toHaveCount(0);

  await page.keyboard.press("Shift+R");
  await expect(page.getByTestId("revision")).toHaveText("3");
  await page.keyboard.press("Control+r");
  await expect(page.getByTestId("revision")).toHaveText("4");
});

test("C previews one copy and Escape cancels without a revision", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 360, y: 220 });
  await page.getByTestId("hit-R1").click();

  const canvas = page.getByTestId("schematic-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas is not measurable");
  await page.keyboard.press("c");
  await page.mouse.move(box.x + 560, box.y + 340);
  await expect(page.getByTestId("copy-placement-preview")).toBeVisible();
  await page.keyboard.press("c");
  await expect(page.getByTestId("copy-placement-preview")).toBeVisible();
  await page.keyboard.press("Escape");

  await expect(page.getByTestId("copy-placement-preview")).toHaveCount(0);
  await expect(page.getByTestId("instance-count")).toHaveText("1");
  await expect(page.getByTestId("revision")).toHaveText("1");
  await expect(page.getByTestId("status")).toContainText(
    "Copy placement cancelled",
  );
});

test("R rotates a copy preview before committing the copied component", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 360, y: 220 });
  await page.getByTestId("hit-R1").click();
  const canvas = page.getByTestId("schematic-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas is not measurable");

  await page.keyboard.press("c");
  await page.mouse.move(box.x + 560, box.y + 340);
  const previewSymbol = page
    .getByTestId("copy-placement-preview")
    // The ghost is built from the same dry-run paste transaction as its
    // commit, so it owns a reserved copy ID rather than the source ID.
    .locator("[data-object-id] > g")
    .first();
  await expect(previewSymbol).toHaveAttribute("transform", /rotate\(0\)/);

  await page.keyboard.press("r");
  await expect(previewSymbol).toHaveAttribute("transform", /rotate\(90\)/u);
  await canvas.click({ position: { x: 560, y: 340 } });
  await expect(
    canvas.locator('[data-object-id="R2"] > g').first(),
  ).toHaveAttribute("transform", /rotate\(90\)/u);
  // The pasted designator and its visible label both read R2.
  await expect(canvas.getByText("R2", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
});

test("numbers placed components per device type instead of globally", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "nmos", { x: 320, y: 200 });
  await placeComponent(page, "nmos", { x: 520, y: 200 });
  await placeComponent(page, "resistor", { x: 720, y: 200 });
  await placeComponent(page, "capacitor", { x: 320, y: 400 });

  await expect(page.getByTestId("hit-M1")).toBeVisible();
  await expect(page.getByTestId("hit-M2")).toBeVisible();
  await expect(page.getByTestId("hit-R1")).toBeVisible();
  await expect(page.getByTestId("hit-C1")).toBeVisible();
  await expect(page.getByTestId("instance-count")).toHaveText("4");
});

test("right-drag frames a region and fits the camera to it transiently", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 320, y: 200 });

  const canvas = page.getByTestId("schematic-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas is not measurable");
  const before = await canvas.getAttribute("viewBox");

  await page.mouse.move(box.x + 220, box.y + 160);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(box.x + 420, box.y + 320, { steps: 4 });
  await expect(page.getByTestId("zoom-box")).toBeVisible();
  await page.mouse.up({ button: "right" });

  await expect(page.getByTestId("zoom-box")).toHaveCount(0);
  await expect(canvas).not.toHaveAttribute("viewBox", before!);
  await expect(page.getByTestId("status")).toHaveText(
    "Zoomed to framed region",
  );
  // Framing is a camera gesture: the document revision must not move.
  await expect(page.getByTestId("revision")).toHaveText("1");

  // A right click that never framed must not change the camera either.
  const framed = await canvas.getAttribute("viewBox");
  await page.mouse.move(box.x + 300, box.y + 240);
  await page.mouse.down({ button: "right" });
  await page.mouse.up({ button: "right" });
  await expect(canvas).toHaveAttribute("viewBox", framed!);

  // Alt+left-drag frames the same region for environments whose system
  // software hooks the right button before the browser sees the drag.
  await page.keyboard.down("Alt");
  await page.mouse.move(box.x + 200, box.y + 140);
  await page.mouse.down();
  await page.mouse.move(box.x + 460, box.y + 340, { steps: 4 });
  await expect(page.getByTestId("zoom-box")).toBeVisible();
  await page.mouse.up();
  await page.keyboard.up("Alt");

  await expect(page.getByTestId("zoom-box")).toHaveCount(0);
  await expect(canvas).not.toHaveAttribute("viewBox", framed!);
  await expect(page.getByTestId("status")).toHaveText(
    "Zoomed to framed region",
  );
  await expect(page.getByTestId("revision")).toHaveText("1");
});

test("keeps copy placement active for repeated commits until Escape", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 320, y: 220 });
  await page.getByTestId("hit-R1").click();
  const canvas = page.getByTestId("schematic-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas is not measurable");

  await page.keyboard.press("c");
  await page.mouse.move(box.x + 520, box.y + 220);
  await canvas.click({ position: { x: 520, y: 220 } });
  await expect(page.getByTestId("instance-count")).toHaveText("2");
  await expect(page.getByTestId("copy-placement-preview")).toBeVisible();

  await page.mouse.move(box.x + 680, box.y + 220);
  await canvas.click({ position: { x: 680, y: 220 } });
  await expect(page.getByTestId("instance-count")).toHaveText("3");
  await expect(page.getByTestId("copy-placement-preview")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("copy-placement-preview")).toHaveCount(0);
  await expect(page.getByTestId("revision")).toHaveText("3");
});

test("keeps the rich-text editor outside its target and shields canvas input", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 420, y: 280 });
  const label = page.getByTestId("annotation-hit-instance-label-R1");
  await label.dblclick();

  const overlay = page.getByTestId("canvas-text-editor");
  await expect(overlay).toBeVisible();
  const [labelBox, overlayBox, componentBox] = await Promise.all([
    label.boundingBox(),
    overlay.boundingBox(),
    page.getByTestId("hit-R1").boundingBox(),
  ]);
  if (!labelBox || !overlayBox || !componentBox) {
    throw new Error("Text editor geometry is not measurable");
  }
  expect(
    overlayBox.y + overlayBox.height <= labelBox.y ||
      overlayBox.y >= labelBox.y + labelBox.height,
  ).toBe(true);

  await page.mouse.move(
    overlayBox.x + overlayBox.width / 2,
    overlayBox.y + overlayBox.height - 4,
  );
  await page.mouse.down();
  await page.mouse.move(
    overlayBox.x + overlayBox.width / 2 + 16,
    overlayBox.y + overlayBox.height - 4,
  );
  await page.mouse.up();
  await expect(overlay).toBeVisible();
  await expect(page.getByTestId("revision")).toHaveText("1");
  expect(await page.getByTestId("hit-R1").boundingBox()).toEqual(componentBox);
});

test("deletes imported Net Labels with non-editor ids", async ({ page }) => {
  const project = createRoutingDemoProject();
  const document = project.documents[0]!;
  document.routes.push({
    id: "route-imported-h",
    netId: "net-h",
    from: { kind: "terminal", instanceId: "A", pinName: "P" },
    to: { kind: "terminal", instanceId: "B", pinName: "P" },
    waypoints: [],
    segmentModes: ["manual"],
  });
  document.annotations.push({
    id: "imported-label-horizontal",
    kind: "net-label",
    content: { runs: [{ kind: "text", value: "HORIZONTAL" }] },
    netId: "net-h",
    anchor: { kind: "free", position: { x: 300, y: 280 } },
    alignment: "middle",
    rotation: 0,
    locked: false,
  });
  await page.goto("/editor");
  await page.getByTestId("project-file").setInputFiles({
    name: "legacy-net-label.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });

  const importedLabel = page.getByTestId(
    "annotation-hit-imported-label-horizontal",
  );
  await importedLabel.click();
  await page.keyboard.press("h");
  await expect(page.getByTestId("net-highlight-overlay")).toHaveAttribute(
    "data-net-id",
    "net-h",
  );
  await expect(
    page.locator(".net-highlight-overlay .net-highlight-core"),
  ).toHaveCount(1);
  await page.keyboard.press("h");
  await expect(page.getByTestId("net-highlight-overlay")).toHaveCount(0);
  await page.keyboard.press("Delete");
  await expect(importedLabel).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await expect(importedLabel).toHaveCount(1);

  await clickRoute(page, "route-imported-h");
  await openSelectionShelf(page);
  await page.getByRole("button", { name: "Delete Net label" }).click();
  await expect(
    page.getByTestId("annotation-hit-imported-label-horizontal"),
  ).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "Electrical Net label" }),
  ).toHaveValue("");

  // The label was selected alongside the Route. Its deleted annotation id
  // must not poison the following atomic Wire deletion.
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("route-hit-route-imported-h")).toHaveCount(0);
  await expect(page.getByTestId("status")).toContainText(
    "Deleted wire route-imported-h",
  );
  await page.keyboard.press("Control+z");

  const savedWithoutLabel = await downloadBytes(page, "File", "Save Project");
  const savedDocument = JSON.parse(savedWithoutLabel.toString("utf8"))
    .documents[0];
  expect(savedDocument.annotations).toHaveLength(0);
  expect(
    savedDocument.nets.find((net: { id: string }) => net.id === "net-h"),
  ).toMatchObject({ name: "HORIZONTAL" });
  await page.getByTestId("project-file").setInputFiles({
    name: "legacy-net-label-reopened.icproj.json",
    mimeType: "application/json",
    buffer: savedWithoutLabel,
  });
  await clickRoute(page, "route-imported-h");
  await openSelectionShelf(page);
  await expect(
    page.getByRole("textbox", { name: "Electrical Net label" }),
  ).toHaveValue("");
});

test("derives crossings and creates junctions only when a wire ends on a route", async ({
  page,
}) => {
  await page.goto("/editor");
  await page.getByTestId("project-file").setInputFiles({
    name: "routing-example.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(createRoutingDemoProject())),
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
    "Ambiguous intersection",
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
  Object.assign(horizontalNet, {
    name: "0",
    scope: "global" as const,
    powerDomain: "ground" as const,
  });
  document.routes.push({
    id: "route-base",
    netId: "net-h",
    from: { kind: "terminal", instanceId: "A", pinName: "P" },
    to: { kind: "terminal", instanceId: "B", pinName: "P" },
    waypoints: [],
    segmentModes: ["manual"],
  });
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
    name: "0",
    scope: "global",
    terminals: [{ instanceId: "GND1", pinName: "0" }],
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

test("keeps rejected SPICE import diagnostics in a historical report", async ({
  page,
}) => {
  await page.goto("/editor");
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
  const telemetry = page.getByTestId("editor-test-telemetry");
  await expect(telemetry.getByTestId("document-count")).toHaveText("1");
  await expect(telemetry.getByTestId("instance-count")).toHaveText("0");
  await expect(page.getByTestId("import-report-lifecycle")).toContainText(
    "they are not current ERC results",
  );
  await expect(page.getByTestId("import-report-diagnostics")).toContainText(
    "approved Razavi catalog has no symbol",
  );
  await expect(page.getByTestId("project-diagnostics")).not.toContainText(
    "approved Razavi catalog has no symbol",
  );

  const replacement = createEmptyProject("replacement", "Replacement");
  await page.getByTestId("project-file").setInputFiles({
    name: "replacement.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(replacement)),
  });
  await expect(page.getByTestId("import-report-lifecycle")).toHaveCount(0);
});

test("imports a parameterized hierarchy and re-exports its structural semantics", async ({
  page,
}) => {
  await page.goto("/editor");
  await page.getByTestId("spice-files").setInputFiles({
    name: "circuit.spi",
    mimeType: "application/x-spice",
    buffer: Buffer.from(`
.subckt leaf A B params: scale=1
R1 A B 1k
.ends leaf
.subckt top IN OUT
X1 IN OUT leaf scale=2
X2 OUT IN EXT_MASTER l=1u nf=4
.ends top
`),
  });

  await expect(page.getByTestId("status")).toContainText(
    "Imported 2 Documents",
  );
  const spice = (
    await downloadBytes(page, "File", "Export SPICE netlist")
  ).toString("utf8");
  expect(spice).toContain(".subckt leaf A B params: scale=1");
  expect(spice).toContain("X1 IN OUT leaf scale=2");
  expect(spice).toContain("X2 OUT IN EXT_MASTER l=1u nf=4");
});

test("shows imported instance references after Place all", async ({ page }) => {
  await page.goto("/editor");
  await page.getByTestId("spice-files").setInputFiles({
    name: "circuit.spi",
    mimeType: "application/x-spice",
    buffer: Buffer.from(`
.subckt top IN OUT
R7 IN OUT 10k
.ends top
`),
  });

  await expect(page.getByTestId("status")).toContainText(
    "Imported 1 Documents",
  );
  await page
    .getByRole("region", { name: "Placement Tray" })
    .getByRole("button", { name: "Place all" })
    .click();
  await expect(
    page
      .getByTestId("schematic-canvas")
      .locator("text")
      .filter({ hasText: "R7" }),
  ).toBeVisible();
  await expect(
    page
      .getByTestId("schematic-canvas")
      .locator("text")
      .filter({ hasText: "OUT" }),
  ).toBeVisible();
  await expect(
    page
      .getByTestId("schematic-canvas")
      .locator("text")
      .filter({ hasText: "P1" }),
  ).toHaveCount(0);
  await expect(
    page.getByTestId("annotation-hit-instance-label-R7"),
  ).toBeVisible();
});

test("requires warning review before exporting generated NoConnect nodes", async ({
  page,
}) => {
  const project = createEmptyProject("warning-project", "Warning Project");
  const document = project.documents[0]!;
  document.instances.push({
    id: "R1",
    symbolId: "resistor",
    placement: null,
    netlist: {
      reference: "R1",
      binding: { kind: "primitive", deviceClass: "resistor" },
      parameters: { value: "10k" },
    },
  });
  document.nets.push({
    id: "net-in",
    name: "IN",
    scope: "local",
    terminals: [{ instanceId: "R1", pinName: "1" }],
  });
  document.noConnects.push({
    id: "r1-open",
    endpoint: { kind: "terminal", instanceId: "R1", pinName: "2" },
  });

  await page.goto("/editor");
  await page.getByTestId("project-file").setInputFiles({
    name: "warning.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await clickCommand(page, "File", "Export SPICE netlist");
  const dialog = page.getByRole("dialog", { name: "Netlist Preflight" });
  await expect(dialog).toContainText("GENERATED_NO_CONNECT_NODE");
  await expect(dialog.getByTestId("netlist-preview")).toContainText(
    "R1 IN NC0001 10k",
  );

  const downloadPromise = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download SPICE netlist" }).click();
  const stream = await (await downloadPromise).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks).toString("utf8")).toContain("R1 IN NC0001 10k");
});

test("exports one formal visual scene as Project, SVG, PNG, and PDF", async ({
  page,
}) => {
  await page.goto("/editor");

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

test("exports structural SPICE and Spectre netlists while exposing instance authoring", async ({
  page,
}) => {
  await page.goto("/editor");
  const spice = (
    await downloadBytes(page, "File", "Export SPICE netlist")
  ).toString("utf8");
  expect(spice).toContain("* Generated by Interactive Circuit Maker");
  const spectre = (
    await downloadBytes(page, "File", "Export Spectre netlist")
  ).toString("utf8");
  expect(spectre).toContain("simulator lang=spectre");

  await placeComponent(page, "nmos", { x: 360, y: 220 });
  await openSelectionShelf(page);
  const properties = page.getByRole("complementary", { name: "Properties" });
  await expect(properties.getByLabel("Cell netlist name")).toHaveCount(0);
  await expect(properties.getByLabel("Cell netlist port order")).toHaveCount(0);
  await expect(
    properties.getByLabel("Component netlist reference"),
  ).toBeVisible();
  await expect(
    properties.getByLabel("Component schematic label"),
  ).toBeVisible();
  await expect(properties.getByLabel("Component model target")).toBeVisible();
  await expect(properties.getByText(/^Model:/u)).toHaveCount(0);
});

test("selects a reviewed SKY130 MOS through the existing Model field", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "nmos", { x: 360, y: 220 });
  await openSelectionShelf(page);
  const properties = page.getByRole("complementary", { name: "Properties" });
  const model = properties.getByLabel("Component model target");

  await expect(
    properties.locator('datalist option[value="sky130_fd_pr__nfet_01v8"]'),
  ).toHaveCount(1);
  await model.fill("sky130_fd_pr__nfet_01v8");
  await model.press("Tab");

  await expect(properties).toContainText("External subcircuit · X reference");
  await expect(
    properties.getByLabel("Component netlist reference"),
  ).toHaveValue("X1");
  await expect(properties.getByLabel("Component nf")).toBeVisible();
  await expect(
    properties.getByLabel("Component m", { exact: true }),
  ).toHaveCount(0);

  const saved = JSON.parse(
    (await downloadBytes(page, "File", "Save Project")).toString("utf8"),
  );
  expect(saved.externalSubcircuitDefinitions).toEqual([
    expect.objectContaining({
      name: "sky130_fd_pr__nfet_01v8",
      terminals: [
        expect.objectContaining({ name: "D" }),
        expect.objectContaining({ name: "G" }),
        expect.objectContaining({ name: "S" }),
        expect.objectContaining({ name: "B" }),
      ],
    }),
  ]);
  expect(saved.documents[0].instances[0]).toMatchObject({
    id: "M1",
    symbolId: "nmos",
    schematicReference: "M1",
    netlist: {
      reference: "X1",
      binding: { kind: "external-subcircuit" },
    },
  });
});

test("uses automatic recovery and guards shortcuts while typing", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 360, y: 220 });
  await expect(page.getByTestId("revision")).toHaveText("1");
  await expect
    .poll(() => recoveryProjectTexts(page))
    .toContain('"revision": 1');

  await page.reload();
  const fileMenu = await openMenu(page, "File");
  await fileMenu.getByRole("button", { name: "Recover recent work…" }).click();
  await page
    .getByRole("dialog", { name: "Recover recent work" })
    .getByRole("button", { name: "Restore" })
    .click();
  await expect(page.getByTestId("revision")).toHaveText("1");

  await page.keyboard.press("i");
  const search = page.getByLabel("Component search");
  await search.fill("r");
  await page.keyboard.press("r");
  await expect(page.getByTestId("revision")).toHaveText("1");
});

test("keeps component insertion and inspection from resizing the canvas", async ({
  page,
}) => {
  await page.goto("/editor");
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
  await page.getByTestId("selection-shelf").click();
  // Opening the dock changes its CSS width through a short transition. Poll
  // the resulting canvas geometry rather than sampling before that transition
  // has started.
  await expect
    .poll(async () => (await canvas.boundingBox())?.width ?? 0)
    .toBeLessThan(beforePlaceCanvas.width);

  await expect(page.getByTestId("selection-shelf")).toContainText("M1");
});

test("retains recovery across save and project replacement", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 360, y: 220 });
  await expect(page.getByTestId("revision")).toHaveText("1");

  // Saving downloads the formal Project but never clears the browser
  // recovery copies; waiting past the debounce proves they survive.
  await downloadBytes(page, "File", "Save Project");
  await page.waitForTimeout(500);
  await expect
    .poll(() => recoveryProjectTexts(page))
    .toContain('"revision": 1');

  await placeComponent(page, "resistor", { x: 500, y: 220 });
  await expect(page.getByTestId("revision")).toHaveText("2");
  // Let the debounced recovery write for revision 2 settle before replacing;
  // a replacement inside the window intentionally drops only the pending
  // write (stale-write protection), never the stored one.
  await expect
    .poll(() => recoveryProjectTexts(page))
    .toContain('"revision": 2');
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
  // The outgoing Project stays recoverable and the incoming Project seeds
  // its own working copy.
  await expect
    .poll(async () => {
      const texts = await recoveryProjectTexts(page);
      return (
        texts.includes('"revision": 2') &&
        texts.includes('"name": "Phase 1 Manual Editor"')
      );
    })
    .toBe(true);
});

test("discard recovery clears the recovery slot", async ({ page }) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 360, y: 220 });
  await expect
    .poll(() => recoveryProjectTexts(page))
    .toContain('"revision": 1');

  await page.reload();
  await clickCommand(page, "File", "Recover recent work…");
  await page
    .getByRole("dialog", { name: "Recover recent work" })
    .getByRole("button", { name: "Delete" })
    .click();
  await expect
    .poll(async () => (await readRecoveryRecords(page)).length)
    .toBe(0);
});

test("keeps the production command surface compact and publishes PWA metadata", async ({
  page,
}) => {
  await page.goto("/editor");
  const toolbar = page.getByRole("navigation", { name: "Editor commands" });
  for (const label of ["File", "Edit"]) {
    await expect(toolbar.locator("summary", { hasText: label })).toBeVisible();
  }
  // Drawing tools live in the always-visible toolbar, not behind a menu.
  await expect(toolbar.locator("summary", { hasText: "Draw" })).toHaveCount(0);
  await expect(page.getByTestId("draw-toolbar")).toBeVisible();
  await expect(toolbar.locator("summary", { hasText: "More" })).toHaveCount(0);
  await expect(toolbar.locator("summary", { hasText: "View" })).toHaveCount(0);
  await expect(toolbar.locator("summary", { hasText: "Style" })).toHaveCount(0);
  await expect(toolbar.locator("summary", { hasText: "Export" })).toHaveCount(
    0,
  );
  await clickDrawTool(page, "wire");
  await expect(page.getByTestId("active-tool")).toHaveText("wire");
  for (const obsolete of [
    "Select",
    "Junction",
    "Crossing",
    "Stretch",
    "Detach",
    "Guide",
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
    name: "Analog Canvas",
    display: "standalone",
  });
});

test("clears the active canvas atomically after confirmation and restores it with Undo", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 320, y: 240 });
  await placeComponent(page, "resistor", { x: 560, y: 240 });
  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-R1-2").click();
  await page.getByTestId("terminal-R2-1").click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("revision")).toHaveText("3");

  await clickCommand(page, "Edit", "Clear canvas");
  const clearDialog = page.getByRole("dialog", { name: "Clear Main?" });
  await expect(clearDialog).toContainText("You can restore them with Undo");
  await clearDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByTestId("revision")).toHaveText("3");
  await expect(page.getByTestId("status")).toHaveText("Clear canvas cancelled");

  await clickCommand(page, "Edit", "Clear canvas");
  await page
    .getByRole("dialog", { name: "Clear Main?" })
    .getByRole("button", { name: "Clear canvas" })
    .click();
  await expect(page.getByTestId("instance-count")).toHaveText("0");
  await expect(page.getByTestId("net-count")).toHaveText("0");
  await expect(page.locator('[data-layer="routes"] polyline')).toHaveCount(0);
  await expect(page.getByTestId("canvas-empty-state")).toBeVisible();
  await expect(page.getByTestId("revision")).toHaveText("4");
  await expect(page.getByTestId("status")).toHaveText(
    "Cleared Cell Main · Undo restores it",
  );

  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("instance-count")).toHaveText("2");
  await expect(page.getByTestId("net-count")).toHaveText("1");
  await expect(page.locator('[data-layer="routes"] polyline')).toHaveCount(1);
  await expect(page.getByTestId("revision")).toHaveText("5");
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
  await page.goto("/editor");
  const fileMenu = await openMenu(page, "File");
  await expect(fileMenu).toHaveAttribute("open", "");

  // The wordmark now navigates to the gallery, so dismiss on a neutral spot.
  await page.locator(".app-brand-copy p").click();
  await expect(fileMenu).not.toHaveAttribute("open", "");

  await openMenu(page, "File");
  await page.keyboard.press("Escape");
  await expect(fileMenu).not.toHaveAttribute("open", "");
});

test("selecting an object does not change canvas width", async ({ page }) => {
  await page.goto("/editor");
  const canvas = page.getByTestId("schematic-canvas");
  const widthBefore = (await canvas.boundingBox())!.width;

  // placeComponent selects the placed instance, which before E opened a right
  // Properties column and shrank the canvas. With the inspector in the left
  // dock, the canvas column count and width must stay constant.
  await placeComponent(page, "resistor", { x: 280, y: 180 });
  await expect(page.getByTestId("hit-R1")).toBeVisible();

  const widthAfter = (await canvas.boundingBox())!.width;
  expect(widthAfter).toBe(widthBefore);
});

test("opens project search with Ctrl+F and selects a matching component", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 420, y: 260 });
  await page.keyboard.press("Control+f");
  const input = page.getByTestId("project-search-input");
  await expect(input).toBeFocused();
  await input.fill("R1");
  await page.getByTestId("project-search-result-R1").click();
  await expect(page.getByTestId("status")).toContainText(
    "Selected instance R1",
  );
  await expect(page.getByTestId("project-search-input")).toHaveCount(0);
});

test("highlights the complete current-document Net from a selected route", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 380, y: 260 });
  await placeComponent(page, "resistor", { x: 600, y: 260 });
  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-R1-2").click();
  await page.getByTestId("terminal-R2-1").click();
  await page.keyboard.press("Escape");
  await clickRoute(page, "route-ui-1");
  await openSelectionShelf(page);
  await page.getByRole("button", { name: "Highlight Net (H)" }).click();
  await expect(page.getByTestId("net-highlight-overlay")).toHaveAttribute(
    "data-net-id",
    "net-ui-1",
  );
  await expect(
    page.locator(".net-highlight-overlay .net-highlight-core"),
  ).toHaveCount(1);
  await expect(
    page.locator(".net-highlight-overlay .net-highlight-endpoint"),
  ).toHaveCount(2);
  await expect(page.getByTestId("flightline")).toHaveCount(0);
  await page.keyboard.press("h");
  await expect(page.getByTestId("net-highlight-overlay")).toHaveCount(0);
});

test("recomputes highlighted routed components after a Net Label is deleted", async ({
  page,
}) => {
  const project = createEmptyProject(
    "label-highlight",
    "Label Highlight",
    "main",
  );
  const document = project.documents[0]!;
  document.nets = [
    {
      id: "net-historically-merged",
      scope: "local",
      terminals: [],
    },
  ];
  document.junctions = [
    {
      id: "left-a",
      netId: "net-historically-merged",
      position: { x: 180, y: 260 },
    },
    {
      id: "left-b",
      netId: "net-historically-merged",
      position: { x: 320, y: 260 },
    },
    {
      id: "right-a",
      netId: "net-historically-merged",
      position: { x: 480, y: 260 },
    },
    {
      id: "right-b",
      netId: "net-historically-merged",
      position: { x: 620, y: 260 },
    },
  ];
  document.routes = [
    {
      id: "route-left-label",
      netId: "net-historically-merged",
      from: { kind: "junction", junctionId: "left-a" },
      to: { kind: "junction", junctionId: "left-b" },
      waypoints: [],
      segmentModes: ["manual"],
    },
    {
      id: "route-right-label",
      netId: "net-historically-merged",
      from: { kind: "junction", junctionId: "right-a" },
      to: { kind: "junction", junctionId: "right-b" },
      waypoints: [],
      segmentModes: ["manual"],
    },
  ];
  document.annotations = [
    {
      id: "label-left-component",
      kind: "net-label",
      content: { runs: [{ kind: "text", value: "SIGNAL" }] },
      netId: "net-historically-merged",
      anchor: { kind: "free", position: { x: 250, y: 250 } },
      alignment: "middle",
      rotation: 0,
      locked: false,
    },
    {
      id: "label-right-component",
      kind: "net-label",
      content: { runs: [{ kind: "text", value: "SIGNAL" }] },
      netId: "net-historically-merged",
      anchor: { kind: "free", position: { x: 550, y: 250 } },
      alignment: "middle",
      rotation: 0,
      locked: false,
    },
  ];

  await page.goto("/editor");
  await page.getByTestId("project-file").setInputFiles({
    name: "label-highlight.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page.getByTestId("annotation-hit-label-left-component").click();
  await page.keyboard.press("h");
  await expect(
    page.locator(".net-highlight-overlay .net-highlight-core"),
  ).toHaveCount(2);
  await page.keyboard.press("h");

  await page.getByTestId("annotation-hit-label-right-component").click();
  await page.keyboard.press("Delete");
  await clickRoute(page, "route-left-label");
  await page.keyboard.press("h");
  await expect(
    page.locator(".net-highlight-overlay .net-highlight-core"),
  ).toHaveCount(1);
  await expect(
    page.locator(
      '.net-highlight-overlay .net-highlight-core[points="180,260 320,260"]',
    ),
  ).toHaveCount(1);
});

test("marks and clears an unconnected endpoint as No Connect", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 380, y: 260 });

  await page.getByTestId("terminal-R1-1").click({ button: "right" });
  await openSelectionShelf(page);
  await page.getByRole("button", { name: "Mark No Connect" }).click();
  await expect(page.getByTestId("status")).toContainText(
    "Marked terminal-R1-1 No Connect",
  );
  await expect(page.locator('[data-role="no-connect"]')).toHaveCount(1);

  await page.getByTestId("terminal-R1-1").click({ button: "right" });
  await page.getByRole("button", { name: "Clear No Connect" }).click();
  await expect(page.getByTestId("status")).toContainText(
    "Cleared No Connect on terminal-R1-1",
  );
  await expect(page.locator('[data-role="no-connect"]')).toHaveCount(0);
});

test("surfaces and locates current-document ERC diagnostics", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 380, y: 260 });
  await openSelectionShelf(page);
  await page
    .getByRole("region", { name: "Project diagnostics" })
    .locator("summary")
    .click();

  await expect(page.getByTestId("project-diagnostics")).toContainText(
    "ERC_UNCONNECTED_PIN",
  );
  await expect(page.getByTestId("diagnostic-severity-error")).toHaveCount(0);
  await page.getByTestId("diagnostic-severity-warning").click();
  await expect(page.getByTestId("project-diagnostics")).toContainText(
    "ERC_UNCONNECTED_PIN",
  );
  await page
    .getByTestId("project-diagnostics")
    .getByRole("button", { name: /ERC_UNCONNECTED_PIN/ })
    .first()
    .click();
  await expect(page.getByTestId("status")).toContainText("ERC_UNCONNECTED_PIN");
  await expect(
    page.getByRole("region", { name: "Endpoint actions" }),
  ).toBeVisible();
});

test("removes resolved live diagnostics and restores them through undo", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 380, y: 260 });
  await openSelectionShelf(page);
  await page
    .getByRole("region", { name: "Project diagnostics" })
    .locator("summary")
    .click();
  const diagnostics = page.getByTestId("project-diagnostics");
  await expect(diagnostics).toContainText("ERC_UNCONNECTED_PIN");

  for (const pinName of ["1", "2"]) {
    await page.getByTestId(`terminal-R1-${pinName}`).click({ button: "right" });
    await page.getByRole("button", { name: "Mark No Connect" }).click();
  }
  await expect(diagnostics).not.toContainText("ERC_UNCONNECTED_PIN");
  await expect(page.getByTestId("no-current-diagnostics")).toBeVisible();

  await page.keyboard.press("Control+z");
  await expect(diagnostics).toContainText("ERC_UNCONNECTED_PIN");

  await page.keyboard.press("Control+y");
  await expect(diagnostics).not.toContainText("ERC_UNCONNECTED_PIN");
});

test("filters and navigates locator-backed visual diagnostics", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 420, y: 300 });
  await placeComponent(page, "resistor", { x: 420, y: 300 });
  await openSelectionShelf(page);
  await page
    .getByRole("region", { name: "Project diagnostics" })
    .locator("summary")
    .click();

  await page.getByTestId("diagnostic-observations-toggle").click();
  const diagnostics = page.getByTestId("project-diagnostics");
  await expect(diagnostics).toContainText("VISUAL_SYMBOL_OVERLAP");
  await diagnostics
    .getByRole("button", { name: /VISUAL_SYMBOL_OVERLAP/ })
    .click();
  await expect(page.getByTestId("status")).toContainText(
    "VISUAL VISUAL_SYMBOL_OVERLAP",
  );
});

test("directional marquee: window needs full coverage, crossing selects on touch", async ({
  page,
}) => {
  await page.goto("/editor");
  await chooseComponent(page, "resistor");
  const canvas = page.getByTestId("schematic-canvas");
  await canvas.click({ position: { x: 420, y: 260 } });
  await page.keyboard.press("Escape");
  const hit = page.getByTestId("hit-R1");
  const bounds = await hit.boundingBox();
  if (!bounds) throw new Error("Placed resistor is not measurable");

  // Left-to-right window covering only the upper half: nothing is selected.
  const partial = {
    left: bounds.x - 20,
    top: bounds.y - 20,
    right: bounds.x + bounds.width + 20,
    middle: bounds.y + bounds.height / 2,
  };
  await page.mouse.move(partial.left, partial.top);
  await page.mouse.down();
  await page.mouse.move(partial.right, partial.middle, { steps: 4 });
  await expect(page.getByTestId("selection-box")).toHaveClass(
    "selection-box selection-box--window",
  );
  await page.mouse.up();
  await expect(page.getByTestId("status")).toContainText("Selection cleared");

  // The same rectangle dragged right-to-left is a crossing and selects R1.
  await page.mouse.move(partial.right, partial.top);
  await page.mouse.down();
  await page.mouse.move(partial.left, partial.middle, { steps: 4 });
  await expect(page.getByTestId("selection-box")).toHaveClass(
    "selection-box selection-box--crossing",
  );
  await page.mouse.up();
  await expect(page.getByTestId("status")).toContainText(/Selected \d+ object/);

  // A left-to-right window swallowing the whole symbol selects it too.
  await page.mouse.move(bounds.x - 30, bounds.y - 30);
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width + 30,
    bounds.y + bounds.height + 30,
    { steps: 4 },
  );
  await page.mouse.up();
  await expect(page.getByTestId("status")).toContainText(/Selected \d+ object/);

  // Marquee sweeps are gestures: they must never start a native browser text
  // selection over the SVG labels (the old distant-label highlight bug).
  expect(
    await page.evaluate(() => window.getSelection()?.toString() ?? ""),
  ).toBe("");
});

test("docked Document settings scale fonts document-wide and reset", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 320, y: 220 });
  const label = page.locator('[data-kind="instance-label"]').first();
  await expect(label).toHaveAttribute("font-size", "15.116");

  // The knobs rescale what the canvas is drawing, so they dock beside it
  // instead of covering it with a modal.
  await clickDrawTool(page, "document-style");
  const settings = page.getByLabel("Document settings");
  await expect(settings).toBeVisible();
  await expect(page.getByTestId("canvas-empty-state")).toHaveCount(0);
  await expect(page.getByTestId("hit-R1")).toBeVisible();
  const reset = page.getByTestId("document-style-reset");
  await expect(reset).toBeDisabled();

  await settings.getByLabel("Font size").selectOption("1.5");
  await expect(label).toHaveAttribute("font-size", "22.674");
  await expect(page.getByTestId("status")).toContainText(
    "Updated document style",
  );
  await expect(reset).toBeEnabled();

  // Document-wide MOS bulk defaults belong to the Document, not to whichever
  // transistor happens to be selected.
  await expect(settings.getByLabel("Default NMOS bulk Net")).toBeVisible();
  await expect(settings.getByLabel("Default PMOS bulk Net")).toBeVisible();

  await reset.click();
  await expect(label).toHaveAttribute("font-size", "15.116");
  await expect(reset).toBeDisabled();
  await clickDrawTool(page, "document-style");
  await expect(settings).toHaveCount(0);
});

test("middle-click steers which way the wire corner turns", async ({
  page,
}) => {
  await page.goto("/editor");
  const canvas = page.getByTestId("schematic-canvas");
  await clickDrawTool(page, "wire");

  const drawCorner = async (
    start: { x: number; y: number },
    end: typeof start,
  ) => {
    await canvas.click({ position: start });
    await canvas.dblclick({ position: end });
  };

  // Default corner carries the horizontal leg first.
  await drawCorner({ x: 200, y: 200 }, { x: 360, y: 300 });
  const horizontal = await readRoutePoints(page, await onlyRouteId(page));
  expect(horizontal).toHaveLength(3);
  expect(horizontal[1]!.y).toBe(horizontal[0]!.y);

  await clickCommand(page, "Edit", "Undo");
  await expect(page.locator('[data-testid^="route-hit-"]')).toHaveCount(0);

  // One middle-click flips the corner onto the other axis.
  await clickDrawTool(page, "wire");
  await canvas.click({ position: { x: 200, y: 200 } });
  await canvas.click({ button: "middle", position: { x: 260, y: 240 } });
  await canvas.click({ button: "middle", position: { x: 260, y: 240 } });
  await expect(page.getByTestId("status")).toContainText("vertical first");
  await canvas.dblclick({ position: { x: 360, y: 300 } });

  const vertical = await readRoutePoints(page, await onlyRouteId(page));
  expect(vertical).toHaveLength(3);
  expect(vertical[1]!.x).toBe(vertical[0]!.x);
});

test("resizes a plain Power Rail from its end handle", async ({ page }) => {
  await page.goto("/editor");
  const canvas = page.getByTestId("schematic-canvas");
  await page.getByTestId("shapes-chip-vdd").click();
  await canvas.click({ position: { x: 180, y: 120 } });
  await canvas.click({ position: { x: 520, y: 120 } });
  await page.keyboard.press("Escape");

  const before = await readRoutePoints(page, "route-vdd1-rail");
  await clickRoute(page, "route-vdd1-rail");

  // The end handle sits under the Junction's endpoint circle. The canvas
  // capture layer used to claim the press there and translate the whole rail,
  // which left a rail's length uneditable.
  await dragBy(page.getByTestId("junction-junction-vdd1-end"), {
    x: 100,
    y: 0,
  });
  await expect(page.getByTestId("status")).toContainText("Resized Power Rail");

  const after = await readRoutePoints(page, "route-vdd1-rail");
  const leftOf = (points: typeof before) =>
    Math.min(...points.map((point) => point.x));
  const rightOf = (points: typeof before) =>
    Math.max(...points.map((point) => point.x));
  expect(leftOf(after)).toBe(leftOf(before));
  expect(rightOf(after)).toBeGreaterThan(rightOf(before));
  expect(new Set(after.map((point) => point.y)).size).toBe(1);
});

test("keeps a long right-aligned Port label readable while editing", async ({
  page,
}) => {
  await page.goto("/editor");
  const canvas = page.getByTestId("schematic-canvas");
  await page.getByTestId("shapes-chip-port").click();
  await canvas.click({ position: { x: 400, y: 250 } });
  await page.keyboard.press("Escape");

  await page.getByTestId("annotation-hit-instance-label-P1").dblclick();
  const editable = page.locator(".rich-text-editable");
  await expect(editable).toBeVisible();
  await editable.click();
  await page.keyboard.type("VinputDifferentialPositive");

  // The overlay is a foreignObject, so anything past its frame is clipped
  // away silently rather than scrolled to.
  const overflow = await editable.evaluate((element) => ({
    hidden: element.scrollHeight - element.clientHeight,
    scrollable: getComputedStyle(element).overflowY,
  }));
  expect(overflow.hidden).toBeLessThanOrEqual(0);
  expect(overflow.scrollable).toBe("auto");
});

test("drags a marquee selection that holds no instance", async ({ page }) => {
  await page.goto("/editor");
  const canvas = page.getByTestId("schematic-canvas");

  await clickDrawTool(page, "wire");
  await canvas.click({ position: { x: 200, y: 200 } });
  await canvas.dblclick({ position: { x: 340, y: 200 } });
  await canvas.click({ position: { x: 200, y: 260 } });
  await canvas.dblclick({ position: { x: 340, y: 260 } });
  await page.keyboard.press("Escape");

  const readAll = () =>
    page
      .locator('[data-testid^="route-hit-"]')
      .evaluateAll((elements) =>
        elements.map((element) =>
          Array.from((element as unknown as SVGPolylineElement).points).map(
            (point) => ({ x: point.x, y: point.y }),
          ),
        ),
      );
  const before = await readAll();
  expect(before).toHaveLength(2);

  const bounds = (await canvas.boundingBox())!;
  await page.mouse.move(bounds.x + 150, bounds.y + 150);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 500, bounds.y + 330, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByTestId("status")).toContainText("Selected");

  // A marquee can hold only Routes and Junctions. Grabbing one of them used
  // to drag it out of its own selection and leave the rest behind.
  const grab = (await page
    .locator('[data-testid^="route-hit-"]')
    .first()
    .boundingBox())!;
  const x = grab.x + grab.width / 2;
  const y = grab.y + grab.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 60, { steps: 10 });
  await page.mouse.up();

  const after = await readAll();
  const shifts = after.map(
    (points, index) => points[0]!.y - before[index]![0]!.y,
  );
  expect(shifts[0]).toBeGreaterThan(0);
  expect(shifts[1]).toBe(shifts[0]);
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

test("draws a wire at an angle the 45-degree grid cannot reach", async ({
  page,
}) => {
  await page.goto("/editor");
  const canvas = page.getByTestId("schematic-canvas");
  await clickDrawTool(page, "wire");

  await canvas.click({ position: { x: 200, y: 200 } });
  // Middle-click cycles the corner shape and ends on any angle.
  for (let step = 0; step < 4; step += 1) {
    await canvas.click({ button: "middle", position: { x: 260, y: 240 } });
  }
  await expect(page.getByTestId("status")).toContainText("any angle");
  await canvas.dblclick({ position: { x: 430, y: 260 } });

  const points = await readRoutePoints(page, await onlyRouteId(page));
  expect(points).toHaveLength(2);
  const dx = Math.abs(points[1]!.x - points[0]!.x);
  const dy = Math.abs(points[1]!.y - points[0]!.y);
  // Neither axis-aligned nor 45 degrees: the leg reaches the endpoint direct.
  expect(dx).toBeGreaterThan(0);
  expect(dy).toBeGreaterThan(0);
  expect(dx).not.toBe(dy);
});
