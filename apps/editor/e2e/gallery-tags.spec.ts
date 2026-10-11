// The tag sidebar and tag menu: grouped categories, multi-selection, resizing
// and narrow layouts.

import { expect, test } from "./gallery-test.js";
import { ENTRY, galleryListUrl } from "./gallery-fixtures.js";

test("tag categories select all children, retain other groups and expose mixed selection", async ({
  page,
}) => {
  const queries: string[][] = [];
  await page.route("**/api/gallery**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/gallery/tags")
      return route.fulfill({
        json: {
          tags: [
            { tag: "amplifier", count: 3 },
            { tag: "op", count: 1 },
            { tag: "buffer", count: 2 },
          ],
        },
      });
    if (url.pathname !== "/api/gallery") return route.fallback();
    queries.push(
      (url.searchParams.get("tags") ?? "").split(",").filter(Boolean),
    );
    return route.fulfill({ json: { entries: [], nextCursor: null } });
  });
  await page.goto("/?tags=buffer");
  const sidebar = page.getByTestId("gallery-tag-sidebar");
  const category = sidebar.getByRole("checkbox", {
    name: "Amplifiers",
    exact: true,
  });
  const buffer = sidebar.getByRole("checkbox", {
    name: "Buffers",
    exact: true,
  });
  const group = sidebar.locator(".gallery-tag-group").filter({
    has: page.getByRole("checkbox", { name: "Amplifiers", exact: true }),
  });
  await expect(category).toHaveAttribute("aria-checked", "false");
  await expect(buffer).toHaveAttribute("aria-checked", "true");
  await category.click();
  await expect(category).toHaveAttribute("aria-checked", "true");
  const children = group.locator(".gallery-sidebar-tag");
  expect(await children.count()).toBeGreaterThan(20);
  await expect(
    group.locator('.gallery-sidebar-tag[aria-pressed="true"]'),
  ).toHaveCount(await children.count());
  await expect
    .poll(() => queries.at(-1))
    .toEqual(
      expect.arrayContaining([
        "buffer",
        "op",
        "ota",
        "amplifier",
        "source degeneration",
      ]),
    );
  await page.getByTestId("gallery-tag-option-ota").click();
  await expect(category).toHaveAttribute("aria-checked", "mixed");
  await category.press("Space");
  await expect(category).toHaveAttribute("aria-checked", "true");
  // Collapse is independent of selection, and selected groups can collapse.
  await sidebar
    .getByRole("button", { name: "Collapse Amplifiers", exact: true })
    .click();
  await expect(page.getByTestId("gallery-tag-option-ota")).toBeHidden();
  await expect(category).toHaveAttribute("aria-checked", "true");
  await page.reload();
  await expect(category).toHaveAttribute("aria-checked", "true");
  await category.press("Enter");
  await expect(category).toHaveAttribute("aria-checked", "false");
  await expect(buffer).toHaveAttribute("aria-checked", "true");
  await expect.poll(() => queries.at(-1)).toEqual(["buffer"]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: /^Search & filters/ }).click();
  await category.click();
  await expect(category).toHaveAttribute("aria-checked", "true");
  await category.click();
  await expect(category).toHaveAttribute("aria-checked", "false");
  await expect(buffer).toHaveAttribute("aria-checked", "true");
});

