import { expect, test } from "@playwright/test";

import { chooseComponent, clickCommand } from "./editor-fixtures.js";

test("blocks destructive browser refresh shortcuts and uses the stronger grid", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".canvas-grid-dot").first()).toHaveCSS(
    "fill",
    "rgb(196, 199, 201)",
  );
  await page.evaluate(() => {
    document.body.dataset.refreshGuard = "alive";
  });

  await page.keyboard.press("Control+r");
  await expect(page.getByTestId("status")).toHaveText(
    "Refresh blocked to protect the current circuit",
  );
  await expect(page.locator("body")).toHaveAttribute(
    "data-refresh-guard",
    "alive",
  );

  await page.keyboard.press("i");
  const dialog = page.getByRole("dialog", { name: "Insert Component" });
  await dialog.getByLabel("Component search").focus();
  await page.keyboard.press("F5");
  await expect(dialog).toBeVisible();
  await expect(page.locator("body")).toHaveAttribute(
    "data-refresh-guard",
    "alive",
  );
});

test("refreshes explicitly only after flushing and automatically restoring recovery", async ({
  page,
}) => {
  await page.goto("/");
  await chooseComponent(page, "resistor");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 360, y: 230 } });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("hit-R1")).toBeVisible();
  await expect(page.getByTestId("revision")).toHaveText("1");

  const navigated = page.waitForEvent("framenavigated");
  await clickCommand(page, "File", "Refresh app");
  await navigated;

  await expect(page.getByTestId("hit-R1")).toBeVisible();
  await expect(page.getByTestId("revision")).toHaveText("1");
  await expect(page.getByTestId("status")).toHaveText(
    "Restored recovery revision 1",
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        sessionStorage.getItem("icm.restore-after-refresh.v1"),
      ),
    )
    .toBeNull();
});

test("inserts from the master-detail dialog with keyboard and live placement preview", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("canvas-empty-state")).toBeVisible();

  await page.keyboard.press("i");
  const dialog = page.getByRole("dialog", { name: "Insert Component" });
  const search = dialog.getByLabel("Component search");
  await expect(search).toBeFocused();
  await search.fill("not-a-real-component");
  await expect(dialog.getByRole("button", { name: "Apply" })).toBeDisabled();
  await search.fill("mos");
  const before = await search.getAttribute("aria-activedescendant");
  await page.keyboard.press("ArrowDown");
  expect(await search.getAttribute("aria-activedescendant")).not.toBe(before);

  await search.fill("resistor");
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);

  const canvas = page.getByTestId("schematic-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas is not measurable");
  await page.mouse.move(box.x + 360, box.y + 230);
  const preview = page.getByTestId("component-placement-preview");
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute("transform", /rotate\(0\)/u);

  await page.keyboard.press("r");
  await expect(preview).toHaveAttribute("transform", /rotate\(90\)/u);
  await page.keyboard.press("Escape");
  await expect(preview).toHaveCount(0);
  await expect(page.getByTestId("revision")).toHaveText("0");

  await chooseComponent(page, "resistor");
  await canvas.click({ position: { x: 360, y: 230 } });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("hit-R1")).toBeVisible();
  await expect(page.getByTestId("canvas-empty-state")).toHaveCount(0);
  await page.getByTestId("selection-shelf").click();
  await expect(page.locator(".selection-overview")).toContainText(
    "ComponentR1Symbolresistor",
  );
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("icm.recent-components.v1")),
    )
    .toContain("resistor");

  await page.keyboard.press("i");
  const reopened = page.getByRole("dialog", { name: "Insert Component" });
  await reopened.getByRole("button", { name: "Expand component list" }).click();
  const passives = reopened
    .locator(".insert-option-group")
    .filter({ hasText: "Passives" });
  await expect(passives.locator("button").first()).toHaveAttribute(
    "data-testid",
    "insert-component-resistor",
  );
});

