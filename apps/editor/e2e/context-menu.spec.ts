import { expect, test, type Page } from "@playwright/test";

import {
  chooseComponent,
  clickDrawTool,
  clickCommand,
  openMenu,
} from "./editor-fixtures";

async function captureImageClipboard(
  page: Page,
  reject = false,
): Promise<void> {
  await page.addInitScript((deny) => {
    Object.defineProperty(navigator.clipboard, "write", {
      configurable: true,
      value: async (items: ClipboardItem[]) => {
        if (deny) throw new DOMException("Denied", "NotAllowedError");
        const item = items[0]!;
        const mime = item.types[0]!;
        const blob = await item.getType(mime);
        (
          window as unknown as {
            copiedImage: { mime: string; bytes: number[] };
          }
        ).copiedImage = {
          mime,
          bytes: Array.from(new Uint8Array(await blob.arrayBuffer())),
        };
      },
    });
  }, reject);
}

async function placeComponent(
  page: Page,
  symbolId: string,
  position: { x: number; y: number },
): Promise<void> {
  await chooseComponent(page, symbolId);
  await page.getByTestId("schematic-canvas").click({ position });
  await page.keyboard.press("Escape");
}

test("right-click on a device offers same-shape variant swap tiles", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "inductor", { x: 360, y: 240 });
  const instance = page.locator('[data-canvas-hit-kind="instance"]').first();
  await instance.click({ button: "right" });
  const menu = page.getByTestId("canvas-context-menu");
  await expect(menu).toBeVisible();
  await expect(menu).toContainText("Swap device");
  await expect(page.getByTestId("context-swap-resistor")).toBeVisible();
  await expect(page.getByTestId("context-swap-capacitor")).toBeVisible();

  await page.getByTestId("context-swap-resistor").click();
  await expect(menu).toHaveCount(0);
  await expect(page.getByTestId("status")).toContainText("Swapped to");
  await instance.click({ button: "right" });
  // The device is now a resistor, so the tiles offer the inductor back.
  await expect(page.getByTestId("context-swap-inductor")).toBeVisible();
  await expect(page.getByTestId("context-swap-resistor")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("canvas-context-menu")).toHaveCount(0);
});

test("right-click on a multi-selection aligns bbox edges", async ({ page }) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 300, y: 220 });
  await placeComponent(page, "resistor", { x: 420, y: 300 });
  const instances = page.locator('[data-canvas-hit-kind="instance"]');
  await expect(instances).toHaveCount(2);
  await instances.nth(0).click();
  await instances.nth(1).click({ modifiers: ["Shift"] });

  await instances.nth(1).click({ button: "right" });
  const menu = page.getByTestId("canvas-context-menu");
  await expect(menu).toContainText("Align");
  await page.getByTestId("context-align-left").click();
  await expect(page.getByTestId("status")).toContainText(
    "Aligned 2 selected objects",
  );
  const boxes = await instances.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("x")),
  );
  expect(boxes[0]).toBe(boxes[1]);
});

test("drafting text shares device additive selection and context alignment", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 300, y: 220 });
  await clickDrawTool(page, "text");
  const input = page.getByRole("textbox", { name: "Canvas text editor" });
  await input.fill("BIAS");
  await page.getByRole("button", { name: "Apply text changes" }).click();

  const instance = page.locator('[data-canvas-hit-kind="instance"]').first();
  const text = page.locator('[data-canvas-hit-kind="drafting"]').first();

  await page.keyboard.press("ControlOrMeta+A");
  await expect(instance).toHaveClass(/selected/);
  await expect(text).toHaveClass(/selected/);
  await page.keyboard.press("ControlOrMeta+D");

  // The same objects can then be composed explicitly through the shared
  // additive click behavior.
  await instance.click();
  await expect(instance).toHaveClass(/selected/);
  await text.click({ modifiers: ["Shift"] });
  await expect(instance).toHaveClass(/selected/);
  await expect(text).toHaveClass(/selected/);

  // Right-clicking an already-selected text keeps the mixed selection and
  // opens the same command surface as a device, without device-only variants.
  await text.click({ button: "right" });
  const menu = page.getByTestId("canvas-context-menu");
  await expect(menu).toContainText("Align");
  await expect(menu).not.toContainText("Swap device");
  await page.getByTestId("context-align-left").click();
  await expect(page.getByTestId("status")).toContainText(
    "Aligned 2 selected objects",
  );
});

