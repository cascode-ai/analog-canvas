// How Wires and shapes look: colour, line style, direction arrows, Route
// appearance code, and shape fill and stacking.

import { parseSavedProject } from "./editor-fixtures";
import { expect, test } from "@playwright/test";
import { createEmptyProject } from "@icm/model";
import {
  clickDrawTool,
  downloadBytes,
  editComponentPropertyCode,
  readComponentPropertyCode,
} from "./editor-fixtures.js";
import {
  placeComponent,
  openSelectionShelf,
} from "./manual-editor-fixtures.js";
import { clickRoute, routeInk } from "./canvas-fixtures.js";

test("colors an electrical wire and restores the Razavi default with Auto", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 340, y: 220 });
  await placeComponent(page, "resistor", { x: 660, y: 220 });
  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-R1-2").click();
  await page.getByTestId("terminal-R2-1").click();
  await page.keyboard.press("Escape");

  await clickRoute(page, "route-ui-1");
  await openSelectionShelf(page);
  expect(JSON.parse(await readComponentPropertyCode(page)).color).toBe("auto");
  await editComponentPropertyCode(page, (code) => {
    code.color = [204, 34, 0];
  });
  await expect
    .poll(() => routeInk(page, "route-ui-1", "stroke"))
    .toBe("#cc2200");
  await expect(page.getByTestId("status")).toContainText(
    "Updated Route route-ui-1",
  );

  await editComponentPropertyCode(page, (code) => {
    code.color = "auto";
  });
  await expect.poll(() => routeInk(page, "route-ui-1", "stroke")).toBe("#000");
  expect(JSON.parse(await readComponentPropertyCode(page)).color).toBe("auto");
});

