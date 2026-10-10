// The Gallery wall: landing, masonry, paging and scrolling, links to an entry,
// the circuit count and contributors, tile marks and opening a tile.

import { expect, test } from "@playwright/test";
import type { Locator, Route } from "@playwright/test";
import { serializeProject } from "@icm/project-protocol";
import { awaitEditorReady, openProjectInfo } from "./editor-fixtures.js";
import {
  ENTRY,
  galleryListUrl,
  galleryResistorProject,
  mockGallery,
} from "./gallery-fixtures.js";

test("the site lands on the full-screen gallery feed", async ({ page }) => {
  await mockGallery(page, [ENTRY]);
  await page.goto("/");
  const feed = page.getByTestId("gallery-feed");
  await expect(feed).toBeVisible();
  await expect(page.getByTestId("gallery-footnote")).toHaveText(
    "Open any circuit to edit your own copy; publish your own from the editor.",
  );
  const brand = page.getByTestId("gallery-editor-link");
  await expect(brand).toHaveCSS("display", "flex");
  await expect(brand).toHaveCSS("text-decoration-line", "none");
  const brandMark = brand.locator(".app-brand-mark");
  await expect(brandMark).toBeVisible();
  await expect(brandMark).toHaveCSS("background-image", /icon\.svg\?v=nmos-4/);
  const editorSwitch = page.getByTestId("gallery-editor-switch");
  await expect(editorSwitch).toHaveText("Editor");
  await expect(editorSwitch).toHaveAttribute("href", "/editor");
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute(
    "href",
    "/icon.svg?v=nmos-4",
  );

  // With community entries present the wall shows them alone: the bundled
  // starter tiles exist only while the gallery is empty.
  await expect(page.getByTestId(`gallery-tile-${ENTRY.id}`)).toBeVisible();
  await expect(
    page.getByTestId(`gallery-tile-${ENTRY.id}`).locator("img"),
  ).toHaveAttribute(
    "src",
    `/api/gallery/${ENTRY.id}/preview.svg?v=revision-0&render=formula-label-v5`,
  );
  await expect(
    page.getByTestId(`gallery-tile-${ENTRY.id}`).locator("img"),
  ).toHaveAttribute("width", "640");
  await expect(
    page.getByTestId(`gallery-tile-${ENTRY.id}`).locator("img"),
  ).toHaveAttribute("height", "360");
  await expect(
    page.getByTestId("gallery-bundled-common-source-amplifier"),
  ).toHaveCount(0);
  await expect(page.getByTestId("gallery-new-circuit")).toHaveCount(0);
  const repositoryLink = page.getByTestId("gallery-repository-link");
  await expect(repositoryLink).toHaveAttribute(
    "href",
    "https://github.com/cascode-ai/analog-canvas",
  );
  await expect(repositoryLink).toHaveAttribute("target", "_blank");
  await expect(repositoryLink.locator("svg")).toBeVisible();
  // GitHub ends the row: the Editor switch at the left is the way in.
  expect(
    await repositoryLink.evaluate((link) => link.nextElementSibling),
  ).toBeNull();
});

test("an open Gallery switches to a newly published preview revision", async ({
  page,
}) => {
  let previewRevision = "revision-0";
  let listRequests = 0;
  await page.route(galleryListUrl, (route) => {
    listRequests += 1;
    return route.fulfill({
      json: {
        entries: [{ ...ENTRY, previewRevision }],
        nextCursor: null,
      },
    });
  });
  await page.route(`**/api/gallery/${ENTRY.id}/preview.svg*`, (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"/>',
    }),
  );

  await page.goto("/");
  const image = page.getByTestId(`gallery-tile-${ENTRY.id}`).locator("img");
  await expect(image).toHaveAttribute(
    "src",
    `/api/gallery/${ENTRY.id}/preview.svg?v=revision-0&render=formula-label-v5`,
  );

  previewRevision = "revision-1";
  await page.evaluate(() => {
    const channel = new BroadcastChannel("analog-canvas-gallery-change-v1");
    channel.postMessage({
      type: "gallery-changed",
      sourceId: "editor-tab",
      entryId: "g-ring",
      previewRevision: "revision-1",
    });
    channel.close();
  });

  await expect(image).toHaveAttribute(
    "src",
    `/api/gallery/${ENTRY.id}/preview.svg?v=revision-1&render=formula-label-v5`,
  );
  expect(listRequests).toBeGreaterThanOrEqual(2);
});

