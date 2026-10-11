// The editor's Gallery and Examples panels: copying an entry into the drawing,
// tag columns, and guarding unsaved work.

import { expect, test } from "./gallery-test.js";
import { readFileSync } from "node:fs";
import { serializeProject, parseProject } from "@icm/project-protocol";
import { awaitEditorReady, chooseComponent } from "./editor-fixtures.js";
import { ENTRY, mockGallery } from "./gallery-fixtures.js";

test("Gallery does not label stale search totals as a new answer during debounce", async ({
  page,
}) => {
  await mockGallery(page, [ENTRY]);
  await page.route(
    (url) => url.pathname === "/api/gallery" && url.searchParams.has("q"),
    (route) => {
      const query = new URL(route.request().url()).searchParams.get("q")!;
      return route.fulfill({
        json: {
          entries: query === "empty" ? [] : [{ ...ENTRY, name: query }],
          nextCursor: null,
          total: query === "empty" ? 0 : 1,
          search: query,
        },
      });
    },
  );
  await page.goto("/editor");
  await awaitEditorReady(page);
  await page.getByTestId("examples-toggle").click();
  const search = page.getByTestId("examples-panel-search");
  const count = page.getByTestId("examples-panel-count");
  await search.fill("amp");
  await expect(count).toHaveText("1 matching circuit");
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await search.fill("clock");
  await expect(count).toHaveCount(0);
  await expect(page.getByTestId("examples-panel-empty")).toHaveText(
    "Searching…",
  );
  await page.clock.runFor(300);
  await expect(count).toHaveText("1 matching circuit");
  await search.fill("");
  await expect(count).toHaveCount(0);
  await expect(search).toBeFocused();
  await search.fill("empty");
  await page.clock.runFor(300);
  await expect(count).toHaveText("0 matching circuits");
  for (const query of ["clock", ""]) {
    await search.fill(query);
    await expect(count).toHaveCount(0);
    await expect(page.getByTestId("examples-panel-empty")).toHaveText(
      "Searching…",
    );
    await expect(
      page.getByText("No published circuits yet.", { exact: true }),
    ).toHaveCount(0);
  }
});

test("search keeps focus through pending queries and ignores an older response", async ({
  page,
}) => {
  await mockGallery(page, [ENTRY]);
  let releaseOld: (() => void) | undefined;
  await page.route(
    (url) => url.pathname === "/api/gallery" && url.searchParams.has("q"),
    async (route) => {
      const query = new URL(route.request().url()).searchParams.get("q");
      if (query === "old")
        await new Promise<void>((resolve) => {
          releaseOld = resolve;
        });
      await route.fulfill({
        json: {
          entries: query === "new" ? [{ ...ENTRY, name: "new result" }] : [],
          nextCursor: null,
          total: query === "new" ? 1 : 0,
          search: query,
        },
      });
    },
  );
  await page.goto("/editor");
  await awaitEditorReady(page);
  await page.getByTestId("examples-toggle").click();
  const search = page.getByTestId("examples-panel-search");
  await search.fill("old");
  await expect.poll(() => Boolean(releaseOld)).toBe(true);
  await expect(search).toBeFocused();
  await search.press("ControlOrMeta+A");
  await search.pressSequentially("new");
  await expect(page.getByTestId(`gallery-example-${ENTRY.id}`)).toContainText(
    "new result",
  );
  const oldResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/gallery" && url.searchParams.get("q") === "old"
    );
  });
  releaseOld!();
  await (await oldResponse).finished();
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await expect(search).toBeFocused();
  await expect(search).toHaveValue("new");
  await expect(page.getByTestId(`gallery-example-${ENTRY.id}`)).toContainText(
    "new result",
  );
});

for (const invalidation of ["reopen", "account"] as const) {
  test(`Gallery ${invalidation} discards pending data from the previous owner`, async ({
    page,
  }) => {
    await mockGallery(page, [ENTRY]);
    let requests = 0;
    let releaseOld: (() => void) | undefined;
    let signedOut = false;
    await page.route(
      (url) => url.pathname === "/api/gallery",
      async (route) => {
        const request = ++requests;
        if (request === 1)
          await new Promise<void>((resolve) => {
            releaseOld = resolve;
          });
        await route.fulfill(
          signedOut
            ? { status: 401, json: { error: "Sign in" } }
            : {
                json: {
                  entries: [
                    {
                      ...ENTRY,
                      name: request === 1 ? "Old account" : "Current account",
                    },
                  ],
                  nextCursor: null,
                  total: 1,
                },
              },
        );
      },
    );
    await page.goto("/editor");
    await awaitEditorReady(page);
    const toggle = page.getByTestId("examples-toggle");
    await toggle.click();
    await expect.poll(() => Boolean(releaseOld)).toBe(true);
    if (invalidation === "reopen") {
      await toggle.click();
      await toggle.click();
    } else
      await page.evaluate(() =>
        window.dispatchEvent(new Event("icm-account-changed")),
      );
    const card = page.getByTestId(`gallery-example-${ENTRY.id}`);
    await expect(card).toContainText("Current account");
    const oldResponse = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/gallery",
    );
    releaseOld!();
    await (await oldResponse).finished();
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await expect(card).toContainText("Current account");
    await expect(page.getByTestId("examples-panel-count")).toHaveText(
      "1 circuit",
    );
    signedOut = true;
    await page.evaluate(() =>
      window.dispatchEvent(new Event("icm-account-changed")),
    );
    await expect(page.getByTestId("examples-panel-sign-in")).toBeVisible();
    await expect(card).toHaveCount(0);
  });
}

