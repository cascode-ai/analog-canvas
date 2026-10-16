// Browsing the Gallery: the wall's landing, masonry, paging and links, its
// count, contributors and tile marks; quick filters, search and tags; and the
// editor's Gallery panel. The server filters and searches: those requests are
// module contracts (gallery-client, gallery-filters, gallery-feed and
// examples-panel tests), so the mocks here answer without filtering.

import { expect, test } from "./gallery-test.js";
import { test as localTest } from "@playwright/test";
import type { Locator, Page, Route } from "@playwright/test";
import { serializeProject } from "@icm/project-protocol";
import {
  awaitEditorReady,
  expectStatus,
  openProjectInfo,
  placeResistors,
  openEditor,
  exampleProject,
  awaitTwoFrames,
} from "./editor-fixtures.js";
import {
  ENTRY,
  galleryListUrl,
  galleryResistorProject,
  mockGallery,
  mockGalleryApi,
  mockPreviews,
  sessionUser,
  signIn,
} from "./gallery-fixtures.js";

/** A plain wall tile with nothing but its id and name. */
const tile = (id: string, extra: object = {}) => ({
  id,
  name: `Circuit ${id}`,
  author: "tz",
  description: "",
  createdAt: "2026-08-22T10:00:00.000Z",
  schemaVersion: 23,
  ...extra,
});

/** Answer each list request with what `answer` makes of its address
 * (nothing leaves it open), and every preview with a blank drawing. */
async function serveWall(
  page: Page,
  answer: (url: URL) => object | undefined,
): Promise<void> {
  await page.route(galleryListUrl, (route) => {
    const json = answer(new URL(route.request().url()));
    if (json) return route.fulfill({ json });
  });
  await mockPreviews(page);
}

/** The address of ENTRY's wall preview at this revision. */
const previewSrc = (revision: string) =>
  `/api/gallery/${ENTRY.id}/preview.svg?v=${revision}&render=formula-label-v5`;

test("Shelf defers Gallery reads until its tab is opened", async ({ page }) => {
  const reads: string[] = [];
  await signIn(page, sessionUser());
  await page.route("**/api/projects*", (route) =>
    route.fulfill({ json: { projects: [] } }),
  );
  await page.route("**/api/gallery**", (route) => {
    const url = new URL(route.request().url());
    reads.push(url.pathname);
    return route.fulfill({
      json: url.pathname.endsWith("/sources")
        ? { sources: [] }
        : url.pathname.endsWith("/tags")
          ? { tags: [], groups: [] }
          : { entries: [ENTRY], nextCursor: null, total: 1 },
    });
  });
  await page.goto("/?view=shelf");
  await expect(page.getByTestId("gallery-view-shelf")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByTestId("gallery-view-gallery")).toBeVisible();
  await awaitTwoFrames(page);
  expect(reads).toEqual([]);
  await page.getByTestId("gallery-view-gallery").click();
  await expect(page.getByTestId(`gallery-tile-${ENTRY.id}`)).toBeVisible();
  expect(reads.filter((path) => path === "/api/gallery")).toHaveLength(1);
});

test("leaving Gallery before its landing feed answers does not warm hidden previews", async ({
  page,
}) => {
  await signIn(page, sessionUser());
  await page.route("**/api/projects*", (route) =>
    route.fulfill({ json: { projects: [] } }),
  );
  await page.route("**/api/gallery/tags*", (route) =>
    route.fulfill({ json: { tags: [] } }),
  );
  let answer!: () => Promise<void>;
  await page.route(galleryListUrl, (route) => {
    answer = () =>
      route.fulfill({ json: { entries: [ENTRY], nextCursor: null, total: 1 } });
  });
  const previews: string[] = [];
  await page.route("**/api/gallery/*/preview.svg*", (route) => {
    previews.push(route.request().url());
    return route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg"/>',
    });
  });
  await page.goto("/");
  await expect.poll(() => typeof answer).toBe("function");
  await page.getByTestId("gallery-view-shelf").click();
  await expect(page).toHaveURL(/view=shelf/);
  const response = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/gallery",
  );
  await answer();
  await (await response).finished();
  await awaitTwoFrames(page);
  expect(previews).toEqual([]);
});