test("masonry places the top row left-to-right in distinct columns", async ({
  page,
}) => {
  const entries = ["m-a", "m-b", "m-c"].map((id, index) => ({
    id,
    name: `Circuit ${id}`,
    author: "tz",
    description: index === 0 ? "taller card" : "",
    createdAt: "2026-08-22T10:00:00.000Z",
    schemaVersion: 23,
  }));
  await page.route(galleryListUrl, (route) =>
    route.fulfill({ json: { entries, nextCursor: null } }),
  );
  await page.route("**/api/gallery/*/preview.svg", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 6"><rect width="10" height="6" fill="#fff"/></svg>',
    }),
  );

  await page.goto("/");
  await expect(page.getByTestId("gallery-tile-m-c")).toBeVisible();
  const positions = await page.locator(".masonry-item").evaluateAll((items) =>
    items.map((item) => {
      const match = /translate\(([-\d.]+)px, ([-\d.]+)px\)/u.exec(
        (item as HTMLElement).style.transform,
      );
      return { x: Number(match?.[1]), y: Number(match?.[2]) };
    }),
  );
  expect(positions).toHaveLength(3);
  // All three fit the top row: same y, strictly increasing x (reading
  // order), and the container has a measured height.
  expect(positions.every((position) => position.y === 0)).toBe(true);
  expect(positions[1]!.x).toBeGreaterThan(positions[0]!.x);
  expect(positions[2]!.x).toBeGreaterThan(positions[1]!.x);
  const wallHeight = await page
    .locator(".masonry")
    .evaluate((wall) => Number.parseFloat((wall as HTMLElement).style.height));
  expect(wallHeight).toBeGreaterThan(100);
});