test("Gallery copies SKY130 dependencies with preview, repeat placement and atomic undo", async ({
  page,
}) => {
  const source = parseProject(
    readFileSync(
      "apps/editor/src/examples/simulation-common-source.icproj.json",
      "utf8",
    ),
  );
  const count = source.documents.find((d) => d.id === source.topDocumentId)!
    .instances.length;
  await mockGallery(page, [{ ...ENTRY, tags: ["clock"] }]);
  await page.route(`**/api/gallery/${ENTRY.id}`, (route) =>
    route.fulfill({
      json: { entry: ENTRY, projectText: serializeProject(source) },
    }),
  );
  await page.goto("/editor");
  await awaitEditorReady(page);
  await page.getByTestId("examples-toggle").click();
  const panel = page.getByTestId("examples-panel");
  await expect(panel.getByTestId("examples-panel-tag-toggle")).toHaveCount(0);
  const search = panel.getByTestId("examples-panel-search");
  await expect(search).toHaveAttribute("placeholder", "Search Gallery…");
  await search.fill("clock");
  await expect(page.getByTestId(`gallery-example-${ENTRY.id}`)).toBeVisible();
  await search.fill("");
  await page.getByTestId(`gallery-example-${ENTRY.id}`).click();
  const canvas = page.getByTestId("schematic-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas is not measurable");
  await page.mouse.move(box.x + 260, box.y + 220);
  await expect(page.getByTestId("copy-placement-preview")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("instance-count")).toHaveText("0");
  await page.getByTestId(`gallery-example-${ENTRY.id}`).click();
  await page.mouse.move(box.x + 260, box.y + 220);
  await page.keyboard.press("r");
  await canvas.click({ position: { x: 260, y: 220 } });
  await expect(page.getByTestId("instance-count")).toHaveText(String(count));
  await expect(page.getByTestId("copy-placement-preview")).toBeVisible();
  await canvas.click({ position: { x: 600, y: 380 } });
  await expect(page.getByTestId("instance-count")).toHaveText(
    String(count * 2),
  );
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("instance-count")).toHaveText(String(count));
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("instance-count")).toHaveText("0");
  await page.keyboard.press("Control+Shift+z");
  await expect(page.getByTestId("instance-count")).toHaveText(String(count));
});