test("the site lands on the full-screen gallery feed and states its size", async ({
  page,
}) => {
  await serveWall(page, () => ({
    entries: [ENTRY],
    nextCursor: null,
    total: 128,
  }));
  await page.route("**/api/gallery/tags", (route) =>
    route.fulfill({ json: { tags: [] } }),
  );
  await page.route("**/api/projects", (route) =>
    route.fulfill({ status: 401, json: { error: "authentication-required" } }),
  );
  await page.goto("/");
  await expect(page.getByTestId("gallery-feed")).toBeVisible();
  await expect(page.getByTestId("gallery-footnote")).toHaveText(
    "Open any circuit to edit your own copy; publish your own from the editor.",
  );
  const brand = page.getByTestId("gallery-editor-link");
  await expect(brand).toHaveCSS("display", "flex");
  await expect(brand).toHaveCSS("text-decoration-line", "none");
  const brandMark = brand.locator(".app-brand-mark");
  await expect(brandMark).toBeVisible();
  await expect(brandMark).toHaveCSS("background-image", /icon\.svg\?v=nmos-4/);
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute(
    "href",
    "/icon.svg?v=nmos-4",
  );

  // With community entries present the wall shows them alone: the bundled
  // starter tiles exist only while the gallery is empty.
  const image = page.getByTestId(`gallery-tile-${ENTRY.id}`).locator("img");
  await expect(image).toHaveAttribute("src", previewSrc("revision-0"));
  await expect(image).toHaveAttribute("width", "640");
  await expect(image).toHaveAttribute("height", "360");
  await expect(
    page.getByTestId("gallery-bundled-common-source-amplifier"),
  ).toHaveCount(0);
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

  await expect(page.getByTestId("gallery-count-panel")).toHaveText(
    "128 circuits",
  );
  // The shelf states its own count; the community total stays off it.
  await page.getByTestId("gallery-view-shelf").click();
  await expect(page.getByTestId("gallery-count-panel")).toHaveCount(0);
  await expect(page.getByTestId("shelf-signed-out")).toBeVisible();
});

test("an open Gallery switches to a newly published preview revision", async ({
  page,
}) => {
  let previewRevision = "revision-0";
  let listRequests = 0;
  await serveWall(page, () => {
    listRequests += 1;
    return { entries: [{ ...ENTRY, previewRevision }], nextCursor: null };
  });

  await page.goto("/");
  const image = page.getByTestId(`gallery-tile-${ENTRY.id}`).locator("img");
  await expect(image).toHaveAttribute("src", previewSrc("revision-0"));

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

  await expect(image).toHaveAttribute("src", previewSrc("revision-1"));
  expect(listRequests).toBeGreaterThanOrEqual(2);
});