test("the feed pages through the cursor as the sentinel comes into view", async ({
  page,
}) => {
  const listRequests: string[] = [];
  await page.route("**/api/gallery**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/gallery") return route.fallback();
    listRequests.push(url.search);
    const second = url.searchParams.get("cursor") === "c1";
    const ids = second ? ["p2-a", "p2-b"] : ["p1-a", "p1-b", "p1-c"];
    return route.fulfill({
      json: {
        entries: ids.map((id) => ({
          id,
          name: `Circuit ${id}`,
          author: "tz",
          description: "",
          createdAt: "2026-08-22T10:00:00.000Z",
          schemaVersion: 23,
        })),
        nextCursor: second ? null : "c1",
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
  await expect(page.getByTestId("gallery-tile-p1-a")).toBeVisible();
  // The short first page leaves the sentinel visible, so page two loads
  // without any user scrolling and the cursor chain ends. (StrictMode
  // double-mounts the initial effect in dev, so the plain request may
  // fire twice; the cursor page must load exactly once.)
  await expect(page.getByTestId("gallery-tile-p2-b")).toBeVisible();
  const cursors = listRequests.map((query) =>
    new URLSearchParams(query).get("cursor"),
  );
  expect(cursors.filter((cursor) => cursor === "c1")).toHaveLength(1);
  expect(cursors.every((cursor) => cursor === null || cursor === "c1")).toBe(
    true,
  );
  // Every page reads the same shuffle (#1615), so none repeats or skips.
  const seeds = new Set(
    listRequests.map((query) => new URLSearchParams(query).get("seed")),
  );
  expect([...seeds]).toEqual([expect.stringMatching(/^[a-z0-9]{1,16}$/u)]);
});

test("the feed scrolls inside its shell despite the locked app root", async ({
  page,
}) => {
  await page.setViewportSize({ width: 520, height: 420 });
  const entries = Array.from({ length: 8 }, (_, index) => ({
    id: `s-${index}`,
    name: `Circuit ${index}`,
    author: "tz",
    description: "",
    createdAt: "2026-08-22T10:00:00.000Z",
    schemaVersion: 23,
  }));
  await page.route(galleryListUrl, (route) =>
    route.fulfill({ json: { entries, nextCursor: null } }),
  );
  await page.route("**/api/gallery/*/preview.svg", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 8"><rect width="10" height="8" fill="#fff"/></svg>',
    }),
  );

  await page.goto("/");
  await expect(page.getByTestId("gallery-tile-s-0")).toBeVisible();

  // Narrowing the window only narrows: in a window this short the header,
  // the tab row and the search keep their heights and places, each tab its
  // one line, and the white search panel still meets the open tab.
  const rows = () =>
    page.evaluate(() =>
      [
        ".gallery-chrome",
        ".gallery-view-tabs",
        ".gallery-view-tab",
        ".gallery-search-input",
        ".gallery-sidebar-slot",
      ].map((selector) => {
        const box = document.querySelector(selector)!.getBoundingClientRect();
        return selector === ".gallery-sidebar-slot"
          ? [Math.round(box.top)]
          : [Math.round(box.top), Math.round(box.height)];
      }),
    );
  await page.setViewportSize({ width: 1200, height: 420 });
  const wide = await rows();
  for (const width of [700, 621, 620, 480, 360, 320]) {
    await page.setViewportSize({ width, height: 420 });
    expect(await rows(), `at ${width}px`).toEqual(wide);
  }
  await page.setViewportSize({ width: 520, height: 420 });

  const scrolled = await page.locator(".gallery-shell").evaluate((shell) => {
    shell.scrollTop = 9999;
    return {
      overflowY: getComputedStyle(shell).overflowY,
      scrollable: shell.scrollHeight > shell.clientHeight,
      scrollTop: shell.scrollTop,
    };
  });
  expect(scrolled.overflowY).toBe("auto");
  expect(scrolled.scrollable).toBe(true);
  expect(scrolled.scrollTop).toBeGreaterThan(0);
});

test("a View in Gallery link shows its circuit at once, centres it and rings it", async ({
  page,
}) => {
  // An updated circuit sits deep in a wall taller than the window, here on
  // page two. The wall looks it up by its id and shows it first, without
  // paging down to it: page two never answers. The tile must stay in view
  // after masonry has settled.
  await page.setViewportSize({ width: 520, height: 420 });
  const entry = (id: string) => ({
    id,
    name: `Circuit ${id}`,
    author: "tz",
    description: "",
    createdAt: "2026-08-22T10:00:00.000Z",
    schemaVersion: 23,
  });
  const first = Array.from({ length: 10 }, (_, index) => `a-${index}`);
  await page.route(galleryListUrl, (route) => {
    // Page two is never delivered: finding the circuit must not need it.
    if (new URL(route.request().url()).searchParams.get("cursor")) return;
    return route.fulfill({
      json: { entries: first.map(entry), nextCursor: "c1" },
    });
  });
  await page.route("**/api/gallery/*/preview.svg", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 8"><rect width="10" height="8" fill="#fff"/></svg>',
    }),
  );
  // A link asks for the tile alone (`?summary=1`), which costs no daily open.
  for (const id of ["b-7", "a-3"])
    await page.route(
      (url) => url.pathname === `/api/gallery/${id}`,
      (route) =>
        route.fulfill({ json: { entry: entry(id), status: "public" } }),
    );
  await page.route(
    (url) => url.pathname === "/api/gallery/gone",
    (route) => route.fulfill({ status: 404, json: { error: "not-found" } }),
  );

  await page.goto("/?entry=b-7");
  const tile = page.getByTestId("gallery-tile-b-7");
  await expect(tile).toBeInViewport();
  await expect(tile.locator("xpath=..")).toHaveClass(/is-linked/u);
  await expect(
    page.locator('[data-testid^="gallery-tile-"]').first(),
  ).toHaveAttribute("data-testid", "gallery-tile-b-7");
  // The link has done its work; a refresh does not seek again.
  await expect(page).toHaveURL(/\/$/u);
  await page.waitForTimeout(800);
  await expect(tile).toBeInViewport();

  // A circuit the first page holds is ringed where it stands.
  await page.goto("/?entry=a-3");
  await expect(
    page.getByTestId("gallery-tile-a-3").locator("xpath=.."),
  ).toHaveClass(/is-linked/u);
  await expect(
    page.locator('[data-testid^="gallery-tile-"]').first(),
  ).toHaveAttribute("data-testid", "gallery-tile-a-0");

  await page.goto("/?entry=gone");
  await expect(page.getByTestId("gallery-focus-missing")).toBeVisible();
});

