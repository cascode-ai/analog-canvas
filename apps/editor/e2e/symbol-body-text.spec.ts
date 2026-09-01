import { expect, test, type Page } from "@playwright/test";

import { chooseComponent, downloadBytes } from "./editor-fixtures";

async function placeSymbol(page: Page, symbolId: string): Promise<void> {
  await page.goto("/editor");
  await chooseComponent(page, symbolId);
  await page.getByTestId("schematic-canvas").click({
    position: { x: 360, y: 240 },
  });
  await page.keyboard.press("Escape");
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
  await expect(editor).toHaveValue("DAC");

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
  await expect(page.getByLabel("Formula")).toHaveValue("current steering");

  const saved = JSON.parse(
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

// The Symbol's own text is a plain string in a compact script syntax, so the
// canvas editor offers no rich-text or formula affordances on it. Offering
// them would promise formatting the field cannot store — the shape of defect
// that #495 was.
test("the Symbol body editor offers no formatting it cannot keep", async ({
  page,
}) => {
  await placeSymbol(page, "integrator");

  await page.getByTestId("hit-X1").dblclick();
  await expect(
    page.getByRole("textbox", { name: "Canvas text editor" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Insert formula" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Overbar" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Bold" })).toHaveCount(0);
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
    await placeSymbol(page, symbolId);

    await page.getByTestId("hit-X1").dblclick();
    const editor = page.getByRole("textbox", { name: "Canvas text editor" });
    await expect(editor).toBeVisible();
    await expect(editor).not.toHaveValue("");

    await editor.fill("Zz");
    await page.getByRole("button", { name: "Apply text changes" }).click();
    await expect(bodyText(page)).toContainText("Zz");
  });
}

// The swapped-input sibling has no Library tile of its own: it is reached by
// swapping a placed op-amp's inputs, so it is covered through that path.
test("the swapped-input op-amp edits its body text too", async ({ page }) => {
  await placeSymbol(page, "opamp-lettered");
  await page.getByTestId("hit-X1").click();
  await page.getByTestId("selection-shelf").click();
  await page
    .getByLabel("Amplifier placement actions")
    .getByRole("button", { name: "Swap the + and - inputs" })
    .click();

  await page.getByTestId("hit-X1").dblclick();
  const editor = page.getByRole("textbox", { name: "Canvas text editor" });
  await expect(editor).toBeVisible();
  await editor.fill("Zz");
  await page.getByRole("button", { name: "Apply text changes" }).click();

  await expect(bodyText(page)).toContainText("Zz");
});
