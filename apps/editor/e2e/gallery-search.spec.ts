// Searching the Gallery: metadata and typos, an unfinished feed, a returning
// window and matches the server finds.

import { expect, test } from "./gallery-test.js";
import { galleryEntryMatchesQuery } from "../src/gallery-search";
import { ENTRY, galleryListUrl } from "./gallery-fixtures.js";

test("the search box reaches metadata and tolerates small typos", async ({
  page,
}) => {
  const walled = [
    {
      id: "s1",
      name: "Ring Oscillator",
      author: "mei",
      description: "Three-stage loop",
      createdAt: "2026-08-21T10:00:00.000Z",
      schemaVersion: 23,
      tags: ["amplifier"],
    },
    {
      id: "s2",
      name: "Folded Cascode",
      author: "arash",
      description: "",
      createdAt: "2026-08-20T10:00:00.000Z",
      schemaVersion: 23,
      tags: [],
    },
  ];
  await page.route(galleryListUrl, (route) =>
    route.fulfill({ json: { entries: walled, nextCursor: null, total: 2 } }),
  );
  await page.route("**/api/gallery/tags", (route) =>
    route.fulfill({ json: { tags: [{ tag: "amplifier", count: 1 }] } }),
  );
  await page.route("**/api/gallery/*/preview.svg*", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#fff"/></svg>',
    }),
  );
  await page.goto("/");

  const box = page.getByTestId("gallery-search");
  await expect(
    page.locator(".gallery-sidebar-slot").getByTestId("gallery-search"),
  ).toBeVisible();
  await expect(
    page.getByTestId("gallery-tag-sidebar").getByTestId("gallery-search"),
  ).toHaveCount(0);
  await expect(page.getByTestId("gallery-tag-search")).toHaveCount(0);
  await expect(box).toHaveAttribute("placeholder", "Search name, author, tag…");
  await expect(box).toHaveAttribute("aria-label", "Search circuits");

  await box.fill("mei");
  await expect(page.getByTestId("gallery-tile-s1")).toBeVisible();
  await expect(page.getByTestId("gallery-tile-s2")).toHaveCount(0);
  await expect(page.getByTestId("gallery-count-panel")).toHaveText(
    "2 circuits · 1 match",
  );

  await box.fill("cascode");
  await expect(page.getByTestId("gallery-tile-s2")).toBeVisible();
  await expect(page.getByTestId("gallery-tile-s1")).toHaveCount(0);

  await box.fill("three-stage");
  await expect(page.getByTestId("gallery-tile-s1")).toBeVisible();

  await box.fill("stgae");
  await expect(page.getByTestId("gallery-tile-s1")).toBeVisible();

  await box.fill("zzz");
  await expect(page.getByTestId("gallery-tile-s1")).toHaveCount(0);
  await expect(page.getByTestId("gallery-search-empty")).toHaveText(
    "No circuits match “zzz”.",
  );
  await expect(page.getByTestId("gallery-count-panel")).toHaveText(
    "2 circuits · 0 matches",
  );

  await box.fill("");
  await expect(page.getByTestId("gallery-tile-s1")).toBeVisible();
  await expect(page.getByTestId("gallery-tile-s2")).toBeVisible();
  await expect(page.getByTestId("gallery-count-panel")).toHaveText(
    "2 circuits",
  );
});

test("an unfinished feed says it is still searching, not that nothing matches", async ({
  page,
}) => {
  await page.route(galleryListUrl, (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("cursor")) {
      // Hold the tail of the feed open: the fetch never resolves, so the
      // feed stays legitimately incomplete for the whole assertion window.
      return;
    }
    return route.fulfill({
      json: {
        entries: [
          {
            id: "s1",
            name: "Ring Oscillator",
            author: "mei",
            description: "",
            createdAt: "2026-08-21T10:00:00.000Z",
            schemaVersion: 23,
          },
        ],
        nextCursor: "2026-08-20T00:00:00.000Z|older",
        total: 40,
      },
    });
  });
  await page.route("**/api/gallery/tags", (route) =>
    route.fulfill({ json: { tags: [] } }),
  );
  await page.route("**/api/gallery/*/preview.svg*", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#fff"/></svg>',
    }),
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
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "reader-1",
          displayName: "Reader",
          email: "reader@example.com",
          provider: "github",
          isAdmin: false,
          role: "user",
        },
      },
    }),
  );
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
  let holdOlder = false;
  await page.route("**/api/gallery**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/gallery/tags")
      return route.fulfill({ json: { tags: [] } });
    if (url.pathname.endsWith("/preview.svg"))
      return route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 6"/>',
      });
    if (url.pathname !== "/api/gallery") return route.fallback();
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
  let searchedPages = 0;
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

