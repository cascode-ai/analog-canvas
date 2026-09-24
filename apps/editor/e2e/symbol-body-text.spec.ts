import { parseSavedProject } from "./editor-fixtures";
import { revealPropertiesShelf } from "./editor-fixtures.js";
import { expect, test, type Page } from "@playwright/test";

import {
  chooseComponent,
  downloadBytes,
  expectComponentCodeField,
  setComponentCodeField,
} from "./editor-fixtures";

async function placeSymbol(page: Page, symbolId: string): Promise<void> {
  await page.goto("/editor");
  await chooseComponent(page, symbolId);
  await page.getByTestId("schematic-canvas").click({
    position: { x: 360, y: 240 },
  });
  await page.keyboard.press("Escape");
}

async function placeMarkedSymbol(page: Page, symbolId: string): Promise<void> {
  await placeSymbol(page, symbolId);
  await page.getByTestId("hit-X1").click();
  await revealPropertiesShelf(page);
  const shelf = page.getByTestId("selection-shelf");
  if ((await shelf.getAttribute("aria-expanded")) !== "true")
    await shelf.click();
  await setComponentCodeField(page, "appearance.internalMark", "A");
}

async function placeBodyTextSymbol(
  page: Page,
  symbolId: string,
): Promise<void> {
  if (symbolId === "opamp-lettered") {
    await placeMarkedSymbol(page, "opamp");
    return;
  }
  if (symbolId === "voltage-amplifier-lettered") {
    await placeMarkedSymbol(page, "voltage-amplifier");
    return;
  }
  await placeSymbol(page, symbolId);
}

function bodyText(page: Page) {
  // Scoped to the drawing: the Library chips draw the same body text.
  return page.locator(
    '[data-testid="schematic-canvas"] [data-role="signal-flow-formula"]',
  );
}

/**
 * The owner's complaint: text drawn inside a Symbol's own body was the one
 * text in the editor that could not be edited where it is drawn. Everything
 * else — net labels, notes, designators — edits on the canvas, so the same
 * gesture meant two different things depending on where the text lived.
 */
test("double-clicking a Symbol's body text edits it on the canvas", async ({
  page,
}) => {
  await placeSymbol(page, "dac");
  await expect(bodyText(page)).toContainText("DAC");

  await page.getByTestId("hit-X1").dblclick();
  const editor = page.getByRole("textbox", { name: "Canvas text editor" });
  await expect(editor).toBeVisible();
  await expect(editor).toHaveText("DAC");

  await editor.fill(
    "A deliberately long plain-text symbol formula that wraps while it is edited",
  );
  expect(
    await editor.evaluate(
      (element) => element.scrollWidth <= element.clientWidth + 1,
    ),
  ).toBe(true);

  await editor.fill("8-bit DAC");
  await page.getByRole("button", { name: "Apply text changes" }).click();

  await expect(bodyText(page)).toContainText("8-bit DAC");
});

// Both surfaces write one field, so they cannot drift apart.
test("the Properties field shows what the canvas edit committed", async ({
  page,
}) => {
  await placeSymbol(page, "dac");

  await page.getByTestId("hit-X1").dblclick();
  await page
    .getByRole("textbox", { name: "Canvas text editor" })
    .fill("current steering");
  await page.getByRole("button", { name: "Apply text changes" }).click();

  await page.getByTestId("hit-X1").click();
  await revealPropertiesShelf(page);
  const shelf = page.getByTestId("selection-shelf");
  if ((await shelf.getAttribute("aria-expanded")) !== "true")
    await shelf.click();
  await expectComponentCodeField(
    page,
    "signalFlow.formula",
    "current steering",
  );

  const saved = parseSavedProject(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
  ) as {
    documents: Array<{
      instances: Array<{ signalFlowParameters?: { formula?: string } }>;
    }>;
  };
  expect(saved.documents[0]!.instances[0]!.signalFlowParameters?.formula).toBe(
    "current steering",
  );
});

