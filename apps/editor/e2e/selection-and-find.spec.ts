// Finding and selecting what is drawn: Find, the Selection Filter, marquee
// direction, Net highlight and ERC diagnostics.

import { createEmptyProject } from "@icm/model";
import { expect, test } from "@playwright/test";
import {
  clickNetlistWorkflowCommand,
  expectStatus,
  openProject,
  placeComponentAt,
} from "./editor-fixtures.js";
import {
  placeComponent,
  openSelectionShelf,
} from "./manual-editor-fixtures.js";
import {
  addStraightWire,
  clickRoute,
  junctionRoute,
  onScreen,
  routeAnchor,
  drawWire,
} from "./canvas-fixtures.js";

test("marquee release uses the last pointer sample before a browser frame", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 400, y: 260 });
  await placeComponent(page, "resistor", { x: 620, y: 260 });
  await page.keyboard.press("Control+d");
  const canvas = page.getByTestId("schematic-canvas");
  const boxes = await Promise.all([
    page.getByTestId("hit-R1").boundingBox(),
    page.getByTestId("hit-R2").boundingBox(),
  ]);
  const surface = (await canvas.boundingBox())!;
  const start = {
    x: Math.max(surface.x + 10, Math.min(...boxes.map((b) => b!.x)) - 35),
    y: Math.max(surface.y + 10, Math.min(...boxes.map((b) => b!.y)) - 45),
  };
  const end = {
    x: Math.max(...boxes.map((b) => b!.x + b!.width)) + 35,
    y: Math.max(...boxes.map((b) => b!.y + b!.height)) + 45,
  };
  await canvas.evaluate((element) => {
    element.addEventListener(
      "pointerdown",
      (event) =>
        element.setAttribute(
          "data-audit-pointer-id",
          String((event as PointerEvent).pointerId),
        ),
      { once: true },
    );
  });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await expect(page.getByTestId("selection-box")).toBeVisible();
  await canvas.evaluate(
    (element, { start, end }) => {
      const pointerId = Number(element.getAttribute("data-audit-pointer-id"));
      for (let index = 1; index <= 20; index++) {
        element.dispatchEvent(
          new PointerEvent("pointermove", {
            bubbles: true,
            pointerId,
            pointerType: "mouse",
            isPrimary: true,
            buttons: 1,
            clientX: start.x + ((end.x - start.x) * index) / 20,
            clientY: start.y + ((end.y - start.y) * index) / 20,
          }),
        );
      }
      // One browser task: no rAF or React publication between the final move
      // and release. Events go through the real canvas controller.
      element.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          pointerId,
          pointerType: "mouse",
          isPrimary: true,
          button: 0,
          buttons: 0,
          clientX: end.x,
          clientY: end.y,
        }),
      );
      element.removeAttribute("data-audit-pointer-id");
    },
    { start, end },
  );
  await page.mouse.up();
  await expect(page.getByTestId("hit-R1")).toHaveClass(/selected/u);
  await expect(page.getByTestId("hit-R2")).toHaveClass(/selected/u);
  await expect(page.getByTestId("selection-box")).toHaveCount(0);
});

for (const replacement of ["Escape", "w"]) {
  test(`${replacement} retires queued marquee samples before release`, async ({
    page,
  }) => {
    await page.goto("/editor");
    await placeComponent(page, "resistor", { x: 440, y: 260 });
    await page.keyboard.press("Control+d");
    const canvas = page.getByTestId("schematic-canvas");
    const box = (await page.getByTestId("hit-R1").boundingBox())!;
    const start = { x: box.x - 40, y: box.y - 40 };
    const end = { x: box.x + box.width + 40, y: box.y + box.height + 40 };
    await canvas.evaluate((element) => {
      element.addEventListener(
        "pointerdown",
        (event) =>
          element.setAttribute(
            "data-audit-pointer-id",
            String((event as PointerEvent).pointerId),
          ),
        { once: true },
      );
    });
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await expect(page.getByTestId("selection-box")).toHaveCount(1);
    await canvas.evaluate(
      (element, { end, replacement }) => {
        const pointerId = Number(element.getAttribute("data-audit-pointer-id"));
        const sample = {
          bubbles: true,
          pointerId,
          pointerType: "mouse",
          isPrimary: true,
          buttons: 1,
          clientX: end.x,
          clientY: end.y,
        };
        element.dispatchEvent(new PointerEvent("pointermove", sample));
        window.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: replacement,
            code: replacement === "Escape" ? "Escape" : "KeyW",
            bubbles: true,
          }),
        );
        element.dispatchEvent(new PointerEvent("pointermove", sample));
        element.dispatchEvent(
          new PointerEvent("pointerup", { ...sample, buttons: 0 }),
        );
        element.removeAttribute("data-audit-pointer-id");
      },
      { end, replacement },
    );
    await page.mouse.up();
    await expect(page.getByTestId("selection-box")).toHaveCount(0);
    await expect(page.getByTestId("hit-R1")).not.toHaveClass(/selected/u);
    if (replacement === "w") await page.keyboard.press("Escape");
    await page.keyboard.press("Control+a");
    await expect(page.getByTestId("hit-R1")).toHaveClass(/selected/u);
  });
}

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
  await expectStatus(page, "Selected instance R1");
  await expect(page.getByTestId("project-search-input")).toHaveCount(0);
});