test("the left sidebar hosts overall search and grouped tags at desktop, half-screen and mobile widths", async ({
  page,
}) => {
  // Enough tags that the row would wrap over several lines unfiltered, which
  // is what pushed the wall itself below the fold.
  const tags = [
    "amplifier",
    "oscillator",
    "comparator",
    "dcdc",
    "power",
    "differential",
    "ota",
    "pll",
    "vtc",
    "adc",
    "bandgap",
    "cmfb",
    "current mirror",
    "ldo",
  ];
  let tagRequestCount = 0;
  let galleryRequestCount = 0;
  await page.route("**/api/gallery**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/gallery/tags") {
      tagRequestCount += 1;
      return route.fulfill({
        json: {
          tags: tags.map((tag, index) => ({ tag, count: index + 1 })),
          groups: [{ group: "Buffers", count: 23 }],
        },
      });
    }
    if (url.pathname !== "/api/gallery") return route.fallback();
    galleryRequestCount += 1;
    return route.fulfill({
      json: {
        entries: [
          {
            id: "t-one",
            name: "Circuit",
            author: "tz",
            description: "",
            createdAt: "2026-08-22T10:00:00.000Z",
            schemaVersion: 23,
            tags: ["ldo"],
          },
        ],
        nextCursor: null,
      },
    });
  });
  await page.route("**/api/gallery/*/preview.svg", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 6"><rect width="10" height="6" fill="#fff"/></svg>',
    }),
  );

  await page.goto("/");
  const sidebar = page.getByTestId("gallery-tag-sidebar");
  const tile = page.getByTestId("gallery-tile-t-one");
  await expect(sidebar).toBeVisible();
  await expect.poll(() => tagRequestCount).toBe(1);
  await expect.poll(() => galleryRequestCount).toBe(1);
  await expect(page.getByText("Browse", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Categories", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Tagged circuits", { exact: true })).toHaveCount(
    0,
  );
  expect(
    await sidebar
      .locator(".gallery-tag-group-name")
      .evaluateAll((items) => items.map((item) => item.textContent?.trim())),
  ).toEqual([
    "Amplifiers",
    "Bias & references",
    "Buffers",
    "Clock & timing",
    "Computing",
    "Conversion",
    "Custom & legacy",
    "Design Attributes",
    "Devices & models",
    "Filters",
    "Logic & memory",
    "Power",
    "RF & communications",
    "Sampling",
    "Sensors",
  ]);
  const amplifierGroup = sidebar.getByRole("checkbox", {
    name: "Amplifiers",
    exact: true,
  });
  await expect(
    sidebar
      .getByRole("checkbox", { name: "Buffers", exact: true })
      .locator(".gallery-sidebar-count"),
  ).toHaveText("23");
  await expect(amplifierGroup).toBeVisible();
  await expect(amplifierGroup).toHaveCSS("font-weight", "600");
  await sidebar
    .getByRole("button", { name: "Expand Amplifiers", exact: true })
    .click();
  const amplifier = page.getByTestId("gallery-tag-option-amplifier");
  await expect(amplifier).toContainText("General Amplifier");
  expect((await amplifier.boundingBox())!.height).toBeLessThanOrEqual(28);
  const sidebarRhythm = await amplifierGroup.evaluate((summary) => {
    const group = summary.closest(".gallery-tag-group")!;
    const items = [
      ...group.querySelectorAll<HTMLElement>(".gallery-sidebar-tag"),
    ];
    const summaryStyle = getComputedStyle(summary);
    const itemStyle = getComputedStyle(items[0]!);
    const first = items[0]!.getBoundingClientRect();
    const second = items[1]!.getBoundingClientRect();
    const name = summary.querySelector(".gallery-tag-group-name")!;
    const check = items[0]!.querySelector(".gallery-tag-check")!;
    return {
      fontMatches: summaryStyle.fontFamily === itemStyle.fontFamily,
      colorMatches: summaryStyle.color === itemStyle.color,
      summaryFontSize: summaryStyle.fontSize,
      summaryFontWeight: summaryStyle.fontWeight,
      summaryPaddingBlock: [
        summaryStyle.paddingTop,
        summaryStyle.paddingBottom,
      ],
      groupMarginBottom: getComputedStyle(group).marginBottom,
      itemGap: second.top - first.bottom,
      // A tag's box starts where its group's name does.
      tagIndent:
        check.getBoundingClientRect().left - name.getBoundingClientRect().left,
    };
  });
  expect(sidebarRhythm).toEqual({
    fontMatches: true,
    colorMatches: true,
    summaryFontSize: "12px",
    summaryFontWeight: "600",
    // With a mouse, rows sit about a tenth closer than touch rows.
    summaryPaddingBlock: ["4.5px", "4.5px"],
    groupMarginBottom: "4px",
    itemGap: 1,
    tagIndent: 0,
  });
  const search = page.getByTestId("gallery-search");
  await expect(search).toHaveCount(1);
  await expect(page.getByTestId("gallery-tag-search")).toHaveCount(0);
  await sidebar
    .getByRole("button", { name: "Expand Conversion", exact: true })
    .click();
  await expect(page.getByTestId("gallery-tag-option-adc")).toContainText("ADC");
  const logicGroup = sidebar.locator(".gallery-tag-group").filter({
    has: page.getByRole("checkbox", { name: "Logic & memory", exact: true }),
  });
  await logicGroup
    .getByRole("button", { name: "Expand Logic & memory", exact: true })
    .click();
  await expect(
    logicGroup
      .locator(".gallery-sidebar-tag .gallery-tag-name")
      .evaluateAll((items) => items.map((item) => item.textContent)),
  ).resolves.toEqual([
    "AND",
    "CML",
    "D Flip Flop",
    "D Latch",
    "DRAM",
    "Flip Flop",
    "Inverter",
    "Latch",
    "Level Shifter",
    "Logic",
    "Memory Cell",
    "Multiplexer",
    "NAND",
    "NOR",
    "OR",
    "Sense Amplifier",
    "SRAM",
    "TSPC",
    "XOR",
  ]);
  await sidebar
    .getByRole("button", { name: "Expand Power", exact: true })
    .click();
  const ldo = page.getByTestId("gallery-tag-option-ldo");
  await expect(ldo).toHaveCount(1);
  await ldo.scrollIntoViewIfNeeded();
  await expect(ldo).toBeVisible();
  expect(
    (await sidebar.boundingBox())!.x + (await sidebar.boundingBox())!.width,
  ).toBeLessThan((await tile.boundingBox())!.x);

  await search.fill("ld");
  await expect(page.getByTestId("gallery-tag-option-ldo")).toBeVisible();
  await expect(page.getByTestId("gallery-tag-option-amplifier")).toBeVisible();
  // The overall search narrows circuits without mutating tag navigation.
  await expect(search).toHaveValue("ld");
  await expect(tile).toBeVisible();
  await page.getByTestId("gallery-tag-option-ldo").click();
  await search.fill("osc");
  await expect(page.getByTestId("gallery-tag-option-ldo")).toBeVisible();
  await expect(page.getByTestId("gallery-tags-clear")).toContainText(
    "Clear 1 selected",
  );
  await expect(page).toHaveURL(/tags=ldo/);
  await search.fill("");
  await expect(tile).toBeVisible();

  await page.setViewportSize({ width: 800, height: 800 });
  await expect(sidebar).toBeVisible();
  // The ResizeObserver adapts the column after the viewport change; wait for
  // that layout pass before comparing the two columns.
  await expect
    .poll(async () => {
      const sidebarBox = await page
        .locator(".gallery-sidebar-slot")
        .boundingBox();
      const tileBox = await tile.boundingBox();
      return sidebarBox && tileBox
        ? sidebarBox.x + sidebarBox.width < tileBox.x
        : false;
    })
    .toBe(true);
  await expect(page.locator(".gallery-main")).toHaveJSProperty(
    "scrollWidth",
    await page
      .locator(".gallery-main")
      .evaluate((element) => element.clientWidth),
  );
  await page.screenshot({ path: "plan/gallery-sidebar-half.png" });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(sidebar).toBeHidden();
  await page.getByRole("button", { name: "Search & filters" }).click();
  await expect(sidebar).toBeVisible();
  await page.getByTestId("gallery-tags-clear").click();
  await expect(page.getByTestId("gallery-tag-option-ldo")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await page.getByRole("button", { name: "Search & filters" }).click();
  await expect(sidebar).toBeHidden();
  await expect(tile).toBeVisible();
  await page.getByTestId("gallery-search").fill("zzz");
  await expect(page.getByTestId("gallery-search-empty")).toBeVisible();
});

