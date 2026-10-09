// Finding and selecting what is drawn: Find, the Selection Filter, marquee
// direction, Net highlight and ERC diagnostics.

import { createRoutePath } from "@icm/model";
import { expect, test } from "@playwright/test";
import type { Locator } from "@playwright/test";
import { createEmptyProject } from "@icm/model";
import {
  chooseComponent,
  clickDrawTool,
  clickNetlistWorkflowCommand,
} from "./editor-fixtures.js";
import {
  placeComponent,
  openSelectionShelf,
} from "./manual-editor-fixtures.js";
import { clickRoute } from "./canvas-fixtures.js";

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

test("opens circuit Find with Ctrl+F and selects a matching component", async ({
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

test("opens selectable-object choices with Ctrl+Shift+F and filters Select All", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 380, y: 260 });
  await placeComponent(page, "resistor", { x: 600, y: 260 });
  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-R1-2").click();
  await page.getByTestId("terminal-R2-1").click();
  await page.keyboard.press("Escape");

  await page.keyboard.press("Control+Shift+f");
  const filter = page.getByTestId("selection-filter-popover");
  await expect(filter).toBeVisible();
  await filter.getByRole("button", { name: "None" }).click();
  await filter.getByLabel("Wires").check();
  await filter.getByRole("button", { name: "Close" }).click();
  await expect(page.getByTestId("selection-filter-status")).toContainText(
    "Filter: Wires",
  );

  await page.keyboard.press("Control+a");
  await expect(page.getByTestId("route-hit-route-ui-1")).toHaveClass(
    /selected/,
  );
  await expect(page.getByTestId("hit-R1")).not.toHaveClass(/selected/);
  await expect(page.getByTestId("hit-R2")).not.toHaveClass(/selected/);
  await page.getByTestId("hit-R1").click();
  await expect(page.getByTestId("hit-R1")).not.toHaveClass(/selected/);

  await page.getByTestId("selection-filter-status").click();
  await filter.getByRole("button", { name: "None" }).click();
  await filter.getByLabel("Instances").check();
  await filter.getByRole("button", { name: "Close" }).click();
  await expect(page.locator(".route-handle")).toHaveCount(0);
  await page.keyboard.press("Control+d");
  await page.getByTestId("route-hit-route-ui-1").click({ force: true });
  await expect(page.getByTestId("route-hit-route-ui-1")).not.toHaveClass(
    /selected/,
  );
});