test("fills a closed shape and moves it behind or in front of circuit artwork", async ({
  page,
}) => {
  const project = createEmptyProject("shape-layers", "Shape layers");
  const document = project.documents[0]!;
  document.instances.push({
    id: "R1",
    symbolId: "resistor",
    placement: {
      position: { x: 100, y: 100 },
      rotation: 0,
      mirror: "none",
    },
  });
  document.drafting = {
    objects: [
      {
        id: "box",
        kind: "rectangle",
        locked: false,
        zIndex: 0,
        anchor: { kind: "free", position: { x: 100, y: 100 } },
        center: { x: 100, y: 100 },
        width: 100,
        height: 60,
        rotation: 0,
        lineStyle: "solid",
        styleOverride: { fillColor: "#9ca3af" },
      },
    ],
  };
  await page.goto("/editor");
  await page.getByTestId("project-file").setInputFiles({
    name: "shape-layers.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  const shapeHit = page.getByTestId("drafting-hit-box");
  await shapeHit.click({ force: true, modifiers: ["Alt"] });
  await openSelectionShelf(page);

  const properties = page.getByRole("complementary", { name: "Properties" });
  await expect(
    properties.getByText("Bring to front", { exact: true }),
  ).toBeVisible();
  await expect(
    properties.getByText("Send to back", { exact: true }),
  ).toBeVisible();
  await properties.getByRole("button", { name: "Edit fill color" }).click();
  await page.getByRole("button", { name: "Use Blue for fill" }).click();
  await expect(
    page.locator('[data-kind="draft-rectangle"][data-object-id="box"]'),
  ).toHaveAttribute("fill", "#2563eb");

  await properties.getByRole("button", { name: "Send to back" }).click();
  await expect(
    page.locator('[data-drafting-layer="background"] [data-object-id="box"]'),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(
    page.locator('[data-drafting-layer="foreground"] [data-object-id="box"]'),
  ).toHaveCount(1);

  await properties.getByRole("button", { name: "Bring to front" }).click();
  const saved = parseSavedProject(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
  );
  expect(saved.documents[0].drafting.objects[0]).toMatchObject({
    id: "box",
    layer: "foreground",
    zIndex: 1,
    styleOverride: { fillColor: "#2563eb" },
  });
});

test("changes wire line style while preserving color, arrow, export and undo", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 340, y: 220 });
  await placeComponent(page, "resistor", { x: 660, y: 220 });
  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-R1-2").click();
  await page.getByTestId("terminal-R2-1").click();
  await page.keyboard.press("Escape");
  await clickRoute(page, "route-ui-1");
  await openSelectionShelf(page);
  expect(JSON.parse(await readComponentPropertyCode(page)).appearance).toEqual({
    lineStyle: "solid",
    directionArrow: "none",
  });
  await editComponentPropertyCode(page, (code) => {
    code.color = [220, 38, 38];
    code.appearance = {
      lineStyle: "dashed",
      directionArrow: "end",
    };
  });
  await expect
    .poll(() => routeInk(page, "route-ui-1", "stroke-dasharray"))
    .toBe("6 4");
  await expect
    .poll(() => routeInk(page, "route-ui-1", "stroke"))
    .toBe("#dc2626");
  const arrow = page.locator(
    '[data-layer="routes"] [data-role="route-direction-arrow"]',
  );
  await expect(arrow).toHaveAttribute("data-arrow-position", "end");
  await expect(arrow).toHaveAttribute("fill", "#dc2626");
  await editComponentPropertyCode(page, (code) => {
    code.appearance.lineStyle = "dotted";
  });
  await expect
    .poll(() => routeInk(page, "route-ui-1", "stroke-dasharray"))
    .toBe("2 3");
  await page.getByTestId("draw-tool-undo").click();
  expect(
    JSON.parse(await readComponentPropertyCode(page)).appearance.lineStyle,
  ).toBe("dashed");
  await expect
    .poll(() => routeInk(page, "route-ui-1", "stroke-dasharray"))
    .toBe("6 4");
  await page.getByTestId("draw-tool-redo").click();
  expect(
    JSON.parse(await readComponentPropertyCode(page)).appearance.lineStyle,
  ).toBe("dotted");
  const saved = await downloadBytes(page, "File", "Export Project File…");
  expect(
    parseSavedProject(saved.toString("utf8")).documents[0].routes[0]
      .styleOverride,
  ).toEqual({
    lineStyle: "dotted",
    color: "#dc2626",
    arrow: "end",
  });
  const svg = (await downloadBytes(page, "File", "Export SVG")).toString(
    "utf8",
  );
  // Export must reproduce the authored world geometry regardless of the
  // toolbar/sidebar dimensions used to place it on screen.
  const liveRoute = page.locator(
    '[data-layer="routes"] polyline[data-object-id="route-ui-1"]',
  );
  const points = await liveRoute.getAttribute("points");
  const ink = await page
    .locator('[data-layer="routes"] [data-role="conductor-ink"]')
    .first()
    .getAttribute("d");
  expect(points).toBeTruthy();
  expect(ink).toBeTruthy();
  const exported = await page.evaluate((source) => {
    const svg = new DOMParser().parseFromString(source, "image/svg+xml");
    return {
      points: svg
        .querySelector('polyline[data-object-id="route-ui-1"]')
        ?.getAttribute("points"),
      ink: svg.querySelector('[data-role="conductor-ink"]')?.getAttribute("d"),
      dash: svg
        .querySelector('[data-role="conductor-ink"]')
        ?.getAttribute("stroke-dasharray"),
    };
  }, svg);
  expect(exported).toEqual({ points, ink, dash: "2 3" });
  expect(svg).toContain('data-role="route-direction-arrow"');
  const pdf = await downloadBytes(page, "File", "Export PDF");
  expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  await page.getByTestId("project-file").setInputFiles({
    name: "styled-wire.icproj.json",
    mimeType: "application/json",
    buffer: saved,
  });
  await clickRoute(page, "route-ui-1");
  await openSelectionShelf(page);
  expect(
    JSON.parse(await readComponentPropertyCode(page)).appearance.lineStyle,
  ).toBe("dotted");
  await expect
    .poll(() => routeInk(page, "route-ui-1", "stroke"))
    .toBe("#dc2626");
  await editComponentPropertyCode(page, (code) => {
    code.appearance.lineStyle = "solid";
  });
  await expect
    .poll(() => routeInk(page, "route-ui-1", "stroke-dasharray"))
    .toBeNull();
  await expect(arrow).toHaveAttribute("data-arrow-position", "end");
});

test("places and clears an independent direction arrow on one wire", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 340, y: 220 });
  await placeComponent(page, "resistor", { x: 660, y: 220 });
  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-R1-2").click();
  await page.getByTestId("terminal-R2-1").click();
  await page.keyboard.press("Escape");

  await clickRoute(page, "route-ui-1");
  await openSelectionShelf(page);
  const arrow = page.locator(
    '[data-layer="routes"] [data-role="route-direction-arrow"]',
  );

  await editComponentPropertyCode(page, (code) => {
    code.appearance.directionArrow = "middle";
  });
  await expect(arrow).toHaveAttribute("data-arrow-position", "middle");
  await expect(arrow).toHaveAttribute("pointer-events", "none");
  await expect(page.getByTestId("status")).toContainText(
    "Updated Route route-ui-1",
  );

  await editComponentPropertyCode(page, (code) => {
    code.appearance.directionArrow = "end";
  });
  await expect(arrow).toHaveCount(1);
  await expect(arrow).toHaveAttribute("data-arrow-position", "end");

  await editComponentPropertyCode(page, (code) => {
    code.appearance.directionArrow = "none";
  });
  await expect(arrow).toHaveCount(0);
  await expect(page.getByTestId("status")).toContainText(
    "Updated Route route-ui-1",
  );
});