test("Editor Gallery gives tags one column only after widening beyond three circuit columns", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  const clockEntries = Array.from({ length: 30 }, (_, i) => ({
    ...ENTRY,
    id: `clock-${i}`,
    tags: ["clock"],
    name: `Clock ${i}`,
  }));
  let olderRequests = 0;
  await page.route("**/api/gallery**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/gallery/tags")
      return route.fulfill({
        json: {
          tags: [
            { tag: "clock", count: 30 },
            { tag: "bandgap", count: 1 },
          ],
          groups: [{ group: "Bias & references", count: 1 }],
        },
      });
    if (url.pathname !== "/api/gallery") return route.fallback();
    const older = url.searchParams.has("cursor");
    if (older) olderRequests++;
    return route.fulfill({
      json: {
        entries: older
          ? [
              {
                ...ENTRY,
                id: "bias",
                name: "Bandgap reference",
                author: "Lin",
                tags: ["bandgap"],
              },
            ]
          : clockEntries,
        total: 31,
        nextCursor: older ? null : "older",
      },
    });
  });
  await page.route("**/preview.svg*", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M1 5h8" stroke="black"/></svg>',
    }),
  );
  await page.goto("/editor?new=1");
  await awaitEditorReady(page);
  await page.getByTestId("examples-toggle").click();
  const panel = page.getByTestId("examples-panel");
  const tags = panel.getByTestId("examples-panel-tags");
  const cards = panel.locator(".shapes-example-card");
  const resize = async (width: number) => {
    const handle = await page
      .getByTestId("library-resize-handle")
      .boundingBox();
    const box = await panel.boundingBox();
    if (!handle || !box) throw new Error("Gallery cannot be measured");
    await page.mouse.move(handle.x + handle.width / 2, handle.y + 100);
    await page.mouse.down();
    await page.mouse.move(
      handle.x + handle.width / 2 + width - box.width,
      handle.y + 100,
      { steps: 10 },
    );
    await page.mouse.up();
    // The dock animates after pointer-up; settle before grabbing its next edge.
    await expect
      .poll(async () => Math.abs((await panel.boundingBox())!.width - width))
      .toBeLessThan(2);
  };
  await expect(cards).toHaveCount(30);
  await resize(640);
  await expect(tags).toBeHidden();
  await expect
    .poll(() =>
      panel
        .locator(".shapes-example-list")
        .evaluate(
          (e) => getComputedStyle(e).gridTemplateColumns.split(" ").length,
        ),
    )
    .toBe(3);
  await resize(720);
  await expect(tags).toBeVisible();
  await expect
    .poll(() =>
      panel
        .locator(".shapes-example-list")
        .evaluate(
          (e) => getComputedStyle(e).gridTemplateColumns.split(" ").length,
        ),
    )
    .toBe(3);
  await expect(
    tags.getByRole("checkbox", { name: "Bias & references", exact: true }),
  ).toContainText("1");
  await page.screenshot({ path: "plan/gallery-wide-tags.png" });
  await tags
    .getByRole("button", { name: "Expand Bias & references", exact: true })
    .click();
  await tags.getByTestId("gallery-tag-option-bandgap").click();
  await expect(panel.getByTestId("gallery-example-bias")).toBeVisible();
  expect(olderRequests).toBe(1);
  await expect(cards).toHaveCount(1);
  await expect(panel.getByTestId("examples-panel-count")).toHaveText(
    "31 circuits · 1 match",
  );
  const search = panel.getByTestId("examples-panel-search");
  await search.fill("lin");
  await expect(cards).toHaveCount(1);
  await search.fill("clock");
  await expect(cards).toHaveCount(0);
  await expect(panel.getByTestId("examples-panel-empty")).toHaveText(
    "No circuits match these filters.",
  );
  await expect(panel.locator('[data-testid^="shapes-example-"]')).toHaveCount(
    0,
  );
  await search.fill("");
  await resize(320);
  await expect(tags).toBeHidden();
  await expect(panel.getByTestId("gallery-example-bias")).toBeVisible();
  await expect(search).toBeVisible();
  await panel.getByTestId("examples-panel-clear-tags").click();
  await expect(cards).toHaveCount(31);
  await resize(900);
  await expect(tags).toBeVisible();
  await expect
    .poll(() =>
      panel
        .locator(".shapes-example-list")
        .evaluate(
          (e) => getComputedStyle(e).gridTemplateColumns.split(" ").length,
        ),
    )
    .toBe(4);
  await tags
    .getByRole("checkbox", { name: "Bias & references", exact: true })
    .click();
  await expect(cards).toHaveCount(1);
  await tags
    .getByRole("checkbox", { name: "Bias & references", exact: true })
    .click();
  await expect(cards).toHaveCount(31);
});

test("the Examples panel guards dirty work before opening an entry", async ({
  page,
}) => {
  await mockGallery(page, [ENTRY]);
  await page.route("**/api/gallery?limit=60", (route) =>
    route.fulfill({ json: { entries: [ENTRY], nextCursor: null } }),
  );

  await page.goto("/editor");
  for (const x of [300, 380, 460]) {
    await chooseComponent(page, "resistor");
    await page
      .getByTestId("schematic-canvas")
      .click({ position: { x, y: 230 } });
    await page.keyboard.press("Escape");
  }
  await expect(page.getByTestId("hit-R1")).toHaveCount(1);
  await page.getByTestId("examples-toggle").click();
  const panel = page.getByTestId("examples-panel");
  await expect(panel).toHaveAttribute("data-open", "true");
  const card = panel.getByTestId(`gallery-example-${ENTRY.id}`);
  await expect(card).toBeVisible();
  await expect(card).toContainText(ENTRY.name);
  await expect(card).toContainText(ENTRY.author);
  // The panel replaced the bundled list with the shared gallery source.
  await expect(
    panel.getByTestId("shapes-example-common-source-amplifier"),
  ).toHaveCount(0);

  await card.click();
  const dialog = page.getByRole("dialog", {
    name: "Unsaved changes",
  });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Stay" }).click();
  await expect(page.getByTestId("hit-R1")).toHaveCount(1);

  await card.click();
  await dialog.getByRole("button", { name: "Continue without saving" }).click();
  await awaitEditorReady(page);
  await expect(page.getByTestId("status")).toContainText(
    `Opened gallery circuit: ${ENTRY.name}`,
  );
  await expect(page.getByTestId("hit-R1")).toHaveCount(0);
});