test("offers VDD rail in I with preview-only symbol artwork", async ({
  page,
}) => {
  await page.goto("/");
  await page.keyboard.press("i");
  const dialog = page.getByRole("dialog", { name: "Insert Component" });
  await dialog.getByLabel("Component search").fill("vdd");
  await dialog.getByTestId("insert-component-vdd").click();
  await expect(dialog.locator("svg.insert-symbol-artwork")).toBeVisible();
  await expect(dialog.getByLabel("Placement options")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Apply" }).click();

  const canvas = page.getByTestId("schematic-canvas");
  await canvas.hover({ position: { x: 260, y: 140 } });
  await expect(page.getByTestId("component-placement-preview")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("component-input-plane")).toHaveCount(0);
  await expect(page.getByTestId("instance-count")).toHaveText("0");
});

test("reopens I and starts Copy from retained selection without stacking modes", async ({
  page,
}) => {
  await page.goto("/");
  await chooseComponent(page, "resistor");
  const canvas = page.getByTestId("schematic-canvas");
  await canvas.click({ position: { x: 360, y: 230 } });
  await page.keyboard.press("Escape");
  await page.getByTestId("hit-R1").click();

  await page.keyboard.press("i");
  await expect(
    page.getByRole("dialog", { name: "Insert Component" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("c");
  await page.keyboard.press("c");
  await canvas.hover({ position: { x: 560, y: 330 } });
  await expect(page.getByTestId("copy-placement-preview")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("copy-placement-preview")).toHaveCount(0);

  await page.keyboard.press("i");
  await expect(
    page.getByRole("dialog", { name: "Insert Component" }),
  ).toBeVisible();
});

test("publishes placement cancellation synchronously before rapid Copy", async ({
  page,
}) => {
  await page.goto("/");
  const canvas = page.getByTestId("schematic-canvas");
  const symbols = ["nmos", "pmos", "resistor"] as const;

  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "c" }));
  });
  await expect(
    page.getByRole("heading", { name: "Circuit Maker" }),
  ).toBeVisible();

  for (const [index, symbolId] of symbols.entries()) {
    await chooseComponent(page, symbolId);
    await canvas.click({ position: { x: 320 + index * 150, y: 240 } });

    // A fast physical Esc -> C sequence can arrive before React publishes a
    // render between the two native events. The command state must still see
    // the reducer transition synchronously, especially after MOS bulk-default
    // reconciliation makes the committed scene more expensive to derive.
    await page.evaluate(() => {
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", { key: "c", bubbles: true }),
      );
    });

    await canvas.hover({ position: { x: 400 + index * 130, y: 380 } });
    await expect(page.getByTestId("copy-placement-preview")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("copy-placement-preview")).toHaveCount(0);
  }
});

test("copies a MOS whose bulk belongs to a shared supply Net", async ({
  page,
}) => {
  await page.goto("/");
  const canvas = page.getByTestId("schematic-canvas");

  await chooseComponent(page, "nmos");
  await canvas.click({ position: { x: 280, y: 220 } });
  await page.keyboard.press("Escape");
  await chooseComponent(page, "nmos");
  await canvas.click({ position: { x: 460, y: 220 } });
  await page.keyboard.press("Escape");

  await page.getByTestId("hit-M1").click();
  await page.keyboard.press("c");
  await canvas.hover({ position: { x: 620, y: 340 } });
  await expect(page.getByTestId("copy-placement-preview")).toBeVisible();
  await canvas.click({ position: { x: 620, y: 340 } });
  await expect(page.getByTestId("hit-M1-copy-1")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Circuit Maker" }),
  ).toBeVisible();
});

