import { expect, test } from "@playwright/test";

import { chooseComponent } from "./editor-fixtures.js";

// A Symbol the device registry gives no reference prefix has nothing to put in
// its designator, so the label projected an empty string: no glyph, but a hit
// box, a marquee target, and an SVG text element with a lone line break. The
// person saw blank canvas and clicked something.
//
// Logic gates now carry X references as Blocks (#895). Signal-flow designators
// remain deliberately hidden (#386). Check both sides of visibility: retain
// a real designator, but never leave a hit target for a hidden/empty label.
for (const [family, symbolId, label] of [
  ["logic gate", "nand-gate", "X1"],
  ["signal flow", "adder", ""],
] as const) {
  test(`a ${family} exposes hit targets only for its visible labels`, async ({
    page,
  }) => {
    await page.goto("/editor");
    await chooseComponent(page, symbolId);
    await page
      .getByTestId("schematic-canvas")
      .click({ position: { x: 360, y: 230 } });
    await page.keyboard.press("Escape");

    await expect(page.getByTestId("hit-X1")).toBeVisible();
    await expect(
      page.locator('[data-canvas-hit-kind="annotation"]'),
    ).toHaveCount(label ? 1 : 0);
    // Nor an empty glyph in the drawing itself.
    await expect(page.locator('[data-layer="annotations"] text')).toHaveCount(
      label ? 1 : 0,
    );
    if (label)
      await expect(page.locator('[data-layer="annotations"] text')).toHaveText(
        label,
      );
  });
}

// The other half of the rule: it must hide only what is genuinely blank. A
// formal Cell Pin has no reference designator either, but it is not a ghost —
// it uses its terminal name as its whole visible identity, so it keeps both
// its glyph and its hit target.
test("a formal Cell Pin keeps the label it does have", async ({ page }) => {
  await page.goto("/editor");
  await chooseComponent(page, "port");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 360, y: 230 } });
  await page.keyboard.press("Escape");

  const labels = page.locator('[data-layer="annotations"] text');
  await expect(labels).toHaveCount(1);
  await expect(labels.first()).not.toBeEmpty();
  await expect(page.locator('[data-canvas-hit-kind="annotation"]')).toHaveCount(
    1,
  );
});

// The two-terminal switches were the visible case: they now carry a device
// descriptor, so they are designated from the same `S` sequence as the
// voltage-controlled switch and their label has something to say.
test("switches designate from one S sequence whatever kind they are", async ({
  page,
}) => {
  await page.goto("/editor");
  const canvas = page.getByTestId("schematic-canvas");

  await chooseComponent(page, "ideal-switch");
  await canvas.click({ position: { x: 260, y: 200 } });
  await page.keyboard.press("Escape");

  await chooseComponent(page, "voltage-controlled-switch");
  await canvas.click({ position: { x: 420, y: 200 } });
  await page.keyboard.press("Escape");

  await chooseComponent(page, "closed-switch");
  await canvas.click({ position: { x: 580, y: 200 } });
  await page.keyboard.press("Escape");

  const labels = page.locator('[data-layer="annotations"] text');
  await expect(labels.filter({ hasText: "S1" })).toHaveCount(1);
  await expect(labels.filter({ hasText: "S2" })).toHaveCount(1);
  await expect(labels.filter({ hasText: "S3" })).toHaveCount(1);
});