test("drafting shapes join device selection from either order", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 300, y: 220 });
  await clickDrawTool(page, "rectangle");
  const canvas = page.getByTestId("schematic-canvas");
  await canvas.click({ position: { x: 420, y: 180 } });
  await canvas.click({ position: { x: 540, y: 280 } });
  await page.keyboard.press("Escape");

  const instance = page.locator('[data-canvas-hit-kind="instance"]').first();
  const rectangle = page.getByTestId(/^drafting-hit-rectangle-/);

  // Shape first, then Shift+device — the order that used to drop the shape:
  // the outside-press deselect ran before the additive click could compose.
  await canvas.click({ position: { x: 480, y: 180 } });
  await expect(rectangle).toHaveClass(/selected/);
  await instance.click({ modifiers: ["Shift"] });
  await expect(instance).toHaveClass(/selected/);
  await expect(rectangle).toHaveClass(/selected/);

  // Right-clicking the DEVICE member must not shed the shape either: the
  // press acts on the pair, so the shared command surface opens over both.
  // (Shapes do not participate in edge alignment — that boundary is #384's,
  // not this test's — so the mixed menu is asserted, not an Align action.)
  await instance.click({ button: "right" });
  const menu = page.getByTestId("canvas-context-menu");
  await expect(menu).toBeVisible();
  await expect(menu).not.toContainText("Swap device");
  await expect(menu.getByRole("menuitem", { name: "Delete" })).toBeEnabled();
  await expect(rectangle).toHaveClass(/selected/);
  await expect(instance).toHaveClass(/selected/);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);

  // A plain press on empty canvas keeps its meaning: the shape deselects.
  await canvas.click({ position: { x: 640, y: 400 } });
  await expect(rectangle).not.toHaveClass(/selected/);

  // The reverse order composes too. A shape is a stroke-only hit, so the
  // additive click aims at its edge, not the locator's center.
  await instance.click();
  await expect(instance).toHaveClass(/selected/);
  await canvas.click({ position: { x: 480, y: 180 }, modifiers: ["Shift"] });
  await expect(instance).toHaveClass(/selected/);
  await expect(rectangle).toHaveClass(/selected/);
});

test("device annotation shares device additive selection and context menu", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 300, y: 220 });
  const instance = page.locator('[data-canvas-hit-kind="instance"]').first();
  const annotation = page
    .locator('[data-canvas-hit-kind="annotation"]')
    .first();

  await instance.click();
  await annotation.click({ modifiers: ["Shift"], force: true });
  await expect(instance).toHaveClass(/selected/);
  await expect(annotation).toHaveClass(/selected/);

  await annotation.click({ button: "right", force: true });
  const menu = page.getByTestId("canvas-context-menu");
  await expect(menu).toBeVisible();
  await expect(menu).not.toContainText("Swap device");
  await expect(menu.getByRole("menuitem", { name: "Delete" })).toBeEnabled();
});

test("visual clipboard preserves mixed selection and exports only its formal SVG", async ({
  page,
}) => {
  await captureImageClipboard(page);
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 280, y: 220 });
  await placeComponent(page, "capacitor", { x: 540, y: 320 });
  await clickDrawTool(page, "text");
  await page.getByRole("textbox", { name: "Canvas text editor" }).fill("BIAS");
  await page.getByRole("button", { name: "Apply text changes" }).click();
  const resistor = page.locator('[data-canvas-hit-kind="instance"]').first();
  const text = page.locator('[data-canvas-hit-kind="drafting"]').first();
  await resistor.click();
  await text.click({ modifiers: ["Shift"] });
  const canvas = page.getByTestId("schematic-canvas");
  const before = await canvas.locator('[data-layer="formal"]').innerHTML();
  await text.click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Copy as SVG", exact: true })
    .click();
  await expect(page.getByTestId("status")).toHaveText(
    "Copied selection as SVG",
  );
  const copied = await page.evaluate(
    () =>
      (window as unknown as { copiedImage: { mime: string; bytes: number[] } })
        .copiedImage,
  );
  const svg = Buffer.from(copied.bytes).toString("utf8");
  expect(copied.mime).toBe("image/svg+xml");
  expect(svg).toContain('data-symbol-id="resistor"');
  expect(svg).not.toContain('data-symbol-id="capacitor"');
  expect(svg).toContain("BIAS");
  expect(svg).not.toMatch(
    /hit-target|selection-halo|flightline|editor-overlay/,
  );
  expect(await canvas.locator('[data-layer="formal"]').innerHTML()).toBe(
    before,
  );
  await expect(resistor).toHaveClass(/selected/);
  await expect(text).toHaveClass(/selected/);
  // Empty-canvas right-click preserves the same mixed selection.
  await canvas.click({ button: "right", position: { x: 650, y: 450 } });
  await expect(
    page.getByRole("menuitem", { name: "Copy as PNG" }),
  ).toBeEnabled();
  await expect(resistor).toHaveClass(/selected/);
  await expect(text).toHaveClass(/selected/);
});