test("carries a manual Value through placement and Q property editing", async ({
  page,
}) => {
  await page.goto("/");
  await page.keyboard.press("i");
  const dialog = page.getByRole("dialog", { name: "Insert Component" });
  await dialog.getByLabel("Component search").fill("resistor");
  await dialog.getByLabel("Component value").fill("10k");
  await dialog.getByRole("button", { name: "Apply" }).click();

  const canvas = page.getByTestId("schematic-canvas");
  await canvas.click({ position: { x: 360, y: 230 } });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("revision")).toHaveText("1");
  await expect(page.getByTestId("selection-shelf")).toHaveAttribute(
    "aria-expanded",
    "false",
  );

  await page.keyboard.press("q");
  await expect(page.getByTestId("selection-shelf")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(page.getByLabel("Component geometry")).toContainText("XYRotate");
  await expect(
    page.locator(".selection-overview").filter({ hasText: "ComponentR1" }),
  ).not.toContainText("Position");
  const propertyValue = page.getByLabel("Component value");
  await expect(propertyValue).toBeFocused();
  await expect(propertyValue).toHaveValue("10k");
  await propertyValue.fill("12k");
  await page
    .getByRole("button", { name: "Apply component properties" })
    .click();
  await expect(page.getByTestId("revision")).toHaveText("2");

  await page.keyboard.press("u");
  await expect(page.getByTestId("revision")).toHaveText("3");
  await expect(propertyValue).toHaveValue("10k");
});

test("keeps the workspace inside the viewport and exposes low-interference zoom controls", async ({
  page,
}) => {
  await page.goto("/");

  expect(
    await page.evaluate(() => ({
      horizontal:
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
      vertical:
        document.documentElement.scrollHeight >
        document.documentElement.clientHeight,
    })),
  ).toEqual({ horizontal: false, vertical: false });

  const zoom = page.getByRole("status", { name: "Current zoom" });
  await expect(zoom).toHaveText("100%");
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(zoom).not.toHaveText("100%");
  await page.getByRole("button", { name: "Fit view" }).click();

  const canvas = page.getByTestId("schematic-canvas");
  const canvasBefore = await canvas.boundingBox();
  await page.getByTestId("selection-shelf").click();
  await expect
    .poll(async () => (await canvas.boundingBox())?.width ?? 0)
    .toBeLessThan(canvasBefore?.width ?? 0);
});

test("keeps preview fixed while the compact catalog expands and collapses", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 720 });
  await page.goto("/");
  await page.keyboard.press("i");

  const dialog = page.getByRole("dialog", { name: "Insert Component" });
  const artwork = dialog.locator(".insert-symbol-artwork");
  const cancel = dialog.getByRole("button", { name: "Cancel" });
  const apply = dialog.getByRole("button", { name: "Apply" });
  const toggle = dialog.getByRole("button", { name: "Expand component list" });

  const measure = () =>
    dialog.evaluate((element) => {
      const bounds = (target: Element) => {
        const rect = target.getBoundingClientRect();
        return {
          top: rect.top,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        };
      };
      const preview = element.querySelector(".insert-component-preview")!;
      const artwork = element.querySelector(".insert-symbol-artwork")!;
      const footer = element.querySelector(".insert-dialog-actions")!;
      return {
        dialog: bounds(element),
        preview: bounds(preview),
        artwork: bounds(artwork),
        footer: bounds(footer),
      };
    });

  const before = await measure();
  await expect(cancel).toBeVisible();
  await expect(apply).toBeVisible();
  expect(before.footer.bottom).toBeLessThanOrEqual(before.dialog.bottom);
  await expect(dialog.locator(".insert-component-options")).toHaveCount(0);

  await toggle.click();
  const options = dialog.locator(".insert-component-options");
  await expect(options).toBeVisible();
  expect(
    await options.evaluate((element) => getComputedStyle(element).overflowY),
  ).toBe("auto");
  await dialog.getByTestId("insert-component-inductor").click();
  const after = await measure();
  expect(after.dialog.height).toBeCloseTo(before.dialog.height, 0);
  expect(after.preview.width).toBeCloseTo(before.preview.width, 0);
  expect(after.preview.height).toBeCloseTo(before.preview.height, 0);
  expect(after.artwork.width).toBeCloseTo(before.artwork.width, 0);
  expect(after.artwork.height).toBeCloseTo(before.artwork.height, 0);
  expect(after.footer.top).toBeCloseTo(before.footer.top, 0);
  expect(after.footer.bottom).toBeLessThanOrEqual(after.dialog.bottom);
});