test("opens selectable-object choices with Ctrl+Shift+F, filters Select All, and Ctrl+D deselects", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 380, y: 260 });
  await placeComponent(page, "resistor", { x: 600, y: 260 });
  await drawWire(page, "R1-2", "R2-1");

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
  // Ctrl+D deselects without letting the browser bookmark the page, and
  // Delete then has nothing to remove.
  await page.keyboard.press("Control+d");
  await expect(page.getByTestId("status")).toHaveText("Selection cleared");
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("route-hit-route-ui-1")).toHaveCount(1);
  await page.keyboard.press("Control+a");
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
  addStraightWire(
    document,
    "filtered-wire",
    routeAnchor("left", "net-1", 240, 220),
    routeAnchor("right", "net-1", 440, 220),
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
  await openProject(page, project);

  await page.keyboard.press("Control+Shift+f");
  const filter = page.getByTestId("selection-filter-popover");
  await filter.getByRole("button", { name: "None" }).click();
  await filter.getByRole("button", { name: "Close" }).click();

  // The wire's middle, its left Junction and the rectangle's corner.
  const [routeCenter, junctionPoint, shapeCorner] = await onScreen(
    page.getByTestId("schematic-canvas"),
    [
      { x: 340, y: 220 },
      { x: 240, y: 220 },
      { x: 260, y: 300 },
    ],
  );
  const route = page.getByTestId("route-hit-filtered-wire");
  const shape = page.getByTestId("drafting-hit-filtered-shape");
  const junction = page.getByTestId("junction-left");

  for (const point of [routeCenter, junctionPoint, shapeCorner]) {
    await page.mouse.click(point.x, point.y);
  }
  await expect(route).not.toHaveClass(/selected/u);
  await expect(junction).not.toHaveClass(/active/u);
  await expect(shape).not.toHaveClass(/selected/u);

  const routePointsBefore = await route.getAttribute("points");
  const shapeBoundsBefore = await shape.boundingBox();
  for (const point of [routeCenter, shapeCorner]) {
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + 80, point.y + 50, { steps: 4 });
    await page.mouse.up();
  }
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

test("highlights a selected route's whole Net and recomputes it after a Net Label is deleted", async ({
  page,
}) => {
  const project = createEmptyProject(
    "label-highlight",
    "Label Highlight",
    "main",
  );
  const document = project.documents[0]!;
  document.nets = [{ id: "net-historically-merged", terminals: [] }];
  document.junctions = (
    [
      ["left-a", 180],
      ["left-b", 320],
      ["right-a", 480],
      ["right-b", 620],
    ] as const
  ).map(([id, x]) => ({
    id,
    netId: "net-historically-merged",
    position: { x, y: 260 },
  }));
  document.routes = (["left", "right"] as const).map((side) =>
    junctionRoute(
      `route-${side}-label`,
      "net-historically-merged",
      `${side}-a`,
      `${side}-b`,
    ),
  );
  document.annotations = (
    [
      ["left", 250],
      ["right", 550],
    ] as const
  ).map(([side, x]) => ({
    id: `label-${side}-component`,
    kind: "net-label",
    content: { runs: [{ kind: "text", value: "SIGNAL" }] },
    netId: "net-historically-merged",
    anchor: { kind: "free", position: { x, y: 250 } },
    alignment: "middle",
    rotation: 0,
    locked: false,
  }));
  await openProject(page, project);
  const cores = page.locator(".net-highlight-overlay .net-highlight-core");

  // Both same-name pieces belong to the Net the selected route is on.
  await clickRoute(page, "route-left-label");
  await openSelectionShelf(page);
  await page.getByRole("button", { name: "Highlight Net (H)" }).click();
  await expect(page.getByTestId("net-highlight-overlay")).toBeVisible();
  await expect(cores).toHaveCount(2);
  await expect(page.getByTestId("flightline")).toHaveCount(0);
  await page.keyboard.press("h");
  await expect(page.getByTestId("net-highlight-overlay")).toHaveCount(0);

  // Without the right label, only the left piece is still on that Net.
  await page.getByTestId("annotation-hit-label-right-component").click();
  await page.keyboard.press("Delete");
  await clickRoute(page, "route-left-label");
  await page.keyboard.press("h");
  await expect(cores).toHaveCount(1);
  await expect(
    page.locator(
      '.net-highlight-overlay .net-highlight-core[points="180,260 320,260"]',
    ),
  ).toHaveCount(1);
});