test("the tag sidebar resizes by dragging and keyboard, remembers width and adapts to narrow windows", async ({
  page,
}) => {
  await page.route(galleryListUrl, (route) =>
    route.fulfill({ json: { entries: [ENTRY], nextCursor: null, total: 1 } }),
  );
  await page.route("**/api/gallery/tags", (route) =>
    route.fulfill({ json: { tags: [{ tag: "amplifier", count: 1 }] } }),
  );
  await page.route("**/api/gallery/*/preview.svg*", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 6"/>',
    }),
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  // Invalid saved settings must not break the layout or disable resizing.
  await page.evaluate(() =>
    localStorage.setItem("icm.gallery.sidebarWidth", "invalid"),
  );
  await page.reload();
  const handle = page.getByRole("separator", {
    name: "Resize Gallery filters",
  });
  const slot = page.locator(".gallery-sidebar-slot");
  const expectWidth = async (width: number) => {
    await expect(handle).toHaveAttribute("aria-valuenow", String(width));
    await expect
      .poll(async () => (await slot.boundingBox())?.width)
      .toBe(width);
  };
  const drag = async (delta: number) => {
    const bounds = (await handle.boundingBox())!;
    const x = bounds.x + bounds.width / 2;
    // Below the sticky header, however far focus scrolled the Gallery: a
    // full filter list makes the column taller than the window.
    const y = Math.max(bounds.y, 0) + 100;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + delta, y + 70, { steps: 5 });
    await page.mouse.up();
  };
  await expectWidth(262);
  await expect(handle).toHaveCSS("cursor", "col-resize");
  await drag(110);
  await expectWidth(372);
  await page.reload();
  await expectWidth(372);
  await drag(-80);
  await expectWidth(292);
  // Releasing away from the edge must terminate the captured drag.
  await page.mouse.move(700, 500);
  await expectWidth(292);
  await handle.focus();
  await page.keyboard.press("ArrowRight");
  await expectWidth(300);
  await page.keyboard.press("Home");
  await expectWidth(180);
  await drag(-100);
  await expectWidth(180);
  await drag(700);
  await expectWidth(420);
  await page.setViewportSize({ width: 800, height: 800 });
  await expectWidth(360);
  await expect(page.locator(".gallery-main")).toHaveJSProperty(
    "scrollWidth",
    await page
      .locator(".gallery-main")
      .evaluate((element) => element.clientWidth),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(handle).toBeHidden();
  await page.getByRole("button", { name: "Search & filters" }).click();
  await expect(page.getByTestId("gallery-tag-sidebar")).toBeVisible();
  // Mobile filters fill their container instead of keeping the desktop width.
  expect((await slot.boundingBox())!.width).toBe(
    (await page.locator(".gallery-browser").boundingBox())!.width,
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await expectWidth(420);
  await page.reload();
  await expectWidth(420);
});