test("places MOS parameters and orientation without a hidden-label suppressor", async ({
  page,
}) => {
  await page.goto("/");
  await page.keyboard.press("i");

  const dialog = page.getByRole("dialog", { name: "Insert Component" });
  await dialog.getByLabel("Component search").fill("nmos");
  await expect(
    dialog.getByLabel("Component w", { exact: true }),
  ).toHaveAttribute("placeholder", "1u");
  await dialog.getByLabel("Component w", { exact: true }).fill("2u");
  await dialog.getByLabel("Component l", { exact: true }).fill("180n");
  await dialog.getByLabel("Component m", { exact: true }).fill("4");
  await dialog.getByLabel("Initial rotation").selectOption("90");
  const dialogArtwork = dialog.locator(".insert-symbol-artwork");
  await expect(dialogArtwork).toHaveAttribute("data-rotation", "90");
  await expect(dialogArtwork.locator("g")).toHaveAttribute(
    "transform",
    "rotate(90)",
  );
  await dialog.getByLabel("Component preview").focus();
  await page.keyboard.press("r");
  await expect(dialog.getByLabel("Initial rotation")).toHaveValue("180");
  await expect(dialogArtwork).toHaveAttribute("data-rotation", "180");
  await dialog.getByLabel("Initial rotation").selectOption("90");
  await dialog.getByRole("checkbox", { name: "Label" }).uncheck();
  await expect(dialog.locator(".insert-parameter-name").first()).toHaveText(
    "W / m(Channel width)",
  );
  await dialog.getByRole("button", { name: "Apply" }).click();

  const canvas = page.getByTestId("schematic-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas is not measurable");
  await page.mouse.move(box.x + 360, box.y + 230);
  await expect(page.getByTestId("component-placement-preview")).toHaveAttribute(
    "transform",
    /rotate\(90\)/u,
  );
  await canvas.click({ position: { x: 360, y: 230 } });
  await page.keyboard.press("Escape");

  await expect(
    page.locator('[data-object-id="instance-label-M1"]'),
  ).toHaveCount(0);
  await page.keyboard.press("q");
  await expect(page.getByLabel("Component w", { exact: true })).toHaveValue(
    "2u",
  );
  await expect(page.getByLabel("Component l", { exact: true })).toHaveValue(
    "180n",
  );
  await expect(page.getByLabel("Component m", { exact: true })).toHaveValue(
    "4",
  );
  await expect(page.getByLabel("Component rotation")).toHaveValue("90");
});

test("keeps component placement active across independent canvas commits", async ({
  page,
}) => {
  await page.goto("/");
  await page.keyboard.press("i");
  const dialog = page.getByRole("dialog", { name: "Insert Component" });
  await dialog.getByLabel("Component search").fill("resistor");
  await dialog.getByRole("button", { name: "Apply" }).click();

  const canvas = page.getByTestId("schematic-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas is not measurable");
  await canvas.dispatchEvent("click", {
    bubbles: true,
    detail: 0,
    clientX: box.x + 360,
    clientY: box.y + 230,
  });

  await expect(page.getByTestId("hit-R1")).toBeVisible();
  await expect(page.getByTestId("component-input-plane")).toBeVisible();
  await canvas.click({ position: { x: 520, y: 230 } });
  await expect(page.getByTestId("hit-R2")).toBeVisible();
  await expect(page.getByTestId("revision")).toHaveText("2");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("component-input-plane")).toHaveCount(0);
});

