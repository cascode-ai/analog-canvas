import { expect, test } from "@playwright/test";

import { chooseComponent } from "./editor-fixtures.js";

// A Symbol the device registry gives no reference prefix had nothing to put in
// its designator, so the label projected an empty string: no glyph, but a hit
// box, a marquee target, and an SVG text element with a lone line break. The
// person saw blank canvas and clicked something.
//
// Logic gates now carry X references as Blocks (#895): a real designator with
// its glyph and hit target. Signal-flow blocks placing no designator (#386),
// a formal Cell Pin's terminal-name label, and the switches' shared S sequence
// are pinned by default-instance-display.test and the devices reference test.
test("a logic gate exposes hit targets only for its visible labels", async ({
  page,
}) => {
  await page.goto("/editor");
  await chooseComponent(page, "nand-gate");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 360, y: 230 } });
  await page.keyboard.press("Escape");

  await expect(page.getByTestId("hit-X1")).toBeVisible();
  await expect(page.locator('[data-canvas-hit-kind="annotation"]')).toHaveCount(
    1,
  );
  await expect(page.locator('[data-layer="annotations"] text')).toHaveText(
    "X1",
  );
});