test("a search the server answers finds an older circuit at once and counts only matches", async ({
  page,
}) => {
  const at = (index: number) =>
    new Date(Date.UTC(2026, 8, 20, 0, 0, 60 - index)).toISOString();
  // Thirty newer clocks fill the first page; the only bandgap is older.
  const wall = [
    ...Array.from({ length: 30 }, (_, index) => ({
      ...ENTRY,
      id: `clock-${index}`,
      name: `Clock ${index}`,
      description: "",
      tags: ["clock"],
      createdAt: at(index),
    })),
    {
      ...ENTRY,
      id: "bandgap-old",
      name: "Bandgap core",
      author: "Lin",
      description: "",
      tags: ["reference"],
      createdAt: at(40),
    },
  ];
  const requests: string[] = [];
  await page.route("**/api/gallery**", (route) => {
    const url = new URL(route.request().url());
    const q = url.searchParams.get("q");
    if (url.pathname === "/api/gallery/tags") {
      requests.push(`tags ${url.search}`);
      const counted = wall.filter(
        (entry) => !q || galleryEntryMatchesQuery(entry, q),
      );
      const tags = [...new Set(counted.flatMap((entry) => entry.tags))];
      return route.fulfill({
        json: {
          tags: tags.map((tag) => ({
            tag,
            count: counted.filter((entry) => entry.tags.includes(tag)).length,
          })),
          groups: [],
        },
      });
    }
    if (url.pathname.endsWith("/preview.svg"))
      return route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 6"/>',
      });
    if (url.pathname !== "/api/gallery") return route.fallback();
    // The wall's order (#1615) is not what this test is about.
    const asked = new URLSearchParams(url.search);
    asked.delete("order");
    asked.delete("seed");
    const rest = asked.toString();
    requests.push(`feed ${rest ? `?${rest}` : ""}`);
    // The server searches every circuit before it pages, and says so.
    if (q) {
      const found = wall.filter((entry) => galleryEntryMatchesQuery(entry, q));
      return route.fulfill({
        json: {
          entries: found,
          total: found.length,
          nextCursor: null,
          search: q,
        },
      });
    }
    const older = url.searchParams.has("cursor");
    return route.fulfill({
      json: {
        entries: older ? wall.slice(30) : wall.slice(0, 30),
        total: wall.length,
        nextCursor: older ? null : "older",
      },
    });
  });
  await page.goto("/");
  await expect(page.getByTestId("gallery-tile-clock-0")).toBeVisible();
  requests.length = 0;
  // A transposed letter still finds it, as the browser's own rule does.
  const search = page.getByTestId("gallery-search");
  await search.fill("bandgpa");
  await expect(page.getByTestId("gallery-tile-bandgap-old")).toBeVisible();
  await expect(page.getByTestId("gallery-tile-clock-0")).toHaveCount(0);
  await expect(page.getByTestId("gallery-count-panel")).toHaveText(
    "1 matching circuit",
  );
  await expect(page.getByTestId("gallery-search-progress")).toHaveCount(0);
  // No older page was read to find it, and the tag counts are the search's.
  expect(requests.filter((request) => request.includes("cursor"))).toEqual([]);
  expect(requests).toContain("feed ?q=bandgpa");
  await expect.poll(() => requests.includes("tags ?q=bandgpa")).toBe(true);
  await expect(page.getByTestId("gallery-tag-option-reference")).toContainText(
    "1",
  );
  // Nothing found is the answer at once, not "still searching".
  await search.fill("zzz");
  await expect(page.getByTestId("gallery-search-empty")).toHaveText(
    "No circuits match “zzz”.",
  );
  await expect(page.getByTestId("gallery-search-pending")).toHaveCount(0);
  await expect(page.getByTestId("gallery-count-panel")).toHaveText(
    "0 matching circuits",
  );
  await search.fill("");
  await expect(page.getByTestId("gallery-tile-clock-0")).toBeVisible();
});