test("shows the complete foldable categorized Library, quick-places a device, and restores state", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 720 });
  await page.goto("/");
  const panel = page.getByTestId("shapes-library-panel");
  const canvas = page.getByTestId("schematic-canvas");
  const libraryChips = panel.locator('[data-testid^="shapes-chip-"]');
  const categories = panel.locator('[data-testid^="shapes-category-"]');

  await expect(panel).toHaveAttribute("data-open", "true");
  await expect(libraryChips).toHaveCount(18);
  await expect(categories).toHaveCount(6);
  const transistorCategory = page.getByTestId("shapes-category-transistors");
  const transistorChips = transistorCategory.locator(
    '[data-testid^="shapes-chip-"]',
  );
  await expect(transistorChips).toHaveCount(4);
  const transistorGrid = transistorCategory.locator(".shapes-grid");
  expect(
    await transistorGrid.evaluate(
      (element) =>
        getComputedStyle(element).gridTemplateColumns.split(" ").length,
    ),
  ).toBe(4);
  expect(
    await transistorChips.evaluateAll(
      (elements) =>
        new Set(
          elements.map((element) =>
            Math.round(element.getBoundingClientRect().top),
          ),
        ).size,
    ),
  ).toBe(1);
  expect(
    await transistorGrid.evaluate((element) => {
      const gridBounds = element.getBoundingClientRect();
      return [...element.children].every((child) => {
        const tileBounds = child.getBoundingClientRect();
        return (
          tileBounds.left >= gridBounds.left - 0.5 &&
          tileBounds.right <= gridBounds.right + 0.5
        );
      });
    }),
  ).toBe(true);
  const artworkGeometry = await libraryChips.evaluateAll((tiles) =>
    tiles.map((tile) => {
      const tileBounds = tile.getBoundingClientRect();
      const artwork = tile.querySelector<SVGElement>(".shapes-chip-art");
      if (!artwork) throw new Error("Library artwork is missing");
      const artworkBounds = artwork.getBoundingClientRect();
      return {
        centerDeltaX:
          artworkBounds.left +
          artworkBounds.width / 2 -
          (tileBounds.left + tileBounds.width / 2),
        centerDeltaY:
          artworkBounds.top +
          artworkBounds.height / 2 -
          (tileBounds.top + tileBounds.height / 2),
        height: artworkBounds.height,
        tileHeight: tileBounds.height,
        withinTile:
          artworkBounds.left >= tileBounds.left - 0.5 &&
          artworkBounds.right <= tileBounds.right + 0.5 &&
          artworkBounds.top >= tileBounds.top - 0.5 &&
          artworkBounds.bottom <= tileBounds.bottom + 0.5,
        width: artworkBounds.width,
      };
    }),
  );
  expect(artworkGeometry.every((artwork) => artwork.withinTile)).toBe(true);
  expect(
    artworkGeometry.every((artwork) => Math.abs(artwork.width - 40) <= 0.5),
  ).toBe(true);
  expect(
    artworkGeometry.every((artwork) => Math.abs(artwork.height - 32) <= 0.5),
  ).toBe(true);
  expect(
    artworkGeometry.every((artwork) => Math.abs(artwork.centerDeltaX) <= 0.5),
  ).toBe(true);
  expect(
    artworkGeometry.every((artwork) => Math.abs(artwork.centerDeltaY) <= 0.5),
  ).toBe(true);
  expect(
    artworkGeometry.every(
      (artwork) => Math.abs(artwork.tileHeight - 52) <= 0.5,
    ),
  ).toBe(true);
  await expect(libraryChips.locator("span")).toHaveCount(0);
  await expect(transistorCategory).toHaveJSProperty("open", true);
  await transistorCategory.locator("summary").click();
  await expect(transistorCategory).toHaveJSProperty("open", false);
  await expect(page.getByTestId("shapes-chip-nmos")).not.toBeVisible();
  const analogCategory = page.getByTestId("shapes-category-analog-blocks");
  await expect(analogCategory).toHaveJSProperty("open", true);
  await expect(
    page
      .getByTestId("shapes-category-power-and-ports")
      .locator('[data-testid^="shapes-chip-"]'),
  ).toHaveCount(4);
  await expect(
    panel.getByRole("button", { name: "Place Independent Voltage Source" }),
  ).toBeAttached();

  await page.getByTestId("shapes-chip-resistor").click();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas is not measurable");
  await page.mouse.move(box.x + 280, box.y + 220);
  await expect(page.getByTestId("component-placement-preview")).toBeVisible();
  await canvas.click({ position: { x: 280, y: 220 } });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("hit-R1")).toBeVisible();
  const recentResistor = page.getByTestId("shapes-recent-resistor");
  await expect(recentResistor).toBeVisible();
  await expect(recentResistor).toHaveAttribute("aria-label", "Place Resistor");
  await expect(recentResistor).toHaveAttribute("title", "Place Resistor");
  await expect(recentResistor.locator("span")).toHaveCount(0);
  expect(
    await page
      .getByTestId("shapes-fold-recent")
      .locator(".shapes-grid")
      .evaluate(
        (element) =>
          getComputedStyle(element).gridTemplateColumns.split(" ").length,
      ),
  ).toBe(4);
  await expect(transistorCategory).toHaveJSProperty("open", false);
  await expect(page.getByTestId("shapes-chip-nmos")).not.toBeVisible();
  await expect(analogCategory).toHaveJSProperty("open", true);
  await transistorCategory.locator("summary").click();
  await expect(transistorCategory).toHaveJSProperty("open", true);
  await expect(page.getByTestId("shapes-chip-nmos")).toBeVisible();

  await page.keyboard.press("q");
  await expect(page.getByLabel("Component value")).toHaveValue("");
  await page.getByTestId("library-toggle").click();
  await expect(panel).toHaveAttribute("data-open", "false");
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("icm.library-panel-open.v1")),
    )
    .toBe("false");

  await page.reload();
  await expect(page.getByTestId("shapes-library-panel")).toHaveAttribute(
    "data-open",
    "false",
  );
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("icm.recent-components.v1")),
    )
    .toContain("resistor");
});