test("surfaces, filters and locates current-document ERC and visual diagnostics", async ({
  page,
}) => {
  await page.goto("/editor");
  // A lone part with open pins, and two parts drawn over each other.
  await placeComponent(page, "resistor", { x: 420, y: 300 });
  await placeComponent(page, "resistor", { x: 220, y: 300 });
  await placeComponent(page, "resistor", { x: 220, y: 300 });
  await clickNetlistWorkflowCommand(page, "check-and-save");
  await expect(page.getByTestId("check-and-save")).toBeEnabled();
  const diagnostics = page.getByTestId("project-diagnostics");

  await expect(diagnostics).toContainText("ERC_UNCONNECTED_PIN");
  await expect(page.getByTestId("diagnostic-severity-error")).toHaveCount(0);
  await page.getByTestId("diagnostic-severity-warning").click();
  await expect(diagnostics).toContainText("ERC_UNCONNECTED_PIN");
  await diagnostics
    .getByRole("button", { name: /ERC_UNCONNECTED_PIN/ })
    .first()
    .click();
  await expectStatus(page, "ERC_UNCONNECTED_PIN");
  await expect(
    page.getByRole("region", { name: "Endpoint actions" }),
  ).toBeVisible();

  // Observations, such as two parts drawn on top of each other, are behind
  // their own toggle and locate the same way.
  await page.getByTestId("statusbar-issues").click();
  await page.getByTestId("diagnostic-observations-toggle").click();
  await expect(diagnostics).toContainText("VISUAL_SYMBOL_OVERLAP");
  await diagnostics
    .getByRole("button", { name: /VISUAL_SYMBOL_OVERLAP/ })
    .click();
  await expectStatus(page, "VISUAL VISUAL_SYMBOL_OVERLAP");
});

test("rechecks resolved diagnostics and invalidates them through undo", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 380, y: 260 });
  await clickNetlistWorkflowCommand(page, "check-and-save");
  await expect(page.getByTestId("check-and-save")).toBeEnabled();
  const issues = page.getByTestId("statusbar-issues");
  const diagnostics = page.getByTestId("project-diagnostics");
  await expect(diagnostics).toContainText("ERC_UNCONNECTED_PIN");

  for (const pinName of ["1", "2"]) {
    await page.getByTestId(`terminal-R1-${pinName}`).click({ button: "right" });
    await page.getByRole("button", { name: "Mark No Connect" }).click();
  }
  await expect(issues).toHaveText("Check out of date");
  await expect(page.locator(".diagnostic-marker")).toHaveCount(0);
  await clickNetlistWorkflowCommand(page, "check-and-save");
  await expect(page.getByTestId("check-and-save")).toBeEnabled();
  await expect(diagnostics).not.toContainText("ERC_UNCONNECTED_PIN");
  await expect(page.getByTestId("no-current-diagnostics")).toBeVisible();

  await page.keyboard.press("Control+z");
  await expect(issues).toHaveText("Check out of date");
  await clickNetlistWorkflowCommand(page, "check-and-save");
  await expect(page.getByTestId("check-and-save")).toBeEnabled();
  await expect(diagnostics).toContainText("ERC_UNCONNECTED_PIN");

  await page.keyboard.press("Control+y");
  await expect(issues).toHaveText("Check out of date");
  await clickNetlistWorkflowCommand(page, "check-and-save");
  await expect(diagnostics).not.toContainText("ERC_UNCONNECTED_PIN");
});

test("directional marquee: window needs full coverage, crossing selects on touch", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponentAt(page, "resistor", { x: 420, y: 260 });
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
  await expectStatus(page, "Selection cleared");

  // The same rectangle dragged right-to-left is a crossing and selects R1.
  await page.mouse.move(partial.right, partial.top);
  await page.mouse.down();
  await page.mouse.move(partial.left, partial.middle, { steps: 4 });
  await expect(page.getByTestId("selection-box")).toHaveClass(
    "selection-box selection-box--crossing",
  );
  await page.mouse.up();
  await expectStatus(page, /Selected \d+ object/);

  // A left-to-right window swallowing the whole symbol selects it too.
  await page.mouse.move(bounds.x - 30, bounds.y - 30);
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width + 30,
    bounds.y + bounds.height + 30,
    { steps: 4 },
  );
  await page.mouse.up();
  await expectStatus(page, /Selected \d+ object/);

  // Marquee sweeps are gestures: they must never start a native browser text
  // selection over the SVG labels (the old distant-label highlight bug).
  expect(
    await page.evaluate(() => window.getSelection()?.toString() ?? ""),
  ).toBe("");
});