test("the tag menu multi-selects and tile tags join the selection", async ({
  page,
}) => {
  const listQueries: string[] = [];
  await page.route("**/api/gallery**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/gallery/tags") {
      return route.fulfill({
        json: {
          tags: [
            { tag: "amplifier", count: 3 },
            { tag: "adc", count: 2 },
            { tag: "pll", count: 1 },
          ],
        },
      });
    }
    if (url.pathname !== "/api/gallery") return route.fallback();
    listQueries.push(url.searchParams.get("tags") ?? "");
    const selected = (url.searchParams.get("tags") ?? "")
      .split(",")
      .filter(Boolean);
    const all = [
      { id: "t-amp", tags: ["amplifier"] },
      { id: "t-adc", tags: ["adc", "amplifier"] },
      { id: "t-pll", tags: ["pll"] },
    ];
    const entries = all
      .filter(
        (entry) =>
          selected.length === 0 ||
          entry.tags.some((tag) => selected.includes(tag)),
      )
      .map((entry) => ({
        id: entry.id,
        name: `Circuit ${entry.id}`,
        author: "tz",
        description: "",
        createdAt: "2026-08-22T10:00:00.000Z",
        schemaVersion: 23,
        tags: entry.tags,
      }));
    return route.fulfill({ json: { entries, nextCursor: null } });
  });
  await page.route("**/api/gallery/*/preview.svg", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 6"><rect width="10" height="6" fill="#fff"/></svg>',
    }),
  );

  await page.goto("/");
  await expect(page.getByTestId("gallery-tile-t-pll")).toBeVisible();

  // Multi-select two tags: OR union, URL carried.
  const sidebar = page.getByTestId("gallery-tag-sidebar");
  await sidebar
    .getByRole("button", { name: "Expand Amplifiers", exact: true })
    .click();
  await sidebar
    .getByRole("button", { name: "Expand Conversion", exact: true })
    .click();
  const search = page.getByTestId("gallery-search");
  await search.fill("amplifier");
  await page.getByTestId("gallery-tag-option-amplifier").click();
  await expect(page.getByTestId("gallery-tile-t-pll")).toHaveCount(0);
  await search.fill("adc");
  await page.getByTestId("gallery-tag-option-adc").click();
  await expect(page).toHaveURL(/tags=amplifier%2Cadc|tags=amplifier,adc/);
  await search.fill("");
  await expect(page.getByTestId("gallery-tile-t-amp")).toBeVisible();
  expect(listQueries).toContain("amplifier,adc");

  // Clearing restores the full wall; a tile tag chip re-enters selection.
  await page.getByTestId("gallery-tags-clear").click();
  await expect(page.getByTestId("gallery-tile-t-pll")).toBeVisible();
  await page.getByTestId("gallery-tile-tag-t-pll-pll").click();
  await expect(page.getByTestId("gallery-tile-t-amp")).toHaveCount(0);
  await expect(page.getByTestId("gallery-tag-option-pll")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});