test("visual clipboard rasterizes an independent Wire as transparent PNG without changing history", async ({
  page,
}) => {
  await captureImageClipboard(page);
  await page.goto("/editor");
  const canvas = page.getByTestId("schematic-canvas");
  await clickDrawTool(page, "wire");
  await canvas.click({ position: { x: 300, y: 200 } });
  await canvas.dblclick({ position: { x: 500, y: 200 } });
  await page.keyboard.press("Escape");
  const wire = page.locator('[data-canvas-hit-kind="route"]').first();
  await expect(wire).toHaveCount(1);
  const midpoint = await wire.evaluate((element) => {
    const line = element as SVGPolylineElement;
    const from = line.points.getItem(0);
    const to = line.points.getItem(1);
    const point = new DOMPoint(
      (from.x + to.x) / 2,
      (from.y + to.y) / 2,
    ).matrixTransform(line.getScreenCTM()!);
    return { x: point.x, y: point.y };
  });
  await page.mouse.click(midpoint.x, midpoint.y, { button: "right" });
  await page.getByRole("menuitem", { name: "Copy as PNG" }).click();
  await expect(page.getByTestId("status")).toHaveText(
    "Copied selection as PNG",
  );
  const copied = await page.evaluate(
    () =>
      (window as unknown as { copiedImage: { mime: string; bytes: number[] } })
        .copiedImage,
  );
  const png = await page.evaluate(async (bytes) => {
    const bitmap = await createImageBitmap(
      new Blob([new Uint8Array(bytes)], { type: "image/png" }),
    );
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const result = {
      width: bitmap.width,
      height: bitmap.height,
      cornerAlpha: pixels[3],
      hasInk: pixels.some((value, index) => index % 4 === 3 && value > 0),
    };
    bitmap.close();
    canvas.width = canvas.height = 0;
    return result;
  }, copied.bytes);
  expect(copied.mime).toBe("image/png");
  expect(png.width).toBeGreaterThan(png.height);
  expect(png.cornerAlpha).toBe(0);
  expect(png.hasInk).toBe(true);
  await page.keyboard.press("ControlOrMeta+Z");
  await expect(wire).toHaveCount(0);
});

test("visual clipboard reports denied access and empty selection without downloads", async ({
  page,
}) => {
  await captureImageClipboard(page, true);
  await page.goto("/editor");
  const canvas = page.getByTestId("schematic-canvas");
  await canvas.click({ button: "right", position: { x: 600, y: 400 } });
  await expect(
    page.getByRole("menuitem", { name: "Copy as PNG" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("menuitem", { name: "Copy as SVG" }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await placeComponent(page, "resistor", { x: 300, y: 220 });
  const downloads: string[] = [];
  page.on("download", (download) =>
    downloads.push(download.suggestedFilename()),
  );
  await page
    .locator('[data-canvas-hit-kind="instance"]')
    .first()
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copy as PNG" }).click();
  await expect(page.getByTestId("status")).toContainText(
    "Clipboard access was denied",
  );
  expect(downloads).toEqual([]);
});

test("File exports are folded into exclusive drawing and netlist submenus", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 300, y: 220 });
  await placeComponent(page, "capacitor", { x: 550, y: 320 });
  await page.locator('[data-canvas-hit-kind="instance"]').first().click();
  const menu = await openMenu(page, "File");
  await expect(
    menu.getByRole("button", { name: "Export SVG", exact: true }),
  ).toBeHidden();
  await menu
    .getByRole("button", { name: "Export netlist", exact: true })
    .click();
  await expect(
    menu.getByRole("button", { name: "Export SPICE netlist", exact: true }),
  ).toBeVisible();
  await menu
    .getByRole("button", { name: "Export drawing", exact: true })
    .click();
  await expect(
    menu.getByRole("button", { name: "Export SPICE netlist", exact: true }),
  ).toBeHidden();
  await expect(
    menu.getByRole("button", { name: "Export SVG", exact: true }),
  ).toBeVisible();
  const viewBox = await page
    .getByTestId("schematic-canvas")
    .getAttribute("viewBox");
  await menu
    .getByRole("button", { name: "Export drawing", exact: true })
    .press("ArrowRight");
  await expect(
    menu.getByRole("button", { name: "Export SVG", exact: true }),
  ).toBeFocused();
  expect(
    await page.getByTestId("schematic-canvas").getAttribute("viewBox"),
  ).toBe(viewBox);
  await menu
    .getByRole("button", { name: "Export SVG", exact: true })
    .press("ArrowLeft");
  await expect(
    menu.getByRole("button", { name: "Export drawing", exact: true }),
  ).toBeFocused();
  await expect(
    menu.getByRole("button", { name: "Export SVG", exact: true }),
  ).toBeHidden();
  const download = page.waitForEvent("download");
  await clickCommand(page, "File", "Export SVG");
  const stream = await (await download).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const svg = Buffer.concat(chunks).toString("utf8");
  expect(svg).toContain('data-symbol-id="resistor"');
  expect(svg).toContain('data-symbol-id="capacitor"');
  await expect(menu).not.toHaveAttribute("open");
});

test("toolbar undo and redo buttons follow history state", async ({ page }) => {
  await page.goto("/editor");
  const undo = page.getByTestId("draw-tool-undo");
  const redo = page.getByTestId("draw-tool-redo");
  await expect(undo).toBeDisabled();
  await expect(redo).toBeDisabled();

  await placeComponent(page, "resistor", { x: 360, y: 240 });
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(page.locator('[data-canvas-hit-kind="instance"]')).toHaveCount(
    0,
  );
  await expect(redo).toBeEnabled();
  await redo.click();
  await expect(page.locator('[data-canvas-hit-kind="instance"]')).toHaveCount(
    1,
  );
});