test("a tab returning to a Gallery link shows the current entry unless its copy was changed", async ({
  page,
}) => {
  // Seven full page loads, the editor five times: slow by design.
  test.slow();
  const id = "g-return";
  const name = "Return Visit";
  let stored = galleryResistorProject("1k", 1);
  let reads = 0;
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "u1",
          displayName: "Reader",
          email: "reader@example.com",
          provider: "github",
          role: "user",
          isAdmin: false,
        },
      },
    }),
  );
  await page.route(`**/api/gallery/${id}`, (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    reads += 1;
    return route.fulfill({
      json: {
        entry: { id, name, author: "tz", description: "", tags: [] },
        projectText: serializeProject(stored),
      },
    });
  });
  await page.route("**/api/gallery/g-next", (route) =>
    route.fulfill({
      json: {
        entry: {
          id: "g-next",
          name: "Next Visit",
          author: "tz",
          description: "",
          tags: [],
        },
        projectText: serializeProject(galleryResistorProject("2k", 2)),
      },
    }),
  );
  page.on("dialog", (dialog) => dialog.accept());
  const count = page.getByTestId("active-instance-count");
  const status = page.getByTestId("status");

  await page.goto(`/g/${id}`);
  await awaitEditorReady(page);
  await expect(status).toContainText(`Opened gallery circuit: ${name}`);
  await expect(count).toHaveText("1");
  // The same browser tab restores its saved copy while the entry stands.
  await page.goto(`/g/${id}`);
  await awaitEditorReady(page);
  await expect(status).toContainText("Switched to");
  await expect(count).toHaveText("1");
  // Once the entry changes, the untouched copy gives way to it.
  stored = galleryResistorProject("1k", 2);
  await page.goto(`/g/${id}`);
  await awaitEditorReady(page);
  await expect(status).toContainText(
    `Opened the current Gallery version of ${name}`,
  );
  await expect(count).toHaveText("2");
  // A copy the reader has changed stays theirs.
  await page.getByTestId("hit-R1").click();
  await page.keyboard.press("Delete");
  await expect(count).toHaveText("1");
  stored = galleryResistorProject("1k", 3);
  const readsBefore = reads;
  await page.goto(`/g/${id}`);
  await awaitEditorReady(page);
  await expect(status).toContainText("Switched to");
  await page.waitForLoadState("networkidle");
  expect(reads).toBe(readsBefore);
  await expect(count).toHaveText("1");
  // The linked Gallery tab may be inactive when the reader visits the wall.
  // The URL must select that tab, not leave the unrelated active draft on top.
  await page
    .getByRole("button", { name: "New project tab", exact: true })
    .click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expect(count).toHaveText("0");
  await page.goto("/");
  await page.goto(`/g/${id}`);
  await awaitEditorReady(page);
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expect(page.getByRole("tab", { name: /Resistors$/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(count).toHaveText("1");
  expect(reads).toBe(readsBefore);
  await page.goto("/");
  await page.goto("/g/g-next");
  await awaitEditorReady(page);
  await expect(page.getByRole("tab")).toHaveCount(3);
  await expect(count).toHaveText("2");
  await expect(page.getByTestId("status")).toContainText(
    "Opened gallery circuit: Next Visit",
  );
});

test("the wall states how many circuits the gallery holds", async ({
  page,
}) => {
  await page.route(galleryListUrl, (route) =>
    route.fulfill({ json: { entries: [ENTRY], nextCursor: null, total: 128 } }),
  );
  await page.route(`**/api/gallery/${ENTRY.id}/preview.svg*`, (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#fff"/></svg>',
    }),
  );
  await page.route("**/api/gallery/tags", (route) =>
    route.fulfill({ json: { tags: [] } }),
  );
  await page.route("**/api/projects", (route) =>
    route.fulfill({ status: 401, json: { error: "authentication-required" } }),
  );
  await page.goto("/");
  await expect(page.getByTestId("gallery-count-panel")).toHaveText(
    "128 circuits",
  );
  // The shelf states its own count; the community total stays off it.
  await page.getByTestId("gallery-view-shelf").click();
  await expect(page.getByTestId("gallery-count-panel")).toHaveCount(0);
  await expect(page.getByTestId("shelf-signed-out")).toBeVisible();
});