test("masonry places the top row left-to-right in distinct columns", async ({
  page,
}) => {
  const entries = ["m-a", "m-b", "m-c"].map((id, index) =>
    tile(id, { description: index === 0 ? "taller card" : "" }),
  );
  await serveWall(page, () => ({ entries, nextCursor: null }));

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
  await serveWall(page, (url) => {
    listRequests.push(url.search);
    const second = url.searchParams.get("cursor") === "c1";
    const ids = second ? ["p2-a", "p2-b"] : ["p1-a", "p1-b", "p1-c"];
    return {
      entries: ids.map((id) => tile(id)),
      nextCursor: second ? null : "c1",
    };
  });

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
  const entries = Array.from({ length: 8 }, (_, index) => tile(`s-${index}`));
  await serveWall(page, () => ({ entries, nextCursor: null }));

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
  const first = Array.from({ length: 10 }, (_, index) => `a-${index}`);
  await serveWall(page, (url) => {
    // Page two is never delivered: finding the circuit must not need it.
    if (url.searchParams.get("cursor")) return;
    return { entries: first.map((id) => tile(id)), nextCursor: "c1" };
  });
  // A link asks for the tile alone (`?summary=1`), which costs no daily open.
  for (const id of ["b-7", "a-3"])
    await page.route(
      (url) => url.pathname === `/api/gallery/${id}`,
      (route) => route.fulfill({ json: { entry: tile(id), status: "public" } }),
    );
  await page.route(
    (url) => url.pathname === "/api/gallery/gone",
    (route) => route.fulfill({ status: 404, json: { error: "not-found" } }),
  );

  await page.goto("/?entry=b-7");
  const linked = page.getByTestId("gallery-tile-b-7");
  await expect(linked).toBeInViewport();
  await expect(linked.locator("xpath=..")).toHaveClass(/is-linked/u);
  await expect(
    page.locator('[data-testid^="gallery-tile-"]').first(),
  ).toHaveAttribute("data-testid", "gallery-tile-b-7");
  // The link has done its work; a refresh does not seek again.
  await expect(page).toHaveURL(/\/$/u);
  await page.waitForTimeout(800);
  await expect(linked).toBeInViewport();

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

test("a Gallery link opened again selects its own tab and keeps a changed copy", async ({
  page,
}) => {
  // The decisions themselves (current version, untouched copy) are the
  // gallery-example-commands "a browser tab returning to a Gallery link"
  // tests; this proves the address picks the right tab.
  const id = "g-return";
  let stored = galleryResistorProject("1k", 2);
  let reads = 0;
  await signIn(page, sessionUser({ displayName: "Reader" }));
  await page.route(`**/api/gallery/${id}`, (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    reads += 1;
    return route.fulfill({
      json: {
        entry: { id, name: "Return Visit", author: "tz", tags: [] },
        projectText: serializeProject(stored),
      },
    });
  });
  page.on("dialog", (dialog) => dialog.accept());
  const count = page.getByTestId("active-instance-count");

  await openEditor(page, `/g/${id}`);
  await expectStatus(page, "Opened gallery circuit: Return Visit");
  await expect(count).toHaveText("2");
  // A copy the reader has changed stays theirs when the entry changes too.
  await page.getByTestId("hit-R1").click();
  await page.keyboard.press("Delete");
  await expect(count).toHaveText("1");
  stored = galleryResistorProject("1k", 3);
  const readsBefore = reads;
  // The linked tab may be inactive when the reader visits the wall. The URL
  // must select that tab, not leave the unrelated active draft on top.
  await page
    .getByRole("button", { name: "New project tab", exact: true })
    .click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expect(count).toHaveText("0");
  await page.goto("/");
  await openEditor(page, `/g/${id}`);
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expect(page.getByRole("tab", { name: /Resistors$/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(count).toHaveText("1");
  await page.waitForLoadState("networkidle");
  expect(reads).toBe(readsBefore);
});

test("the wall count ranks contributors over every page, opens each author's wall and follows a search", async ({
  page,
}) => {
  const alice = [
    { ...ENTRY, id: "alice-2", name: "Alice OTA", author: "Alice" },
    { ...ENTRY, id: "alice-1", name: "Alice Bandgap", author: "Alice" },
  ];
  // The server counts contributors over the whole filtered wall, of which
  // only the first card has loaded; older pages answer when the test says.
  let pending: Route | undefined;
  await page.route(galleryListUrl, (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.has("cursor")) {
      // Search invalidates the old feed's cursor request. Wait for the new
      // query's page, not the earlier sentinel request that can race the debounce.
      if (url.searchParams.get("q") === "Bob") pending = route;
      return;
    }
    const byAlice = url.searchParams.get("author") === "Alice";
    return route.fulfill({
      json: byAlice
        ? { entries: alice, total: 2, nextCursor: null }
        : {
            entries: [alice[0]],
            total: 3,
            nextCursor: "next",
            authors: [
              { author: "Alice", count: 2 },
              { author: "Bob", count: 1 },
            ],
          },
    });
  });
  let globalRequests = 0;
  await page.route("**/api/gallery/authors", (route) => {
    globalRequests++;
    return route.fulfill({ json: { authors: [] } });
  });
  const tagQueries: string[] = [];
  await page.route(
    (url) => url.pathname === "/api/gallery/tags",
    (route) => {
      tagQueries.push(new URL(route.request().url()).search);
      return route.fulfill({ json: { tags: [] } });
    },
  );
  await mockPreviews(page);

  await page.goto("/?tags=amplifier");
  const popover = page.getByTestId("gallery-contributor-popover");
  const names = popover.locator(".gallery-contributor-author");
  await page.getByTestId("gallery-count-panel").click();
  await expect(popover).toContainText("2 authors");
  await expect(page.getByTestId("gallery-contributor-all")).toHaveCount(0);
  await expect(names).toHaveText(["Alice", "Bob"]);
  await expect(popover.locator(".gallery-contributor-count")).toHaveText([
    "2 circuits",
    "1 circuit",
  ]);
  await expect(
    page.getByTestId("gallery-contributor-row-1").locator("summary"),
  ).toHaveCount(0);
  await expect(page.getByTestId("gallery-contributor-view-1")).toHaveCount(0);

  // A name opens that author's wall and keeps the rest of the narrowing.
  await page.getByTestId("gallery-contributor-author-1").click();
  await expect(page).toHaveURL(
    (url) =>
      url.searchParams.get("author") === "Alice" &&
      url.searchParams.get("tags") === "amplifier",
  );
  await expect(page.getByTestId("gallery-filter")).toContainText(
    "Circuits by Alice",
  );
  await expect(page.getByTestId("gallery-tile-alice-1")).toBeVisible();
  // The tags beside the wall are counted for the same contributor.
  await expect.poll(() => tagQueries.at(-1)).toBe("?author=Alice");
  await page.getByTestId("gallery-count-panel").click();
  await expect(popover).toContainText("1 author");
  await expect(names).toHaveText(["Alice"]);
  // The way back to everyone is in the same menu, and keeps the rest.
  await page.getByTestId("gallery-contributor-all").click();
  await expect(popover).toBeHidden();
  await expect(page).toHaveURL(
    (url) =>
      !url.searchParams.has("author") &&
      url.searchParams.get("tags") === "amplifier",
  );
  await expect(page.getByTestId("gallery-filter")).toHaveCount(0);

  // A text search counts only the cards it matches, as they load.
  await page.getByTestId("gallery-count-panel").click();
  await page.getByTestId("gallery-search").fill("Bob");
  await expect(popover).toContainText("0 authors so far");
  await expect(popover.locator(".gallery-contributor-row")).toHaveCount(0);
  await expect.poll(() => Boolean(pending)).toBe(true);
  await pending!.fulfill({
    json: {
      entries: [
        { ...ENTRY, id: "bob-1", author: "Bob" },
        { ...ENTRY, id: "alice-3", author: "Alice" },
      ],
      total: 3,
      nextCursor: null,
    },
  });
  await expect(names).toHaveText(["Bob"]);
  await expect(popover.locator(".gallery-contributor-count")).toHaveText([
    "1 circuit",
  ]);
  await expect(popover).not.toContainText("so far");
  expect(globalRequests).toBe(0);
});

test("hosted Gallery never falls back to local examples when unreachable", async ({
  page,
}) => {
  await page.route(galleryListUrl, (route) =>
    route.fulfill({ status: 502, json: { error: "unavailable" } }),
  );
  await page.goto("/");
  await expect(
    page.getByTestId("gallery-bundled-two-stage-op-amp"),
  ).toHaveCount(0);
  await expect(page.getByTestId("gallery-feed")).toBeVisible();
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
  await expectStatus(page, `Opened gallery circuit: ${ENTRY.name}`);
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
  await serveWall(page, () => ({
    entries: [extractable, sketch],
    nextCursor: null,
  }));
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
localTest(
  "bundled VDD rails keep their current presentation in the Gallery and editor",
  async ({ page }) => {
    await mockGallery(page, []);
    await page.goto("/");
    const starter = page.getByTestId(
      "gallery-bundled-current-mirror-loaded-differential-pair",
    );
    const tileRails = starter.locator('[data-route-presentation="power-rail"]');
    await expect(tileRails).toHaveCount(3);
    // A conductor run is one shape, so a rail's width is on the shape carrying
    // its subpath rather than on the element that carries its identity.
    const railInkWidths = (root: Locator) =>
      root.evaluate((element: SVGElement | HTMLElement) => {
        const inks = [
          ...element.querySelectorAll('[data-role="conductor-ink"]'),
        ];
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
    expect(await railInkWidths(starter)).toEqual(["3.24", "3.24", "3.24"]);
    await expect(
      starter.locator(
        '[data-layer="junctions"] circle[cx="380"][cy="160"], [data-layer="junctions"] circle[cx="500"][cy="160"]',
      ),
    ).toHaveCount(0);

    await starter.click();
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
  },
);

// Quick filters.

test("quick filter counts sit right-aligned, and a filter that empties the wall says so", async ({
  page,
}) => {
  await signIn(page, sessionUser({ displayName: "Reader", isAdmin: true }));
  await serveWall(page, (url) => {
    const liked = url.searchParams.has("liked");
    return {
      entries: liked ? [] : [ENTRY],
      nextCursor: null,
      total: liked ? 0 : 1,
      filterCounts: {
        attention: 2,
        netlistable: 12,
        liked: 0,
        componentRanges: { "0-5": 1, "6-10": 0, "11-15": 0, "16-25": 0 },
      },
    };
  });
  await page.goto("/");
  const quick = ["attention", "netlistable", "liked"].map((key) =>
    page.getByTestId(`gallery-filter-${key}`),
  );
  await expect(quick[1]!.locator(".gallery-sidebar-count")).toHaveText("12");
  const small = page.getByTestId("gallery-filter-parts-0-5");
  await expect(small).toContainText("≤ 5");
  await expect(small.locator(".gallery-sidebar-count")).toHaveText("1");

  // At the narrowest sidebar every count still ends on one edge, clear of
  // its label and inside its row.
  await page.getByRole("separator", { name: "Resize Gallery filters" }).focus();
  await page.keyboard.press("Home");
  const edges = await Promise.all(
    quick.map((button) =>
      button.evaluate((node) => {
        const count = node
          .querySelector(".gallery-sidebar-count")!
          .getBoundingClientRect();
        const label = node.querySelector("span")!.getBoundingClientRect();
        const bounds = node.getBoundingClientRect();
        return {
          right: count.right,
          inside: count.right <= bounds.right,
          separated: label.right <= count.left,
        };
      }),
    ),
  );
  expect(edges.every((edge) => edge.inside && edge.separated)).toBe(true);
  expect(
    Math.max(...edges.map((edge) => edge.right)) -
      Math.min(...edges.map((edge) => edge.right)),
  ).toBeLessThan(1);

  // An emptied wall names the choice that emptied it, not an empty Gallery.
  await quick[2]!.click();
  await expect(page.getByTestId("gallery-mark-empty")).toHaveText(
    "You have not liked any circuits yet.",
  );
  await expect(page.getByTestId("gallery-empty")).toHaveCount(0);
});

test("netlist filter scopes the category and tag counts from a link on, and ignores a late summary", async ({
  page,
}) => {
  const summary = (filtered: boolean) => ({
    tags: [
      { tag: "amplifier", count: filtered ? 1 : 2 },
      { tag: "ota", count: filtered ? 1 : 2 },
      ...(!filtered ? [{ tag: "comparator", count: 1 }] : []),
    ],
    groups: [
      { group: "Amplifiers", count: filtered ? 1 : 3 },
      ...(!filtered ? [{ group: "Conversion", count: 1 }] : []),
    ],
  });
  const scopes: boolean[] = [];
  let holdFull = false;
  let receiveHeld!: (route: Route) => void;
  const heldRequest = new Promise<Route>((resolve) => {
    receiveHeld = resolve;
  });
  await page.route("**/api/gallery**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/gallery/tags") {
      const filtered = url.searchParams.get("netlistable") === "1";
      scopes.push(filtered);
      if (!filtered && holdFull) {
        receiveHeld(route);
        return;
      }
      return route.fulfill({ json: summary(filtered) });
    }
    if (url.pathname === "/api/gallery")
      return route.fulfill({ json: { entries: [], nextCursor: null } });
    return route.fallback();
  });
  // A linked filter's counts are the first and only ones asked for.
  await page.goto("/?netlist=1");
  const sidebar = page.getByTestId("gallery-tag-sidebar");
  const categoryCount = (name: string) =>
    sidebar
      .getByRole("checkbox", { name, exact: true })
      .locator(".gallery-sidebar-count");
  const amplifierCount = page
    .getByTestId("gallery-tag-option-amplifier")
    .locator(".gallery-sidebar-count");
  const toggle = page.getByTestId("gallery-filter-netlistable");
  await expect(categoryCount("Amplifiers")).toHaveText("1");
  expect(scopes).toEqual([true]);
  await sidebar
    .getByRole("button", { name: "Expand Amplifiers", exact: true })
    .click();
  await expect(amplifierCount).toHaveText("1");
  await expect(categoryCount("Conversion")).toHaveText("0");
  await toggle.click();
  await expect(categoryCount("Amplifiers")).toHaveText("3");
  await expect(amplifierCount).toHaveText("2");
  await expect(categoryCount("Conversion")).toHaveText("1");
  await toggle.click();
  await expect(categoryCount("Amplifiers")).toHaveText("1");
  await expect(amplifierCount).toHaveText("1");

  // A slower full response must not overwrite the filtered counts restored
  // after it was asked for.
  holdFull = true;
  await toggle.click();
  const held = await heldRequest;
  await expect(categoryCount("Amplifiers")).toHaveText("…");
  await expect(amplifierCount).toHaveText("…");
  await toggle.click();
  await expect(categoryCount("Amplifiers")).toHaveText("1");
  const lateResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/gallery/tags"),
  );
  await held.fulfill({ json: summary(false) });
  await lateResponse;
  await awaitTwoFrames(page);
  await expect(categoryCount("Amplifiers")).toHaveText("1");
  await expect(amplifierCount).toHaveText("1");
});

test("a remembered narrowing loads the wall with its one early request", async ({
  page,
}) => {
  const lists: string[] = [];
  let firstListAsked = Number.POSITIVE_INFINITY;
  let wallCodeArrived = Number.POSITIVE_INFINITY;
  // The wall's own code arrives late, as on a slow first visit.
  // The dev server serves the module, the built editor its chunk.
  await page.route(
    "**/{src/components/gallery-feed.tsx,assets/gallery-feed-*.js}*",
    async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 800));
      wallCodeArrived = Date.now();
      await route.continue();
    },
  );
  await serveWall(page, (url) => {
    firstListAsked = Math.min(firstListAsked, Date.now());
    // The query without the wall's order (#1615), which every wall carries.
    const query = url.searchParams;
    query.delete("order");
    query.delete("seed");
    lists.push(`?${query.toString()}`);
    return { entries: [ENTRY], nextCursor: null, total: 1 };
  });
  await page.addInitScript(() =>
    localStorage.setItem(
      "icm.gallery-filters.v1",
      JSON.stringify({
        parts: ["6-10"],
        withoutNetlist: true,
        ai: "human",
        source: "analoggenie",
      }),
    ),
  );
  await page.goto("/");
  await expect(page.locator("a.gallery-tile")).toHaveCount(1);
  // The landing preload asked the remembered query before the wall's code
  // arrived, and the wall took that answer instead of asking again.
  await page.waitForLoadState("networkidle");
  expect(lists).toEqual(["?source=analoggenie&netlistable=0&ai=0&parts=6-10"]);
  expect(firstListAsked).toBeLessThan(wallCodeArrived);
});

// Search.

test("an unfinished feed says it is still searching, not that nothing matches", async ({
  page,
}) => {
  await serveWall(page, (url) => {
    // Hold the tail of the feed open: the fetch never resolves, so the
    // feed stays legitimately incomplete for the whole assertion window.
    if (url.searchParams.get("cursor")) return;
    return {
      entries: [tile("s1", { name: "Ring Oscillator", author: "mei" })],
      nextCursor: "2026-08-20T00:00:00.000Z|older",
      total: 40,
    };
  });
  await page.route("**/api/gallery/tags", (route) =>
    route.fulfill({ json: { tags: [] } }),
  );
  await page.goto("/");
  await expect(page.getByTestId("gallery-tile-s1")).toBeVisible();

  await page.getByTestId("gallery-search").fill("zzz");
  await expect(page.getByTestId("gallery-search-pending")).toHaveText(
    "No matches yet — searching older circuits…",
  );
  await expect(page.getByTestId("gallery-search-empty")).toHaveCount(0);
  await expect(page.getByTestId("gallery-count-panel")).toHaveText(
    "40 circuits · 0 matches so far",
  );
});

test("a search keeps what it found when the window comes back into focus", async ({
  page,
}) => {
  await signIn(page, sessionUser({ displayName: "Reader" }));
  // Newest first, as the server orders them: a full first page, one more.
  const at = (index: number) =>
    new Date(Date.UTC(2026, 8, 20, 0, 0, 60 - index)).toISOString();
  const firstPage = Array.from({ length: 30 }, (_, index) => ({
    ...ENTRY,
    id: index === 3 ? "bandgap-new" : `clock-${index}`,
    name: index === 3 ? "Bandgap reference" : `Clock ${index}`,
    createdAt: at(index),
  }));
  const older = {
    ...ENTRY,
    id: "bandgap-old",
    name: "Bandgap core",
    createdAt: at(40),
  };
  const last = firstPage.at(-1)!;
  let firstPages = 0;
  let searchedPages = 0;
  let holdOlder = false;
  await mockPreviews(page);
  await mockGalleryApi(page, { tags: [] }, async (url, route) => {
    if (url.searchParams.has("cursor")) {
      // After the refresh, the older page answers slowly: a wall that
      // dropped it would show one match for all that time.
      if (holdOlder) await new Promise((resolve) => setTimeout(resolve, 4000));
      return route.fulfill({
        json: { entries: [older], total: 31, nextCursor: null },
      });
    }
    firstPages += 1;
    if (url.searchParams.get("q") === "bandgap") searchedPages += 1;
    // A server without search: it answers the words with the whole wall, so
    // the wall keeps narrowing what it loads.
    return route.fulfill({
      json: {
        entries: firstPage,
        total: 31,
        nextCursor: `${last.createdAt}|${last.id}`,
      },
    });
  });
  await page.goto("/");
  await page.getByTestId("gallery-search").fill("bandgap");
  // The words go to the server once typing pauses.
  await expect.poll(() => searchedPages).toBe(1);
  const progress = page.getByTestId("gallery-search-progress");
  await expect(progress).toHaveText("Searched all 31 circuits · 2 matches");
  await expect(page.getByTestId("gallery-tile-bandgap-old")).toBeVisible();
  const before = firstPages;
  holdOlder = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => firstPages).toBe(before + 1);
  // The refreshed newest page leaves the older one it had already read.
  await expect(page.getByTestId("gallery-tile-bandgap-old")).toBeVisible({
    timeout: 1000,
  });
  await expect(page.getByTestId("gallery-tile-bandgap-new")).toBeVisible();
  await expect(progress).toHaveText("Searched all 31 circuits · 2 matches");
});

test("a reload clears the search and keeps every other filter; a shared search still opens (#1675)", async ({
  page,
}) => {
  await signIn(page, sessionUser({ displayName: "Reader" }));
  const asked: string[] = [];
  await mockPreviews(page);
  await mockGalleryApi(page, { tags: [] }, async (url, route) => {
    asked.push(url.searchParams.get("q") ?? "");
    return route.fulfill({
      json: { entries: [ENTRY], total: 1, nextCursor: null },
    });
  });
  const search = page.getByTestId("gallery-search");
  const netlist = page.getByTestId("gallery-filter-netlistable");
  await page.goto("/?netlist=1&utm_source=share");
  await search.fill("mirror");
  await expect(page).toHaveURL((url) => url.searchParams.get("q") === "mirror");
  await expect.poll(() => asked.at(-1)).toBe("mirror");
  // The search is never remembered, so a later visit opens unsearched.
  const stored = () =>
    page.evaluate(() =>
      JSON.parse(localStorage.getItem("icm.gallery-filters.v1") ?? "{}"),
    );
  expect(await stored()).toMatchObject({ netlistable: true });
  expect(await stored()).not.toHaveProperty("search");
  await page.goto("/");
  await expect(netlist).toHaveAttribute("aria-pressed", "true");
  await expect(search).toHaveValue("");

  // A link that carries a search, opened fresh, shows that search.
  await page.goto("/?netlist=1&q=mirror&utm_source=share");
  await expect(search).toHaveValue("mirror");
  await expect.poll(() => asked.at(-1)).toBe("mirror");

  // Reloaded, it opens unsearched and keeps everything else.
  await page.reload();
  await expect(search).toHaveValue("");
  await expect(page.getByTestId(`gallery-tile-${ENTRY.id}`)).toBeVisible();
  await expect(netlist).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveURL(
    (url) =>
      !url.searchParams.has("q") &&
      url.searchParams.get("netlist") === "1" &&
      url.searchParams.get("utm_source") === "share",
  );
  expect(asked.at(-1)).toBe("");
});

// Tags.

test("tag categories select all children, retain other groups and expose mixed selection", async ({
  page,
}) => {
  const queries: string[][] = [];
  const tags = [
    { tag: "amplifier", count: 3 },
    { tag: "op", count: 1 },
    { tag: "buffer", count: 2 },
  ];
  await mockGalleryApi(page, { tags }, async (url, route) => {
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

test("the tag sidebar resizes by dragging and keyboard, remembers width and adapts to narrow windows", async ({
  page,
}) => {
  await serveWall(page, () => ({
    entries: [ENTRY],
    nextCursor: null,
    total: 1,
  }));
  await page.route("**/api/gallery/tags", (route) =>
    route.fulfill({ json: { tags: [{ tag: "amplifier", count: 1 }] } }),
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

test("the tag menu multi-selects and a tile's tag joins the selection", async ({
  page,
}) => {
  const listQueries: string[] = [];
  await mockPreviews(page);
  const tags = [
    { tag: "amplifier", count: 3 },
    { tag: "adc", count: 2 },
    { tag: "pll", count: 1 },
  ];
  await mockGalleryApi(page, { tags }, async (url, route) => {
    listQueries.push(url.searchParams.get("tags") ?? "");
    return route.fulfill({
      json: { entries: [tile("t-pll", { tags: ["pll"] })], nextCursor: null },
    });
  });

  await page.goto("/");
  // Two tags ask for either of them, and the link carries both.
  const sidebar = page.getByTestId("gallery-tag-sidebar");
  for (const group of ["Amplifiers", "Conversion"])
    await sidebar
      .getByRole("button", { name: `Expand ${group}`, exact: true })
      .click();
  // A group's name and its tags share one type and rhythm; a tag row stays
  // a compact line, its box starting where its group's name does.
  const amplifier = page.getByTestId("gallery-tag-option-amplifier");
  expect((await amplifier.boundingBox())!.height).toBeLessThanOrEqual(28);
  const rhythm = await sidebar
    .getByRole("checkbox", { name: "Amplifiers", exact: true })
    .evaluate((summary) => {
      const group = summary.closest(".gallery-tag-group")!;
      const items = [
        ...group.querySelectorAll<HTMLElement>(".gallery-sidebar-tag"),
      ];
      const own = getComputedStyle(summary);
      const item = getComputedStyle(items[0]!);
      const name = summary.querySelector(".gallery-tag-group-name")!;
      const check = items[0]!.querySelector(".gallery-tag-check")!;
      return {
        same: own.fontFamily === item.fontFamily && own.color === item.color,
        font: [own.fontSize, own.fontWeight, own.paddingTop, own.paddingBottom],
        groupMarginBottom: getComputedStyle(group).marginBottom,
        itemGap:
          items[1]!.getBoundingClientRect().top -
          items[0]!.getBoundingClientRect().bottom,
        tagIndent:
          check.getBoundingClientRect().left -
          name.getBoundingClientRect().left,
      };
    });
  expect(rhythm).toEqual({
    same: true,
    // With a mouse, rows sit about a tenth closer than touch rows.
    font: ["12px", "600", "4.5px", "4.5px"],
    groupMarginBottom: "4px",
    itemGap: 1,
    tagIndent: 0,
  });
  await page.getByTestId("gallery-tag-option-amplifier").click();
  await page.getByTestId("gallery-tag-option-adc").click();
  await expect(page).toHaveURL(/tags=amplifier%2Cadc|tags=amplifier,adc/);
  await expect.poll(() => listQueries.at(-1)).toBe("amplifier,adc");

  // Clearing asks for the full wall; a tile's tag chip re-enters selection.
  await page.getByTestId("gallery-tags-clear").click();
  await expect.poll(() => listQueries.at(-1)).toBe("");
  await page.getByTestId("gallery-tile-tag-t-pll-pll").click();
  await expect(page.getByTestId("gallery-tag-option-pll")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect.poll(() => listQueries.at(-1)).toBe("pll");
});

// The editor's Gallery panel.

test("the editor's Gallery search keeps focus through pending queries and ignores an older response", async ({
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
  await openEditor(page);
  await page.getByTestId("examples-toggle").click();
  const search = page.getByTestId("examples-panel-search");
  await search.fill("old");
  await expect.poll(() => Boolean(releaseOld)).toBe(true);
  await expect(search).toBeFocused();
  await search.press("ControlOrMeta+A");
  await search.pressSequentially("new");
  const card = page.getByTestId(`gallery-example-${ENTRY.id}`);
  await expect(card).toContainText("new result");
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
  await expect(card).toContainText("new result");
});

test("the editor's Gallery discards pending data from the previous account", async ({
  page,
}) => {
  // Closing and reopening the panel invalidates the same way.
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
  await openEditor(page);
  await page.getByTestId("examples-toggle").click();
  await expect.poll(() => Boolean(releaseOld)).toBe(true);
  const accountChanged = () =>
    page.evaluate(() => window.dispatchEvent(new Event("icm-account-changed")));
  await accountChanged();
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
  await accountChanged();
  await expect(page.getByTestId("examples-panel-sign-in")).toBeVisible();
  await expect(card).toHaveCount(0);
});

test("Gallery copies SKY130 dependencies with preview, repeat placement and atomic undo", async ({
  page,
}) => {
  const source = exampleProject("simulation-common-source.icproj.json");
  const count = source.documents.find((d) => d.id === source.topDocumentId)!
    .instances.length;
  await mockGallery(page, [{ ...ENTRY, tags: ["clock"] }], source);
  await openEditor(page);
  await page.getByTestId("examples-toggle").click();
  const panel = page.getByTestId("examples-panel");
  await expect(panel.getByTestId("examples-panel-tag-toggle")).toHaveCount(0);
  const search = panel.getByTestId("examples-panel-search");
  await expect(search).toHaveAttribute("placeholder", "Search Gallery…");
  await search.fill("clock");
  await expect(page.getByTestId(`gallery-example-${ENTRY.id}`)).toBeVisible();
  await search.fill("");
  await page.getByTestId(`gallery-example-${ENTRY.id}`).click();
  const instances = page.getByTestId("instance-count");
  const canvas = page.getByTestId("schematic-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas is not measurable");
  await page.mouse.move(box.x + 260, box.y + 220);
  await expect(page.getByTestId("copy-placement-preview")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(instances).toHaveText("0");
  await page.getByTestId(`gallery-example-${ENTRY.id}`).click();
  await page.mouse.move(box.x + 260, box.y + 220);
  await page.keyboard.press("r");
  await canvas.click({ position: { x: 260, y: 220 } });
  await expect(instances).toHaveText(String(count));
  await expect(page.getByTestId("copy-placement-preview")).toBeVisible();
  await canvas.click({ position: { x: 600, y: 380 } });
  await expect(instances).toHaveText(String(count * 2));
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+z");
  await expect(instances).toHaveText(String(count));
  await page.keyboard.press("Control+z");
  await expect(instances).toHaveText("0");
  await page.keyboard.press("Control+Shift+z");
  await expect(instances).toHaveText(String(count));
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
  await mockPreviews(page);
  const summary = {
    tags: [
      { tag: "clock", count: 30 },
      { tag: "bandgap", count: 1 },
    ],
    groups: [{ group: "Bias & references", count: 1 }],
  };
  await mockGalleryApi(page, summary, async (url, route) => {
    if (url.searchParams.get("tags")?.split(",").includes("bandgap")) {
      return route.fulfill({
        json: {
          entries: [
            {
              ...ENTRY,
              id: "bias",
              name: "Bandgap reference",
              author: "Lin",
              tags: ["bandgap"],
            },
          ],
          total: 1,
          nextCursor: null,
        },
      });
    }
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
  await openEditor(page, "/editor?new=1");
  await page.getByTestId("examples-toggle").click();
  const panel = page.getByTestId("examples-panel");
  const tags = panel.getByTestId("examples-panel-tags");
  const cards = panel.locator(".shapes-example-card");
  const columns = () =>
    panel
      .locator(".shapes-example-list")
      .evaluate(
        (e) => getComputedStyle(e).gridTemplateColumns.split(" ").length,
      );
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
  await expect.poll(columns).toBe(3);
  await resize(720);
  await expect(tags).toBeVisible();
  await expect.poll(columns).toBe(3);
  const bias = tags.getByRole("checkbox", {
    name: "Bias & references",
    exact: true,
  });
  await expect(bias).toContainText("1");
  await tags
    .getByRole("button", { name: "Expand Bias & references", exact: true })
    .click();
  await tags.getByTestId("gallery-tag-option-bandgap").click();
  await expect(panel.getByTestId("gallery-example-bias")).toBeVisible();
  expect(olderRequests).toBe(0);
  await expect(cards).toHaveCount(1);
  await expect(panel.getByTestId("examples-panel-count")).toHaveText(
    "31 circuits · 1 match",
  );
  // Searching within a tag is the examples-panel "gallery panel view" tests.
  await resize(320);
  await expect(tags).toBeHidden();
  await expect(panel.getByTestId("gallery-example-bias")).toBeVisible();
  await expect(panel.getByTestId("examples-panel-search")).toBeVisible();
  await panel.getByTestId("examples-panel-clear-tags").click();
  await panel.locator(".examples-panel-results").evaluate((e) => {
    e.scrollTop = e.scrollHeight;
  });
  await expect(cards).toHaveCount(31);
  await resize(900);
  await expect(tags).toBeVisible();
  await expect.poll(columns).toBe(4);
  await bias.click();
  await expect(cards).toHaveCount(1);
  await bias.click();
  await panel.locator(".examples-panel-results").evaluate((e) => {
    e.scrollTop = e.scrollHeight;
  });
  await expect(cards).toHaveCount(31);
});

test("the Examples panel guards dirty work before opening an entry", async ({
  page,
}) => {
  await mockGallery(page, [ENTRY]);
  await page.goto("/editor");
  await placeResistors(page, [300, 380, 460]);
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
  await expectStatus(page, `Opened gallery circuit: ${ENTRY.name}`);
  await expect(page.getByTestId("hit-R1")).toHaveCount(0);
});
