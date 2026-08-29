import { expect, test, type Page } from "@playwright/test";

import { awaitEditorReady } from "./editor-fixtures";

/** Dispatch one wheel event with a chosen device signature. */
async function wheel(
  page: Page,
  signature: { deltaY: number; deltaX?: number; wheelDeltaY?: number },
): Promise<void> {
  await page.getByTestId("schematic-canvas").evaluate((element, init) => {
    const bounds = element.getBoundingClientRect();
    const event = new WheelEvent("wheel", {
      clientX: bounds.left + bounds.width * 0.3,
      clientY: bounds.top + bounds.height * 0.3,
      deltaX: init.deltaX ?? 0,
      deltaY: init.deltaY,
      bubbles: true,
      cancelable: true,
    });
    if (init.wheelDeltaY !== undefined) {
      Object.defineProperty(event, "wheelDeltaY", { value: init.wheelDeltaY });
    }
    element.dispatchEvent(event);
  }, signature);
}

const width = async (page: Page): Promise<number> =>
  Number(
    (await page.getByTestId("schematic-canvas").getAttribute("viewBox"))!.split(
      " ",
    )[2],
  );

test("a wheel zooms and a trackpad pans, and the setting overrides both", async ({
  page,
}) => {
  await page.goto("/editor");
  await awaitEditorReady(page);
  const setting = page.getByLabel("Scroll wheel");
  await expect(setting).toHaveValue("auto");

  // A detent-quantized signature zooms even though its deltaY is tiny —
  // the case that made a slowly turned mouse wheel pan. Scrolling up
  // zooms in, so the camera narrows.
  const beforeWheel = await width(page);
  await wheel(page, { deltaY: -4, wheelDeltaY: 120 });
  await expect.poll(() => width(page)).toBeLessThan(beforeWheel);

  // The trackpad's 3:1 ratio pans instead, leaving the zoom untouched.
  const afterWheel = await width(page);
  await wheel(page, { deltaY: 40, wheelDeltaY: -120 });
  await expect.poll(() => width(page)).toBe(afterWheel);

  // An explicit choice wins over any evidence: the same trackpad
  // signature now zooms.
  await setting.selectOption("zoom");
  await wheel(page, { deltaY: -40, wheelDeltaY: 120 });
  await expect.poll(() => width(page)).toBeLessThan(afterWheel);

  // And a mouse detent pans once the person says the device is a surface.
  await setting.selectOption("pan");
  const beforePan = await width(page);
  await wheel(page, { deltaY: -4, wheelDeltaY: 120 });
  await expect.poll(() => width(page)).toBe(beforePan);

  // The choice survives a reload.
  await page.reload();
  await awaitEditorReady(page);
  await expect(page.getByLabel("Scroll wheel")).toHaveValue("pan");
});