test("the wall count opens a contributor ranking whose names open each gallery", async ({
  page,
}) => {
  const aliceEntries = [
    {
      ...ENTRY,
      id: "alice-2",
      name: "Alice OTA",
      author: "Alice",
      tags: ["amplifier"],
      createdAt: "2026-08-22T10:00:00.000Z",
    },
    {
      ...ENTRY,
      id: "alice-1",
      name: "Alice Bandgap",
      author: "Alice",
      tags: ["amplifier"],
    },
  ];
  const bobEntry = {
    ...ENTRY,
    id: "bob-1",
    name: "Bob Comparator",
    author: "Bob",
    tags: ["amplifier"],
  };
  await page.route(galleryListUrl, (route) => {
    const url = new URL(route.request().url());
    const entries =
      url.searchParams.get("author") === "Alice"
        ? aliceEntries
        : [...aliceEntries, bobEntry];
    return route.fulfill({
      json: { entries, nextCursor: null, total: entries.length },
    });
  });
  const tagQueries: string[] = [];
  await page.route(
    (url) => url.pathname === "/api/gallery/tags",
    (route) => {
      tagQueries.push(new URL(route.request().url()).search);
      return route.fulfill({ json: { tags: [] } });
    },
  );
  await page.route("**/api/gallery/*/preview.svg*", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#fff"/></svg>',
    }),
  );

  await page.goto("/?tags=amplifier&q=amplifier");
  await page.getByTestId("gallery-count-panel").click();
  await expect(page.getByTestId("gallery-contributor-popover")).toContainText(
    "2 authors",
  );
  await expect(page.getByTestId("gallery-contributor-all")).toHaveCount(0);
  await expect(page.getByTestId("gallery-contributor-row-1")).toContainText(
    "Alice",
  );
  await expect(page.getByTestId("gallery-contributor-row-1")).toContainText(
    "2 circuits",
  );
  await expect(page.getByTestId("gallery-contributor-row-2")).toContainText(
    "Bob",
  );

  await expect(
    page.getByTestId("gallery-contributor-row-1").locator("summary"),
  ).toHaveCount(0);
  await expect(page.getByTestId("gallery-contributor-view-1")).toHaveCount(0);
  await page.getByTestId("gallery-contributor-author-1").click();

  await expect(page).toHaveURL(
    (url) =>
      url.searchParams.get("author") === "Alice" &&
      url.searchParams.get("tags") === "amplifier" &&
      url.searchParams.get("q") === "amplifier",
  );
  await expect(page.getByTestId("gallery-filter")).toContainText(
    "Circuits by Alice",
  );
  await expect(page.getByTestId("gallery-tile-alice-2")).toBeVisible();
  await expect(page.getByTestId("gallery-tile-bob-1")).toHaveCount(0);
  // The tags beside the wall are counted for the same contributor.
  await expect.poll(() => tagQueries.at(-1)).toBe("?q=amplifier&author=Alice");
  await page.getByTestId("gallery-count-panel").click();
  await expect(page.getByTestId("gallery-contributor-popover")).toContainText(
    "1 author",
  );
  await expect(page.locator(".gallery-contributor-author")).toHaveText([
    "Alice",
  ]);
  // The way back to everyone is in the same menu, and keeps the rest.
  await page.getByTestId("gallery-contributor-all").click();
  await expect(page.getByTestId("gallery-contributor-popover")).toBeHidden();
  await expect(page).toHaveURL(
    (url) =>
      !url.searchParams.has("author") &&
      url.searchParams.get("tags") === "amplifier" &&
      url.searchParams.get("q") === "amplifier",
  );
  await expect(page.getByTestId("gallery-filter")).toHaveCount(0);
  await expect(page.getByTestId("gallery-tile-bob-1")).toBeVisible();
  await expect.poll(() => tagQueries.at(-1)).toBe("?q=amplifier");
});