test("keeps a usable canvas while toggling Library at the narrow breakpoint", async ({
  page,
}) => {
  await page.setViewportSize({ width: 720, height: 720 });
  await page.goto("/");

  const chrome = page.locator(".app-chrome-main");
  const analytics = page.getByRole("link", { name: "Open visitor analytics" });
  const help = page.getByRole("button", { name: "Help" });
  await expect(analytics).toBeVisible();
  await expect(help).toBeVisible();
  const chromeBox = await chrome.boundingBox();
  const analyticsBox = await analytics.boundingBox();
  const helpBox = await help.boundingBox();
  if (!chromeBox || !analyticsBox || !helpBox) {
    throw new Error("Top navigation is not measurable");
  }
  expect(helpBox.x).toBeGreaterThan(analyticsBox.x);
  expect(helpBox.x + helpBox.width).toBeLessThanOrEqual(
    chromeBox.x + chromeBox.width,
  );

  const narrowArtwork = await page
    .locator('[data-testid^="shapes-chip-"]')
    .evaluateAll((tiles) =>
      tiles.map((tile) => {
        const tileBounds = tile.getBoundingClientRect();
        const artwork = tile.querySelector<SVGElement>(".shapes-chip-art");
        if (!artwork) throw new Error("Narrow Library artwork is missing");
        const artworkBounds = artwork.getBoundingClientRect();
        return {
          centerDeltaX:
            artworkBounds.left +
            artworkBounds.width / 2 -
            (tileBounds.left + tileBounds.width / 2),
          centerDeltaY:
            artworkBounds.top +
            artworkBounds.height / 2 -
            (tileBounds.top + tileBounds.height / 2),
          height: artworkBounds.height,
          tileHeight: tileBounds.height,
          withinTile:
            artworkBounds.left >= tileBounds.left - 0.5 &&
            artworkBounds.right <= tileBounds.right + 0.5 &&
            artworkBounds.top >= tileBounds.top - 0.5 &&
            artworkBounds.bottom <= tileBounds.bottom + 0.5,
          width: artworkBounds.width,
        };
      }),
    );
  expect(
    narrowArtwork.every((artwork) => Math.abs(artwork.width - 46) <= 0.5),
  ).toBe(true);
  expect(
    narrowArtwork.every((artwork) => Math.abs(artwork.height - 36) <= 0.5),
  ).toBe(true);
  expect(
    narrowArtwork.every((artwork) => Math.abs(artwork.centerDeltaX) <= 0.5),
  ).toBe(true);
  expect(
    narrowArtwork.every((artwork) => Math.abs(artwork.centerDeltaY) <= 0.5),
  ).toBe(true);
  expect(
    narrowArtwork.every((artwork) => Math.abs(artwork.tileHeight - 60) <= 0.5),
  ).toBe(true);
  expect(narrowArtwork.every((artwork) => artwork.withinTile)).toBe(true);
  await expect(page.locator('[data-testid^="shapes-chip-"] span')).toHaveCount(
    0,
  );

  const canvas = page.getByTestId("schematic-canvas");
  const openWidth = (await canvas.boundingBox())?.width ?? 0;
  expect(openWidth).toBeGreaterThan(300);

  await page.getByTestId("library-toggle").click();
  await expect(page.getByTestId("shapes-library-panel")).toHaveAttribute(
    "data-open",
    "false",
  );
  const closedWidth = (await canvas.boundingBox())?.width ?? 0;
  expect(closedWidth).toBeCloseTo(openWidth, 0);
  expect(closedWidth).toBeGreaterThan(300);
  expect(
    await page.evaluate(() => ({
      horizontal:
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
      vertical:
        document.documentElement.scrollHeight >
        document.documentElement.clientHeight,
    })),
  ).toEqual({ horizontal: false, vertical: false });
});