// The owner's request: the text inside a block takes every format a label
// takes — upright or italic, scripts, Greek letters — and keeps it.
test("formats a Symbol's body text like any label", async ({ page }) => {
  await placeSymbol(page, "adc");

  await page.getByTestId("hit-X1").dblclick();
  const editor = page.getByRole("textbox", { name: "Canvas text editor" });
  await expect(editor).toHaveText("ADC");
  for (const name of ["Bold", "Italic", "Subscript", "Insert formula"])
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  await expect(page.getByLabel("Insert circuit symbol")).toBeVisible();

  // Upright ADC, then a subscript 1 after it.
  await editor.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.getByRole("button", { name: "Italic", exact: true }).click();
  await page.keyboard.press("End");
  await page.keyboard.type("1");
  await page.keyboard.press("Shift+ArrowLeft");
  await page.getByRole("button", { name: "Subscript", exact: true }).click();
  await page.getByRole("button", { name: "Apply text changes" }).click();

  const drawn = bodyText(page);
  await expect(drawn).toHaveAttribute("data-formatted", "true");
  await expect(drawn).toContainText("ADC1");
  expect(
    await drawn.evaluate((element) =>
      [...element.querySelectorAll("text, tspan")].some(
        (node) => getComputedStyle(node).fontStyle === "italic",
      ),
    ),
  ).toBe(false);

  const saved = parseSavedProject(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
  ) as {
    documents: Array<{
      instances: Array<{
        signalFlowParameters?: { formula?: string; formulaFormat?: unknown };
      }>;
    }>;
  };
  const parameters = saved.documents[0]!.instances[0]!.signalFlowParameters;
  expect(parameters?.formula).toBe("ADC1");
  expect(parameters?.formulaFormat).toBeDefined();

  // Reopening edits the stored look, subscript and all.
  await page.getByTestId("hit-X1").dblclick();
  await expect(editor.locator("sub")).toHaveText("1");
});

// The owner reported this on a DAC and said several other circuits have it
// too. Every Symbol that draws its own body text is covered, so none is left
// reachable only from the Properties panel.
for (const symbolId of [
  "dac",
  "adc",
  "opamp-lettered",
  "voltage-amplifier-lettered",
  "transconductance",
  "integrator",
  "unit-delay",
  "discrete-time-integrator",
]) {
  test(`${symbolId} edits its body text on the canvas`, async ({ page }) => {
    await placeBodyTextSymbol(page, symbolId);

    await page.getByTestId("hit-X1").dblclick();
    const editor = page.getByRole("textbox", { name: "Canvas text editor" });
    await expect(editor).toBeVisible();
    await expect(editor).not.toHaveText("");

    await editor.fill("Zz");
    await page.getByRole("button", { name: "Apply text changes" }).click();
    await expect(bodyText(page)).toContainText("Zz");
  });
}

for (const symbolId of ["adc", "dac", "opamp-lettered"]) {
  test(`${symbolId} body text stays screen-upright after a left/right mirror`, async ({
    page,
  }) => {
    await placeBodyTextSymbol(page, symbolId);
    await page.getByTestId("hit-X1").click();
    await page.keyboard.press("Shift+R");

    const matrix = await bodyText(page).evaluate((element) => {
      const value = (element as SVGGraphicsElement).getScreenCTM();
      if (!value) throw new Error("Body text has no screen transform");
      return { a: value.a, b: value.b, c: value.c, d: value.d };
    });
    // The camera contributes a positive uniform scale. A formula left inside
    // the mirrored Symbol group instead has a negative horizontal basis.
    expect(matrix.a).toBeGreaterThan(0);
    expect(matrix.d).toBeGreaterThan(0);
    expect(Math.abs(matrix.b)).toBeLessThan(0.001);
    expect(Math.abs(matrix.c)).toBeLessThan(0.001);
  });
}

// The swapped-input sibling has no Library tile of its own: it is reached by
// swapping a placed op-amp's inputs, so it is covered through that path.
test("the swapped-input op-amp edits its body text too", async ({ page }) => {
  await placeMarkedSymbol(page, "opamp");
  await page.getByTestId("hit-X1").click();
  await setComponentCodeField(page, "symbol", "opamp-lettered-inputs-swapped");

  await page.getByTestId("hit-X1").dblclick();
  const editor = page.getByRole("textbox", { name: "Canvas text editor" });
  await expect(editor).toBeVisible();
  await editor.fill("Zz");
  await page.getByRole("button", { name: "Apply text changes" }).click();

  await expect(bodyText(page)).toContainText("Zz");
});