test("contributors cover filtered pages while text search follows only matching cards", async ({
  page,
}) => {
  let pending: Route | undefined;
  let globalRequests = 0;
  const authors = [
    { author: "Alice", count: 2 },
    { author: "Bob", count: 1 },
  ];
  await page.route(galleryListUrl, (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.has("cursor")) {
      // Search invalidates the old feed's cursor request. Wait for the new
      // query's page, not the earlier sentinel request that can race the debounce.
      if (url.searchParams.get("q") === "Bob") pending = route;
      return;
    }
    return route.fulfill({
      json: {
        entries: [{ ...ENTRY, id: "alice-1", author: "Alice" }],
        total: 3,
        nextCursor: "next",
        authors,
      },
    });
  });
  await page.route("**/api/gallery/authors", (route) => {
    globalRequests++;
    return route.fulfill({
      json: { authors: [{ author: "Unrelated", count: 97 }] },
    });
  });
  await page.route("**/api/gallery/tags*", (route) =>
    route.fulfill({ json: { tags: [] } }),
  );
  await page.route("**/api/gallery/*/preview.svg*", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"/>',
    }),
  );
  await page.goto("/?netlist=1");
  await page.getByTestId("gallery-count-panel").click();
  const popover = page.getByTestId("gallery-contributor-popover");
  await expect(popover.locator(".gallery-contributor-author")).toHaveText([
    "Alice",
    "Bob",
  ]);
  await expect(popover.locator(".gallery-contributor-count")).toHaveText([
    "2 circuits",
    "1 circuit",
  ]);
  await page.getByTestId("gallery-search").fill("Bob");
  await expect(popover).toContainText("0 authors so far");
  await expect(popover.locator(".gallery-contributor-row")).toHaveCount(0);
  await expect.poll(() => Boolean(pending)).toBe(true);
  await pending!.fulfill({
    json: {
      entries: [
        { ...ENTRY, id: "bob-1", author: "Bob" },
        { ...ENTRY, id: "alice-2", author: "Alice" },
      ],
      total: 3,
      nextCursor: null,
      authors,
    },
  });
  await expect(popover.locator(".gallery-contributor-author")).toHaveText([
    "Bob",
  ]);
  await expect(popover.locator(".gallery-contributor-count")).toHaveText([
    "1 circuit",
  ]);
  await expect(popover).not.toContainText("so far");
  expect(globalRequests).toBe(0);
});

test("falls back to bundled tiles when the gallery is empty or unreachable", async ({
  page,
}) => {
  await page.route(galleryListUrl, (route) =>
    route.fulfill({ status: 502, json: { error: "unavailable" } }),
  );
  await page.goto("/");
  await expect(
    page.getByTestId("gallery-bundled-two-stage-op-amp"),
  ).toBeVisible();
});