test("applies Route name, scope, and appearance from one JSON edit", async ({
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
  await openSelectionShelf(page);

  const properties = page.getByRole("complementary", { name: "Properties" });
  await expect(properties.getByLabel("Annotation property code")).toBeVisible();
  await expect(properties.getByLabel("Electrical Net label")).toHaveCount(0);
  expect(JSON.parse(await readComponentPropertyCode(page))).toMatchObject({
    type: "wire",
    name: "",
    color: "auto",
    net: { scope: "local" },
    appearance: {
      lineStyle: "solid",
      directionArrow: "none",
    },
  });
  const revision = Number(await page.getByTestId("revision").textContent());
  await editComponentPropertyCode(page, (code) => {
    code.name = "SIGNAL";
    code.net.scope = "global";
    code.color = [220, 38, 38];
    code.appearance = {
      lineStyle: "dotted",
      directionArrow: "end",
    };
  });
  await expect(page.getByTestId("revision")).toHaveText(String(revision + 1));
  const saved = parseSavedProject(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
  );
  expect(saved.documents[0].routes[0].styleOverride).toEqual({
    color: "#dc2626",
    lineStyle: "dotted",
    arrow: "end",
  });
  expect(saved.documents[0].connectivityEvidence).toContainEqual(
    expect.objectContaining({
      kind: "name-claim",
      name: "SIGNAL",
      scope: "global",
      owner: {
        kind: "net-label",
        annotationId: "net-label-route-ui-1",
      },
    }),
  );
  await page.getByTestId("draw-tool-undo").click();
  await expect(page.getByTestId("revision")).toHaveText(String(revision + 2));
  expect(JSON.parse(await readComponentPropertyCode(page))).toMatchObject({
    type: "wire",
    name: "",
    color: "auto",
    net: { scope: "local" },
    appearance: {
      lineStyle: "solid",
      directionArrow: "none",
    },
  });
});

test("Shift-click gathers wires, and one color change restyles all of them", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 280, y: 180 });
  await placeComponent(page, "resistor", { x: 480, y: 180 });
  await placeComponent(page, "resistor", { x: 680, y: 180 });
  for (const [from, to] of [
    ["R1-2", "R2-1"],
    ["R2-2", "R3-1"],
  ]) {
    await clickDrawTool(page, "wire");
    await page.getByTestId(`terminal-${from}`).click();
    await page.getByTestId(`terminal-${to}`).click();
    await page.keyboard.press("Escape");
  }
  const first = page.getByTestId("route-hit-route-ui-1");
  const second = page.getByTestId("route-hit-route-ui-2");

  await clickRoute(page, "route-ui-1");
  await page.keyboard.down("Shift");
  await clickRoute(page, "route-ui-2");
  await page.keyboard.up("Shift");
  await expect(page.getByTestId("status")).toContainText(
    "Added wire route-ui-2 to the selection",
  );
  await expect(first).toHaveClass(/selected/);
  await expect(second).toHaveClass(/selected/);

  await openSelectionShelf(page);
  await expect(page.getByTestId("route-batch-note")).toContainText(
    "2 wires selected",
  );
  await editComponentPropertyCode(page, (code) => {
    code.color = [220, 38, 38];
  });
  await expect
    .poll(async () =>
      parseSavedProject(
        (await downloadBytes(page, "File", "Export Project File…")).toString(
          "utf8",
        ),
      ).documents[0].routes.map(
        (route: { styleOverride?: { color?: string } }) =>
          route.styleOverride?.color,
      ),
    )
    .toEqual(["#dc2626", "#dc2626"]);

  // Shift-clicking a selected wire takes it back out.
  await page.keyboard.down("Shift");
  await clickRoute(page, "route-ui-1");
  await page.keyboard.up("Shift");
  await expect(first).not.toHaveClass(/selected/);
  await expect(second).toHaveClass(/selected/);
});
