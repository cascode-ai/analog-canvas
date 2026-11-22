import { expect, test, type Page } from "@playwright/test";

import {
  expectComponentCodeField,
  exportedProject,
  placeComponentAt,
} from "./editor-fixtures.js";
import { openSelectionShelf } from "./manual-editor-fixtures.js";

async function placeSymbol(page: Page, symbolId: string): Promise<void> {
  await page.goto("/editor");
  await placeComponentAt(page, symbolId, { x: 360, y: 240 });
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
test("double-clicking a Symbol's body text edits it on the canvas and in Properties", async ({
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

  // Both surfaces write one field, so they cannot drift apart.
  await page.getByTestId("hit-X1").click();
  await openSelectionShelf(page);
  await expectComponentCodeField(page, "signalFlow.formula", "8-bit DAC");
  const saved = (await exportedProject(page)) as {
    documents: Array<{
      instances: Array<{ signalFlowParameters?: { formula?: string } }>;
    }>;
  };
  expect(saved.documents[0]!.instances[0]!.signalFlowParameters?.formula).toBe(
    "8-bit DAC",
  );
});

// The owner reported this on a DAC and said several other circuits have it
// too. The DAC edits its body text in the case above; a signal-flow block is
// hit through its rectangle instead.
// How the text is stored, formatted, slanted and kept upright under a mirror
// is text-editing's, signal-flow-layout's and signal-flow-formula's.
test("integrator edits its body text on the canvas", async ({ page }) => {
  await placeSymbol(page, "integrator");

  await page.getByTestId("hit-X1").dblclick();
  const editor = page.getByRole("textbox", { name: "Canvas text editor" });
  await expect(editor).toBeVisible();
  await expect(editor).not.toHaveText("");

  await editor.fill("Zz");
  await page.getByRole("button", { name: "Apply text changes" }).click();
  await expect(bodyText(page)).toContainText("Zz");
});