test("double-clicking a placed device opens Properties for editing", async ({
  page,
}) => {
  await page.goto("/");
  await page.keyboard.press("i");
  const dialog = page.getByRole("dialog", { name: "Insert Component" });
  await dialog.getByLabel("Component search").fill("resistor");
  await dialog.getByLabel("Component value").fill("4.7k");
  await dialog.getByRole("button", { name: "Apply" }).click();
  const canvas = page.getByTestId("schematic-canvas");
  await canvas.click({ position: { x: 360, y: 230 } });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("hit-R1")).toBeVisible();
  await expect(page.getByTestId("selection-shelf")).toHaveAttribute(
    "aria-expanded",
    "false",
  );

  await page.getByTestId("hit-R1").dblclick();
  await expect(page.getByTestId("selection-shelf")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  const propertyValue = page.getByLabel("Component value");
  await expect(propertyValue).toBeVisible();
  await expect(propertyValue).toHaveValue("4.7k");
  await expect(propertyValue).toBeFocused();
});

test("Library rail folds the sidebar; Insert and title open the catalog", async ({
  page,
}) => {
  await page.goto("/");
  const panel = page.getByTestId("shapes-library-panel");
  await expect(panel).toHaveAttribute("data-open", "true");

  await page.getByTestId("library-toggle").click();
  await expect(panel).toHaveAttribute("data-open", "false");
  await page.getByTestId("library-toggle").click();
  await expect(panel).toHaveAttribute("data-open", "true");

  await page.getByTestId("shapes-insert").click();
  await expect(
    page.getByRole("dialog", { name: "Insert Component" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "Insert Component" }),
  ).toHaveCount(0);

  await page
    .getByRole("button", { name: /Library/ })
    .filter({ hasText: "Quick place" })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Insert Component" }),
  ).toBeVisible();
});