test("Selection Filter blocks direct wire, junction, and shape operations", async ({
  page,
}) => {
  const project = createEmptyProject("selection-policy", "Selection policy");
  const document = project.documents[0]!;
  document.nets.push({ id: "net-1", terminals: [] });
  document.junctions.push(
    {
      id: "left",
      netId: "net-1",
      position: { x: 240, y: 220 },
      role: "route-anchor",
    },
    {
      id: "right",
      netId: "net-1",
      position: { x: 440, y: 220 },
      role: "route-anchor",
    },
  );
  document.routes.push(
    createRoutePath({
      id: "filtered-wire",
      netId: "net-1",
      start: { kind: "junction", junctionId: "left" },
      end: { kind: "junction", junctionId: "right" },
      bends: [],
      modes: ["manual"],
    }),
  );
  document.drafting = {
    objects: [
      {
        id: "filtered-shape",
        kind: "rectangle",
        locked: false,
        zIndex: 0,
        anchor: { kind: "free", position: { x: 340, y: 340 } },
        center: { x: 340, y: 340 },
        width: 160,
        height: 80,
        rotation: 0,
        lineStyle: "solid",
      },
    ],
  };
  await page.goto("/editor");
  await page.getByTestId("project-file").setInputFiles({
    name: "selection-policy.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });

  await page.keyboard.press("Control+Shift+f");
  const filter = page.getByTestId("selection-filter-popover");
  await filter.getByRole("button", { name: "None" }).click();
  await filter.getByRole("button", { name: "Close" }).click();

  const screenPoint = async (locator: Locator, pointIndex = 0) =>
    locator.evaluate((element, index) => {
      const svg = (element as SVGGraphicsElement).ownerSVGElement;
      const matrix = (element as SVGGraphicsElement).getScreenCTM();
      if (!svg || !matrix) throw new Error("SVG hit target is not measurable");
      const point = svg.createSVGPoint();
      if (element instanceof SVGCircleElement) {
        point.x = element.cx.baseVal.value;
        point.y = element.cy.baseVal.value;
      } else {
        const vertex = (element as SVGPolylineElement).points[index];
        if (!vertex) throw new Error("SVG hit target has no point");
        point.x = vertex.x;
        point.y = vertex.y;
      }
      const screen = point.matrixTransform(matrix);
      return { x: screen.x, y: screen.y };
    }, pointIndex);

  const route = page.getByTestId("route-hit-filtered-wire");
  const routeStart = await screenPoint(route);
  const routeEnd = await screenPoint(route, 1);
  const routeCenter = {
    x: (routeStart.x + routeEnd.x) / 2,
    y: (routeStart.y + routeEnd.y) / 2,
  };
  const shape = page.getByTestId("drafting-hit-filtered-shape");
  const shapeCorner = await screenPoint(shape);
  const junction = page.getByTestId("junction-left");
  const junctionPoint = await screenPoint(junction);

  for (const point of [routeCenter, junctionPoint, shapeCorner]) {
    await page.mouse.click(point.x, point.y);
  }
  await expect(route).not.toHaveClass(/selected/u);
  await expect(junction).not.toHaveClass(/active/u);
  await expect(shape).not.toHaveClass(/selected/u);

  const routePointsBefore = await route.getAttribute("points");
  const shapeBoundsBefore = await shape.boundingBox();
  await page.mouse.move(routeCenter.x, routeCenter.y);
  await page.mouse.down();
  await page.mouse.move(routeCenter.x + 80, routeCenter.y + 50, { steps: 4 });
  await page.mouse.up();
  await page.mouse.move(shapeCorner.x, shapeCorner.y);
  await page.mouse.down();
  await page.mouse.move(shapeCorner.x + 80, shapeCorner.y + 50, { steps: 4 });
  await page.mouse.up();
  expect(await route.getAttribute("points")).toBe(routePointsBefore);
  expect(await shape.boundingBox()).toEqual(shapeBoundsBefore);

  await page.keyboard.press("Delete");
  await page.mouse.click(routeCenter.x, routeCenter.y);
  await page.mouse.click(shapeCorner.x, shapeCorner.y);
  await page.keyboard.press("Escape");
  await expect(route).toHaveCount(1);
  await expect(shape).toHaveCount(1);

  await page.mouse.dblclick(shapeCorner.x, shapeCorner.y);
  await expect(page.locator('[data-testid^="drafting-hit-note-"]')).toHaveCount(
    0,
  );
  await page.mouse.click(routeCenter.x, routeCenter.y, { button: "right" });
  await expect(route).not.toHaveClass(/selected/u);
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
    createRoutePath({
      id: "route-left-label",
      netId: "net-historically-merged",
      start: { kind: "junction", junctionId: "left-a" },
      end: { kind: "junction", junctionId: "left-b" },
      bends: [],
      modes: ["manual"],
    }),
    createRoutePath({
      id: "route-right-label",
      netId: "net-historically-merged",
      start: { kind: "junction", junctionId: "right-a" },
      end: { kind: "junction", junctionId: "right-b" },
      bends: [],
      modes: ["manual"],
    }),
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

test("surfaces and locates current-document ERC diagnostics", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 380, y: 260 });
  await clickNetlistWorkflowCommand(page, "check-and-save");
  await expect(page.getByTestId("check-and-save")).toBeEnabled();

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

test("rechecks resolved diagnostics and invalidates them through undo", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 380, y: 260 });
  await clickNetlistWorkflowCommand(page, "check-and-save");
  await expect(page.getByTestId("check-and-save")).toBeEnabled();
  const diagnostics = page.getByTestId("project-diagnostics");
  await expect(diagnostics).toContainText("ERC_UNCONNECTED_PIN");

  for (const pinName of ["1", "2"]) {
    await page.getByTestId(`terminal-R1-${pinName}`).click({ button: "right" });
    await page.getByRole("button", { name: "Mark No Connect" }).click();
  }
  await expect(page.getByTestId("statusbar-issues")).toHaveText(
    "Check out of date",
  );
  await expect(page.locator(".diagnostic-marker")).toHaveCount(0);
  await clickNetlistWorkflowCommand(page, "check-and-save");
  await expect(page.getByTestId("check-and-save")).toBeEnabled();
  await expect(diagnostics).not.toContainText("ERC_UNCONNECTED_PIN");
  await expect(page.getByTestId("no-current-diagnostics")).toBeVisible();

  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("statusbar-issues")).toHaveText(
    "Check out of date",
  );
  await clickNetlistWorkflowCommand(page, "check-and-save");
  await expect(page.getByTestId("check-and-save")).toBeEnabled();
  await expect(diagnostics).toContainText("ERC_UNCONNECTED_PIN");

  await page.keyboard.press("Control+y");
  await expect(page.getByTestId("statusbar-issues")).toHaveText(
    "Check out of date",
  );
  await clickNetlistWorkflowCommand(page, "check-and-save");
  await expect(diagnostics).not.toContainText("ERC_UNCONNECTED_PIN");
});

test("filters and navigates locator-backed visual diagnostics", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 420, y: 300 });
  await placeComponent(page, "resistor", { x: 420, y: 300 });
  await clickNetlistWorkflowCommand(page, "check-and-save");
  await expect(page.getByTestId("check-and-save")).toBeEnabled();

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