test("a gallery tile opens its circuit in the editor", async ({ page }) => {
  await mockGallery(page, [ENTRY]);
  await page.goto("/");
  await page.getByTestId(`gallery-tile-${ENTRY.id}`).click();
  await expect(page).toHaveURL(/\/g\/g-ring$/);
  // The editor arrives behind a lazy chunk. Wait for the canvas before
  // reading the status line: an expect() poll gives up sooner than a cold,
  // busy runner needs to load it, which is a failure with no defect in it.
  await awaitEditorReady(page);
  await expect(page.getByTestId("status")).toContainText(
    `Opened gallery circuit: ${ENTRY.name}`,
  );
  // Variable-length names and contributor notes are read in File →
  // Project Info.
  const galleryInformation = await openProjectInfo(page);
  await expect(
    galleryInformation.getByRole("textbox", { name: "Name", exact: true }),
  ).toHaveValue(ENTRY.name);
  await expect(galleryInformation).toContainText("Contributor");
  await expect(galleryInformation).toContainText(ENTRY.author);
  await expect(galleryInformation).toContainText("Notes");
  await expect(galleryInformation).toContainText(ENTRY.description);
  await page.keyboard.press("Escape");
  await expect(galleryInformation).toBeHidden();

  // The brand mark is the single way back; a second toolbar link said the
  // same thing twice.
  await expect(page.getByTestId("toolbar-gallery-link")).toHaveCount(0);
  await expect(page.locator(".gallery-home-link h1")).toHaveText(
    "Analog Canvas",
  );
  const brandLink = page.locator(".gallery-home-link");
  await expect(brandLink).toHaveAttribute("href", "/");
  await brandLink.click();
  await expect(page.getByTestId("gallery-feed")).toBeVisible();
});

test("keeps newest-first order and stops after the last circuit", async ({
  page,
}) => {
  // The reader chose Newest first (#1615); the default is a shuffle.
  await page.addInitScript(() =>
    localStorage.setItem("icm.gallery.order", "newest"),
  );
  const wall = Array.from({ length: 10 }, (_, index) => ({
    ...ENTRY,
    id: `g-${index}`,
    name: `Circuit ${index}`,
    createdAt: new Date(Date.UTC(2026, 7, 21, 10, 0, 10 - index)).toISOString(),
  }));
  const listRequests: string[] = [];
  await page.route("**/api/gallery**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/gallery") return route.fallback();
    listRequests.push(url.search);
    const offset = Number(url.searchParams.get("cursor") ?? "0");
    const slice = wall.slice(offset, offset + 3);
    return route.fulfill({
      json: {
        entries: slice,
        nextCursor:
          offset + slice.length < wall.length
            ? String(offset + slice.length)
            : null,
      },
    });
  });
  await page.route("**/preview.svg", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>',
    }),
  );

  await page.goto("/");
  const tiles = page.locator('[data-testid^="gallery-tile-"]');
  await expect(tiles.first()).toBeVisible();

  // The wall fills through its cursor chain, then remains at exactly one copy
  // of each circuit no matter how often the exhausted sentinel is exposed.
  for (let scroll = 0; scroll < 6; scroll += 1) {
    await page.mouse.wheel(0, 4000);
    await page.waitForTimeout(250);
  }
  await expect(tiles).toHaveCount(wall.length);
  expect(
    await tiles.evaluateAll((items) =>
      items.map((item) => item.getAttribute("data-testid")),
    ),
  ).toEqual(wall.map((entry) => `gallery-tile-${entry.id}`));
  expect(
    listRequests.every(
      (query) => new URLSearchParams(query).get("seed") === null,
    ),
  ).toBe(true);
});

test("marks the circuits that extract or an AI made, and counts thumbs on every card", async ({
  page,
}) => {
  const extractable = {
    ...ENTRY,
    netlistable: true,
    aiGenerated: true,
    likes: 2,
    likedByViewer: false,
  };
  const sketch = {
    ...ENTRY,
    id: "g-sketch",
    name: "Ideal Sketch",
    netlistable: false,
    likes: 0,
    likedByViewer: false,
  };
  await page.route(galleryListUrl, (route) =>
    route.fulfill({
      json: { entries: [extractable, sketch], nextCursor: null },
    }),
  );
  await page.route("**/api/gallery/*/preview.svg", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>',
    }),
  );
  let toggles = 0;
  await page.route("**/api/gallery/*/like", (route) => {
    toggles += 1;
    return route.fulfill({ json: { likes: 3, likedByViewer: true } });
  });

  await page.goto("/");
  // The marks are spelled out after the name: "Netlist" for the one that
  // extracts, then "AI" where its publisher says an AI made it. The other is
  // on the wall all the same — a schematic is allowed to be abbreviated.
  const marks = page
    .getByTestId(`gallery-tile-${extractable.id}`)
    .locator(".gallery-tile-mark");
  await expect(marks).toHaveText(["Netlist", "AI"]);
  await expect(
    page.getByTestId(`gallery-netlist-${extractable.id}`),
  ).toBeVisible();
  await expect(page.getByTestId(`gallery-ai-${extractable.id}`)).toBeVisible();
  await expect(
    page.getByTestId(`gallery-tile-${sketch.id}`).locator(".gallery-tile-mark"),
  ).toHaveCount(0);
  await expect(page.getByTestId(`gallery-tile-${sketch.id}`)).toBeVisible();

  const thumb = page.getByTestId(`gallery-like-${extractable.id}`);
  // The mark is drawn, not typed: an emoji is a different picture on every
  // platform and brings its own colour onto a wall of circuit drawings.
  await expect(thumb.locator("svg")).toHaveCount(1);
  await expect(thumb).not.toContainText("👍");
  await expect(thumb).toContainText("2");
  await expect(thumb).toHaveAttribute("aria-pressed", "false");

  // Pressing the thumb applies what the server returned, and does not follow
  // the card's link on the way.
  await thumb.click();
  await expect(thumb).toContainText("3");
  await expect(thumb).toHaveAttribute("aria-pressed", "true");
  expect(toggles).toBe(1);
  expect(new URL(page.url()).pathname).toBe("/");
});

// Also the browser check that a starter tile opens its example in the editor.
test("bundled VDD rails keep their current presentation in the Gallery and editor", async ({
  page,
}) => {
  await mockGallery(page, []);
  await page.goto("/");
  const tile = page.getByTestId(
    "gallery-bundled-current-mirror-loaded-differential-pair",
  );
  const tileRails = tile.locator('[data-route-presentation="power-rail"]');
  await expect(tileRails).toHaveCount(3);
  // A conductor run is one shape, so a rail's width is on the shape carrying
  // its subpath rather than on the element that carries its identity.
  const railInkWidths = (root: Locator) =>
    root.evaluate((element: SVGElement | HTMLElement) => {
      const inks = [...element.querySelectorAll('[data-role="conductor-ink"]')];
      return [
        ...element.querySelectorAll('[data-route-presentation="power-rail"]'),
      ].map((rail) => {
        const subpath = `M ${Array.from((rail as SVGPolylineElement).points)
          .map((point) => `${point.x} ${point.y}`)
          .join(" L ")}`;
        return (
          inks
            .find((path) => (path.getAttribute("d") ?? "").includes(subpath))
            ?.getAttribute("stroke-width") ?? null
        );
      });
    });
  expect(await railInkWidths(tile)).toEqual(["3.24", "3.24", "3.24"]);
  await expect(
    tile.locator(
      '[data-layer="junctions"] circle[cx="380"][cy="160"], [data-layer="junctions"] circle[cx="500"][cy="160"]',
    ),
  ).toHaveCount(0);

  await tile.click();
  await expect(page).toHaveURL(
    /\/editor\?example=current-mirror-loaded-differential-pair$/,
  );
  await awaitEditorReady(page);
  const canvasRails = page.locator(
    '[data-testid="schematic-canvas"] [data-route-presentation="power-rail"]',
  );
  await expect(canvasRails).toHaveCount(3);
  expect(
    await railInkWidths(page.locator('[data-testid="schematic-canvas"]')),
  ).toEqual(["3.24", "3.24", "3.24"]);
  await expect(
    page.locator(
      '[data-testid="schematic-canvas"] [data-layer="junctions"] circle[cx="380"][cy="160"], [data-testid="schematic-canvas"] [data-layer="junctions"] circle[cx="500"][cy="160"]',
    ),
  ).toHaveCount(0);
});
